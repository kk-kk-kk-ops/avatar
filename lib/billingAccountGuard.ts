import type { SupabaseClient } from "@supabase/supabase-js";

type AccountRow = {
  id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

export type VerifiedBillingAccount =
  | { ok: true; account: AccountRow }
  | { ok: false; error: string };

// createCheckoutSession(app/billing/checkout/actions.ts)・
// createPortalSession(app/billing/portal/actions.ts)の両方で使う共通の
// 確認処理。「ログイン中の人が、自分自身の正当なアカウントのownerで
// あること」を以下の3条件すべてで確認し、1つでも満たさなければ拒否する。
//   - profiles.role === "admin"
//   - accounts.owner_user_id === 本人(複数行一致した場合も拒否する)
//   - profiles.account_id === accounts.id (expectedAccountIdを渡す場合はそれとも一致)
//
// 2026-11-15に見つかった欠陥(profiles.account_idの書き換え・偽のaccounts行の
// 作成を組み合わせることで、他アカウントのStripeカスタマーポータル・
// Checkoutを乗っ取れる)への、Server Action側の多層防御。DB側の対策
// (prevent_privileged_column_self_writeのaccounts分岐拡張、段階2)とは
// 別に、ここでも確認する。既存のrequireAdminAccount()(app/admin/actions.ts)
// は変更しない(判定基準が異なるため、今回はこの billing 用の関数を
// 新設する。詳細は呼び出し元の変更に添えたコメント参照)。
export async function requireVerifiedBillingAccount(
  supabase: SupabaseClient,
  userId: string,
  expectedAccountId?: string,
): Promise<VerifiedBillingAccount> {
  const GENERIC_ERROR = "アカウント情報の確認に失敗しました";

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, account_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError || !profile || profile.role !== "admin") {
    return { ok: false, error: GENERIC_ERROR };
  }

  const { data: accounts, error: accountsError } = await supabase
    .from("accounts")
    .select("id, stripe_customer_id, stripe_subscription_id")
    .eq("owner_user_id", userId);
  if (accountsError || !accounts || accounts.length !== 1) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const account = accounts[0];
  if (profile.account_id !== account.id) {
    return { ok: false, error: GENERIC_ERROR };
  }
  if (expectedAccountId && account.id !== expectedAccountId) {
    return { ok: false, error: GENERIC_ERROR };
  }

  return { ok: true, account };
}
