"use server";

import { createClient } from "@/lib/supabase/server";

// viewOnly(既に自分のアカウントを持つ人が他人の招待URLを一時閲覧する
// 機能)の「入室」ボタンを押した時に、その場でもう一度招待トークンの
// 有効性・BAN状態を確かめるための専用チェック(2026-11追加)。
//
// components/AvatarSpace.tsxのhandleJoin・handleLeaveRoomはページを
// 再読み込みしないため、入室中に管理者が招待URLを再発行しても、
// viewOnlyInviteToken(入室時のpropのまま)は古い値が残り続け、再入室を
// 押しても会議室の画面まで進んでしまっていた(灰色の画面・音声サーバー
// 接続失敗の原因)。この関数で、入室の直前にサーバー側で再確認する。
//
// 既存のlist_rooms_by_invite_token RPC(supabase/migrations/
// 2026-11-09_chat_dm_invite_ban_check.sql)が、招待トークンの一致確認と
// BAN確認(is_banned_for_account、常にauth.uid()で判定)の両方を1回の
// 呼び出しで行うため、新しいDB関数・RLSは追加しない。
//
// 返すのは「入ってよいか」(boolean)だけで、アカウントID・ルーム情報は
// 一切返さない。招待トークンの値はログ・エラーに出さない。
export async function checkViewOnlyInviteAccess(
  roomId: string,
  inviteToken: string,
): Promise<boolean> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    const { data: viewRooms, error } = await supabase.rpc(
      "list_rooms_by_invite_token",
      { token: inviteToken },
    );
    if (error) {
      // eslint-disable-next-line no-console
      console.error("viewOnly入室時のアクセス確認に失敗しました", error);
      return false;
    }

    return (
      (viewRooms as Array<{ id: string }> | null)?.some(
        (r) => r.id === roomId,
      ) ?? false
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("viewOnly入室時のアクセス確認で例外が発生しました", err);
    return false;
  }
}
