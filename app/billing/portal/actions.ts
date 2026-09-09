"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { getStripe, priceIdForPlan, isPaidPlanId } from "@/lib/stripe";

type ActionResult = { ok: true } | { ok: false; error: string };

function getBaseUrl(): string {
  const h = headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "https://avatar-pi-dun.vercel.app";
}

// Stripeカスタマーポータル(支払い方法の変更・請求履歴の確認・プラン
// 切り替え・解約)へのセッションを作成してリダイレクトする。
// 既に有料プラン契約中のアカウントのプラン変更は、この経路に一本化する
// (方針確認済み。app/billing/checkout/actions.tsの新規Checkoutは
// 初回契約専用)。
//
// targetPlanIdを渡すと(=管理画面の特定プランカードからの変更操作)、
// ポータルの「現在の契約状況」トップページを経由せず直接遷移させる。
// 有料プラン(light/standard/pro)へのtargetPlanIdなら、そのプランへの
// 切り替え確認画面(flow_data: subscription_update_confirm)。
// targetPlanIdが"free"なら、Freeプランには対応するStripe Priceが
// 存在せずsubscription_update_confirmが使えないため、代わりに解約確認
// 画面(flow_data: subscription_cancel)へ遷移させる(=Freeへの切り替えは
// 「解約」として扱う)。省略時(支払い方法の管理・請求履歴の確認等)は
// 従来通りポータルのトップページへ遷移する。
export async function createPortalSession(
  targetPlanId?: string,
): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ログインが必要です" };

  const { data: account } = await supabase
    .from("accounts")
    .select("id, stripe_customer_id, stripe_subscription_id")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (!account) return { ok: false, error: "アカウントが見つかりません" };
  if (!account.stripe_customer_id) {
    return { ok: false, error: "お支払い情報がまだ登録されていません" };
  }

  const stripe = getStripe();
  let sessionUrl: string | null;
  try {
    let flowData: Stripe.BillingPortal.SessionCreateParams.FlowData | undefined;
    if (targetPlanId === "free" && account.stripe_subscription_id) {
      flowData = {
        type: "subscription_cancel",
        subscription_cancel: {
          subscription: account.stripe_subscription_id,
        },
      };
    } else if (
      targetPlanId &&
      isPaidPlanId(targetPlanId) &&
      account.stripe_subscription_id
    ) {
      // 現在のサブスクリプションアイテムIDはaccountsテーブルには保存
      // していないため、Stripe側から都度取得する。
      const subscription = await stripe.subscriptions.retrieve(
        account.stripe_subscription_id,
      );
      const itemId = subscription.items.data[0]?.id;
      if (itemId) {
        flowData = {
          type: "subscription_update_confirm",
          subscription_update_confirm: {
            subscription: account.stripe_subscription_id,
            items: [{ id: itemId, price: priceIdForPlan(targetPlanId) }],
          },
        };
      }
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: account.stripe_customer_id,
      return_url: `${getBaseUrl()}/admin`,
      ...(flowData ? { flow_data: flowData } : {}),
    });
    sessionUrl = session.url;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Stripe Customer Portalセッションの作成に失敗しました", err);
    return { ok: false, error: "お支払い管理ページの作成に失敗しました" };
  }

  redirect(sessionUrl);
}
