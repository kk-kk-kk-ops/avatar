import type { SupabaseClient } from "@supabase/supabase-js";

// supabase/migrations/2026-11-23_account_members.sql の
// join_account_by_invite_token 内の raise exception の文言と完全に
// 一致させること(この文字列一致判定がBAN判定の唯一の手段のため)。
export const ACCOUNT_MEMBERS_BANNED_ERROR_MESSAGE =
  "このルームへのアクセスが制限されています";

export type JoinInviteResult =
  | { ok: true; isOwnAccount: true }
  | { ok: true; isOwnAccount: false; accountId: string }
  | {
      ok: false;
      error: "invalid_invite" | "join_failed" | "banned";
      detail?: string;
    };

// 入室の仕組みの作り替え 段階E-3(2026-11-24)。招待URLのアカウントを扱う。
// 2パターンに分岐する。
// - 自分自身がオーナーのアカウントの招待URL(自分の招待URL)だった場合:
//   何も書き込まない(isOwnAccount: true)。呼び出し元(app/page.tsx)は
//   これまでと同じ経路(resolveUserRouteState→renderRoomJoin)で処理する
//   (段階E-4で見直す予定、今回は変更しない)。
// - それ以外(既に自分の別アカウントを持っている人〈以前はviewOnlyとして
//   プロフィールを書き換えずに一時閲覧させていた〉も、純粋なゲスト参加も、
//   同じ扱いにする。2026-11-24決定: viewOnlyのままだと一覧にカードが
//   増えず、毎回招待URLが必要なままになってしまい、カード一覧〈段階
//   E-1+E-2〉の目的が果たせないため)。join_account_by_invite_token
//   RPCを呼び、account_membersにメンバーとして載せる。BAN確認は書き込みの
//   前にSQL側で行われる(raise exceptionの文言はACCOUNT_MEMBERS_
//   BANNED_ERROR_MESSAGEで判定する)。profilesは一切書き換えない
//   (以前はここでservice_roleによりprofiles.account_id/roleを書き換えて
//   いたが、BAN確認前に書き換えてしまう不具合があったうえ、既に別の
//   アカウントに所属している人〈古いゲストなど〉の所属を上書きで失わせて
//   しまう問題もあったため、段階E-3でこの書き換え自体をやめた)。
//   renderViewOnlyRoomJoinなど古い経路はコードとして残すが、この関数からは
//   もう呼ばれない(段階Gで削除予定)。
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

  const { error: joinError } = await supabase.rpc(
    "join_account_by_invite_token",
    { token: inviteToken },
  );
  if (joinError) {
    if (joinError.message === ACCOUNT_MEMBERS_BANNED_ERROR_MESSAGE) {
      return { ok: false, error: "banned" };
    }
    return { ok: false, error: "join_failed", detail: joinError.message };
  }

  return { ok: true, isOwnAccount: false, accountId: account.id };
}
