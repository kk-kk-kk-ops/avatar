import type { SupabaseClient } from "@supabase/supabase-js";

export type JoinInviteResult =
  | { ok: true; isOwnAccount: boolean }
  | { ok: false; error: "invalid_invite" | "join_failed"; detail?: string };

// 招待トークンのアカウントへゲストとして参加する。
// - 招待URLが自分自身がオーナーのアカウントのものだった場合(自分の
//   招待URLを踏んだ場合)は何もしない。呼び出し元は通常のルーティング
//   (管理者なら/admin、マスターなら/masterなど)に進めばよい。
// - それ以外(他人の招待URL)の場合は、既に別アカウントのadmin/guest
//   であっても常にこのアカウントのゲストへ切り替える。呼び出し元は
//   isMaster/管理者かどうかに関わらず/roomsへ進めること(管理者・
//   マスター権限を持つ人が他人の招待URLを踏んだときに、ゲストとして
//   では入れず自分の管理画面/マスター画面に戻ってしまっていた不具合の
//   修正)。
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

  if (account.owner_user_id === userId) {
    return { ok: true, isOwnAccount: true };
  }

  const { data: existingProfile, error: selectError } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (selectError) {
    return { ok: false, error: "join_failed", detail: selectError.message };
  }

  if (existingProfile?.account_id !== account.id) {
    const { error } = await supabase
      .from("profiles")
      .update({ account_id: account.id, role: "guest" })
      .eq("user_id", userId);
    if (error) {
      return { ok: false, error: "join_failed", detail: error.message };
    }
  }

  return { ok: true, isOwnAccount: false };
}
