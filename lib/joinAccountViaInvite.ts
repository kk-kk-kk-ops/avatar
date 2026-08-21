import type { SupabaseClient } from "@supabase/supabase-js";

export type JoinInviteResult =
  | { ok: true; isOwnAccount: boolean; viewOnly: boolean }
  | { ok: false; error: "invalid_invite" | "join_failed"; detail?: string };

// 招待トークンのアカウントを扱う。3パターンに分岐する。
// - 自分自身がオーナーのアカウントの招待URL(自分の招待URL)だった場合:
//   プロフィールは書き換えない(isOwnAccount: true)。呼び出し元
//   (app/page.tsx)はisMaster/管理者かどうかに関わらず、必ずこの
//   アカウントのルーム入室画面を描画する(通常のログイン後ルーティング
//   に任せると/master・/adminへ戻ってしまうため、以前はこれが実装漏れで
//   バグになっていた)。
// - 既に自分自身の別アカウントを持っている(=どこかのadmin)場合:
//   プロフィールは一切書き換えない(viewOnly: true)。ここでprofiles.
//   account_id/roleを上書きしてしまうと、管理者がテスト等で他人の
//   招待URLを一度踏んだだけで自分の管理者アカウントとの紐付けが永久に
//   失われ、ログアウトしても二度と管理画面に戻れなくなる不具合になる
//   (実際に発生した)。この場合、呼び出し元は/?invite=トークンのように
//   URLだけで一時的に対象アカウントを閲覧させ、プロフィールには何も
//   残さない。
// - それ以外(自分は現時点でどのアカウントも持っていない、純粋な
//   ゲスト)の場合: 通常通りprofiles.account_id/roleを更新して恒久的に
//   参加する(viewOnly: false)。招待URLを毎回踏まなくても次回から
//   普通にログインするだけでこのアカウントのルームに入れるようにする
//   ため。
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
    return { ok: true, isOwnAccount: true, viewOnly: false };
  }

  const { data: ownedAccount, error: ownedError } = await supabase
    .from("accounts")
    .select("id")
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (ownedError) {
    return { ok: false, error: "join_failed", detail: ownedError.message };
  }
  if (ownedAccount) {
    return { ok: true, isOwnAccount: false, viewOnly: true };
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

  return { ok: true, isOwnAccount: false, viewOnly: false };
}
