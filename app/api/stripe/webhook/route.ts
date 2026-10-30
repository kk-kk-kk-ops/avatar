import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { getStripe, planIdForPriceId } from "@/lib/stripe";
import { broadcastForceLeaveForAccount } from "@/lib/broadcastForceLeave";
import type { PlanId } from "@/lib/types";

// Stripe SDK・生ボディの読み取りにNode runtimeが必要(Edgeでは動かない)。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>;

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    // eslint-disable-next-line no-console
    console.error("Stripe Webhook: 署名検証に必要な設定が不足しています");
    return NextResponse.json(
      { error: "署名の検証に必要な設定が不足しています" },
      { status: 500 },
    );
  }

  // 署名検証には生のリクエストボディが必須。request.json()を先に呼ぶと
  // ボディが消費/変形されて検証が必ず失敗するため、必ずtext()で読む。
  const rawBody = await request.text();

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Stripe Webhook: 署名検証に失敗しました", err);
    return NextResponse.json({ error: "署名が不正です" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // 冪等性: event.idを主キーにした行を確保し、succeededがtrueなら
  // 処理済みとして即200を返す。falseの場合(初回、または前回の処理が
  // 途中で失敗して再送されてきた場合)は処理を進め、最後まで成功したら
  // succeededをtrueに更新する。insert-then-catch(23505)方式にすると、
  // 処理が途中で失敗した後の再送が「重複」として黙ってスキップされて
  // しまう欠陥があるため、この方式にしている。
  const { error: upsertError } = await supabase
    .from("stripe_webhook_events")
    .upsert(
      { id: event.id, type: event.type },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (upsertError) {
    // eslint-disable-next-line no-console
    console.error("Stripe Webhook: イベント記録に失敗しました", upsertError);
    return NextResponse.json({ error: "記録に失敗しました" }, { status: 500 });
  }

  const { data: eventRow } = await supabase
    .from("stripe_webhook_events")
    .select("succeeded")
    .eq("id", event.id)
    .single();
  if (eventRow?.succeeded) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const accountId =
          session.client_reference_id ?? session.metadata?.accountId ?? null;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : (session.subscription?.id ?? null);
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : (session.customer?.id ?? null);

        if (accountId && subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = subscription.items.data[0]?.price.id;
          const planId = priceId ? planIdForPriceId(priceId) : null;
          if (planId) {
            await applyPlanChange(supabase, accountId, planId, subscriptionId, customerId);
          } else {
            // eslint-disable-next-line no-console
            console.error("Stripe Webhook: price_idからplanを特定できません", priceId);
          }
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const accountId = await resolveAccountId(supabase, subscription);
        if (accountId) {
          const priceId = subscription.items.data[0]?.price.id;
          const planId = priceId ? planIdForPriceId(priceId) : null;
          // status: active/trialing以外(past_due等)は今回のスコープでは
          // 現在のプランを据え置く。最終的な解約はcustomer.subscription.deleted
          // で処理する。
          if (
            planId &&
            (subscription.status === "active" || subscription.status === "trialing")
          ) {
            await applyPlanChange(supabase, accountId, planId, subscription.id, null);
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const accountId = await resolveAccountId(supabase, subscription);
        if (accountId) {
          await applyPlanChange(supabase, accountId, "free", null, null);
        }
        break;
      }

      default:
        // 購読していないイベント種別は無視する。
        break;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Stripe Webhook: 処理に失敗しました (${event.type})`, err);
    // succeededはfalseのままにして500を返す。Stripeが再送してきた際に
    // 上のsucceededチェックで「未処理」と判定され、再度処理が試みられる。
    return NextResponse.json({ error: "処理に失敗しました" }, { status: 500 });
  }

  await supabase
    .from("stripe_webhook_events")
    .update({ succeeded: true, updated_at: new Date().toISOString() })
    .eq("id", event.id);

  return NextResponse.json({ received: true });
}

async function resolveAccountId(
  supabase: ServiceRoleClient,
  subscription: Stripe.Subscription,
): Promise<string | null> {
  if (subscription.metadata?.accountId) return subscription.metadata.accountId;

  const { data } = await supabase
    .from("accounts")
    .select("id")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();
  if (data) return data.id;

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const { data: byCustomer } = await supabase
    .from("accounts")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return byCustomer?.id ?? null;
}

async function applyPlanChange(
  supabase: ServiceRoleClient,
  accountId: string,
  planId: PlanId,
  subscriptionId: string | null,
  customerId: string | null,
) {
  const update: Record<string, unknown> = {
    plan: planId,
    stripe_subscription_id: subscriptionId,
    // 30日間無料トライアル(standardプラン相当)中のアカウントが期限前に
    // Stripeで実際に契約した場合、trial_ends_atを残したままにすると
    // 期限日にapp/api/cron/expire-trials/route.tsが「トライアル期限切れ」
    // と誤判定し、正規の有料契約を巻き戻しかねない。Stripeが実際の契約
    // 状態のソースになった時点で無効化する(解約でplan='free'に戻る
    // 場合も含め、Stripe駆動のプラン変更では常にクリアする)。
    trial_ends_at: null,
  };
  if (customerId) update.stripe_customer_id = customerId;

  const { error } = await supabase.from("accounts").update(update).eq("id", accountId);
  if (error) {
    throw new Error(`accounts.planの更新に失敗しました: ${error.message}`);
  }

  await broadcastForceLeaveForAccount(supabase, accountId);
}
