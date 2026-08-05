import type { SupabaseClient } from "@supabase/supabase-js";

export type JoinInviteResult =
  | { ok: true }
  | { ok: false; error: "invalid_invite" | "join_failed"; detail?: string };

// 招待トークンのアカウントへゲストとして参加する。既に他アカウントの
// admin/guestであっても常にこのアカウントのゲストへ切り替える
// (以前は「既に何らかのアカウントに所属済みなら上書きしない」実装に
// していたが、それだと契約済み管理者が他人の招待URLを踏んでも自分の
// 管理画面に戻ってしまい、招待が機能していなかったため変更した)。
// 既に同じアカウントのメンバーであれば何もしない。
export async function joinAccountViaInvite(
  supabase: SupabaseClient,
  userId: string,
  inviteToken: string,
): Promise<JoinInviteResult> {
  const { data: accountRows, error: lookupError } = await supabase.rpc(
    "lookup_account_by_invite_token",
    { token: inviteToken },
  );
  if (lookupError) {
    return { ok: false, error: "join_failed", detail: lookupError.message };
  }
  const account = accountRows?.[0];
  if (!account) return { ok: false, error: "invalid_invite" };

  const { data: existingProfile, error: selectError } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (selectError) {
    return { ok: false, error: "join_failed", detail: selectError.message };
  }

  if (existingProfile?.account_id === account.id) return { ok: true };

  const { error } = await supabase
    .from("profiles")
    .update({ account_id: account.id, role: "guest" })
    .eq("user_id", userId);

  if (error) return { ok: false, error: "join_failed", detail: error.message };
  return { ok: true };
}
