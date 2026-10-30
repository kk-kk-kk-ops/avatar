"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { provisionAccountForUser } from "@/lib/accountProvisioning";
import { getStripe, priceIdForPlan, isPaidPlanId, taxRateId } from "@/lib/stripe";
import { PLANS } from "@/lib/types";

type ActionResult = { ok: true } | { ok: false; error: string };

function getBaseUrl(): string {
  const h = headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "https://avatar-pi-dun.vercel.app";
}

// 有料プランのStripe Checkout Sessionを作成し、Stripeの決済画面へ
// リダイレクトする。アカウントがまだ無ければ無料お試しと同じ手順で
// ここで作る(plan/PlanSelector.tsxは有料プラン選択時にアカウントを
// 作らずこのページへ来るため)。accounts.planは常に'free'のまま作成され、
// 実際の反映はapp/api/stripe/webhook/route.tsがservice_role経由で行う。
export async function createCheckoutSession(planId: string): Promise<ActionResult> {
  if (!isPaidPlanId(planId)) return { ok: false, error: "不正なプランです" };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ログインが必要です" };

  const provision = await provisionAccountForUser(supabase, user);
  if (!provision.ok) return provision;
  const accountId = provision.accountId;

  const { data: account } = await supabase
    .from("accounts")
    .select("id, stripe_customer_id, stripe_subscription_id")
    .eq("id", accountId)
    .single();
  if (!account) return { ok: false, error: "アカウントが見つかりません" };

  // 既にStripe上で有効なサブスクリプションがあるアカウントは、この経路
  // (新規Checkout)ではなくCustomer Portal経由でのプラン変更に誘導する
  // (方針確認済み)。ここをaccounts.plan列で判定すると、Stripeを一度も
  // 通していないのにplanだけ設定されているアカウント(デバッグ用プラン
  // 切り替えを使ったマスターアカウント等)が、実際には有効な契約が無い
  // せいでCustomer Portalを開けず(stripe_customer_idが無いため)、
  // プラン変更が一切できなくなってしまう。stripe_subscription_idの
  // 有無で判定すれば、そうしたアカウントも新規Checkoutへ正しく進める。
  if (account.stripe_subscription_id) {
    return {
      ok: false,
      error:
        "既にご契約中です。プラン変更は管理画面の「プランを変更する」ボタン(お支払い管理ページ)からお願いします。",
    };
  }

  const stripe = getStripe();
  let customerId = account.stripe_customer_id as string | null;
  let sessionUrl: string | null;
  try {
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { accountId },
      });
      customerId = customer.id;
      // stripe_customer_idは権限昇格防止トリガー(consolidated_setup.sql)の
      // 対象外の列(planのみが対象)のため、通常のRLSスコープのクライアントで
      // 更新してよい(「accounts: update own」ポリシーがowner_user_id=
      // auth.uid()を許可する)。
      const { error } = await supabase
        .from("accounts")
        .update({ stripe_customer_id: customerId })
        .eq("id", accountId);
      if (error) return { ok: false, error: "顧客情報の保存に失敗しました" };
    }

    const baseUrl = getBaseUrl();
    const priceYen = PLANS[planId].priceYen.toLocaleString();
    const taxRate = taxRateId();
    if (!taxRate && process.env.VERCEL_ENV === "production") {
      // 決済自体は止めない(税率なしで続行する)が、本番で税率が付かない
      // 請求書が発行されてしまうため、見逃さないようログにだけ残す。
      // eslint-disable-next-line no-console
      console.error(
        "Stripe Checkout: STRIPE_TAX_RATE_IDが未設定のため、税率なしでCheckout Sessionを作成します",
      );
    }
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      // 既存customerに対してCheckoutで入力された氏名・住所をCustomer
      // オブジェクトへ書き戻す(customer_updateの指定が無いと既存customer
      // 指定時はbilling_address_collectionが使えない)。適格請求書の宛名
      // として、Stripeが生成する請求書・領収書に反映される。
      customer_update: { name: "auto", address: "auto" },
      billing_address_collection: "required",
      // 事業者名・個人名をCheckout自身がSession完了処理の一部として
      // customer.business_name/individual_nameへ同期的に保存する(名前が
      // Webhookの非同期処理で後から変わるのではなく、最初の請求書が
      // 確定する前に反映されるため、適格請求書の宛名として正しく載る)。
      name_collection: {
        business: { enabled: true, optional: true },
        individual: { enabled: true, optional: true },
      },
      line_items: [{ price: priceIdForPlan(planId), quantity: 1 }],
      client_reference_id: accountId,
      subscription_data: {
        metadata: { accountId },
        // サブスクリプション自体に設定することで、初回請求だけでなく
        // 毎月の更新・カスタマーポータル経由のプラン変更後の請求にも
        // 継続して同じ税率が適用される。taxRateが無い場合はキー自体を
        // 省略する(税率なしで決済を続行する)。
        ...(taxRate ? { default_tax_rates: [taxRate] } : {}),
      },
      metadata: { accountId, planId },
      custom_text: {
        submit: {
          message: `月額${priceYen}円(税込)の自動更新です。解約はいつでも可能で、解約後も当月の利用期間末までご利用いただけます。日割りでの返金は行っておりません。`,
        },
      },
      success_url: `${baseUrl}/admin?checkout=success`,
      cancel_url: `${baseUrl}/billing/checkout?plan=${planId}&checkout=cancelled`,
    });
    sessionUrl = session.url;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Stripe Checkout Sessionの作成に失敗しました", err);
    return { ok: false, error: "決済ページの作成に失敗しました" };
  }

  // redirect()はNext.js側で特別な例外を投げて画面遷移する仕組みのため、
  // try/catchの外(=握りつぶされない場所)で呼ぶ必要がある。
  if (!sessionUrl) return { ok: false, error: "決済ページの作成に失敗しました" };
  redirect(sessionUrl);
}
