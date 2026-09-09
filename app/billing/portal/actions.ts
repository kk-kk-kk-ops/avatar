"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";

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
export async function createPortalSession(): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ログインが必要です" };

  const { data: account } = await supabase
    .from("accounts")
    .select("id, stripe_customer_id")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (!account) return { ok: false, error: "アカウントが見つかりません" };
  if (!account.stripe_customer_id) {
    return { ok: false, error: "お支払い情報がまだ登録されていません" };
  }

  let sessionUrl: string | null;
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: account.stripe_customer_id,
      return_url: `${getBaseUrl()}/admin`,
    });
    sessionUrl = session.url;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Stripe Customer Portalセッションの作成に失敗しました", err);
    return { ok: false, error: "お支払い管理ページの作成に失敗しました" };
  }

  redirect(sessionUrl);
}
