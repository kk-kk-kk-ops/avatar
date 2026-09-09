"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { provisionAccountForUser } from "@/lib/accountProvisioning";
import { getStripe, priceIdForPlan, isPaidPlanId } from "@/lib/stripe";

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

  const provision = await provisionAccountForUser(supabase, user, {
    trialEndsAt: null,
  });
  if (!provision.ok) return provision;
  const accountId = provision.accountId;

  const { data: account } = await supabase
    .from("accounts")
    .select("id, plan, stripe_customer_id")
    .eq("id", accountId)
    .single();
  if (!account) return { ok: false, error: "アカウントが見つかりません" };

  // 既に有料プラン契約中のアカウントは、この経路(新規Checkout)ではなく
  // Customer Portal経由でのプラン変更に誘導する(方針確認済み)。
  if (account.plan !== "free") {
    return {
      ok: false,
      error:
        "既にご契約中です。プラン変更は管理画面の「支払い方法を管理」からお願いします。",
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
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceIdForPlan(planId), quantity: 1 }],
      client_reference_id: accountId,
      subscription_data: { metadata: { accountId } },
      metadata: { accountId, planId },
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
