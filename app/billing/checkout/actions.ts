"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { requireVerifiedBillingAccount } from "@/lib/billingAccountGuard";
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
// リダイレクトする。accounts.planは常に'free'のまま作成され、実際の
// 反映はapp/api/stripe/webhook/route.tsがservice_role経由で行う。
//
// 2026-11変更: 新規アカウントは無料トライアルの開始(app/plan/actions.ts
// のstartFreeTrial、「ルームを作成」ボタン経由)からしか作らない方針に
// したため、ここではprovisionAccountForUserを呼ばない。
// requireVerifiedBillingAccountはuserIdだけから本人のアカウントを
// 自己解決・確認する(profiles.role==="admin"・accounts.owner_user_id===
// 本人・profiles.account_idとaccounts.idの一致、の3条件。詳細は
// lib/billingAccountGuard.ts参照)。アカウントの無い人・ゲスト
// (他人のアカウントのprofiles.account_id)はこの条件を満たせず安全に
// 拒否される(何も作成しない)。既存のアカウントを持つ管理者の確認内容・
// 動きはこれまでと同じ。
export async function createCheckoutSession(planId: string): Promise<ActionResult> {
  if (!isPaidPlanId(planId)) return { ok: false, error: "不正なプランです" };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ログインが必要です" };

  const verified = await requireVerifiedBillingAccount(supabase, user.id);
  if (!verified.ok) return verified;
  const account = verified.account;
  const accountId = account.id;

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
      // 2026-11-15変更: stripe_customer_idの保存はservice_role経由に変更。
      // 以前はRLSスコープのクライアントで更新していたが、この値を利用者の
      // ログインセッションから書き込める状態だと、profiles.account_idの
      // 書き換えや偽accounts行の作成と組み合わせて他アカウントのStripe
      // カスタマーを乗っ取る経路になることが判明した(2026-11-15調査)。
      // ここで保存する値はStripe API自身の応答(customer.id)であり利用者
      // からの入力ではないため、service_role化しても安全性は変わらない。
      // 更新対象はaccountId(provisionAccountForUserの戻り値・サーバー側で
      // 解決した値)に限定する。
      const { error } = await createServiceRoleClient()
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
