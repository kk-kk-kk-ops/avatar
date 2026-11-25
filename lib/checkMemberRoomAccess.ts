"use server";

import { createClient } from "@/lib/supabase/server";

// 入室の仕組みの作り替え 段階D-2。メンバーとして入った人の経路。
//
// メンバー(account_membersに載っているルーム)の「入室」ボタンを
// 押した時に、その場でもう一度アクセス権を確かめるための専用チェック。
// 入室中に一覧から外される等でaccount_membersの行が変わっても、入室時の
// propsのままの判定に頼らないよう、入室の直前にサーバー側で再確認する。
//
// 既存のget_own_or_member_room RPC(account_members・持ち主のいずれかで、
// かつBANされていないかを1回の呼び出しで判定する)を使うため、新しいDB
// 関数・RLSは追加しない。
//
// 返すのは「入ってよいか」(boolean)だけで、アカウントID・ルーム情報は
// 一切返さない。
export async function checkMemberRoomAccess(roomId: string): Promise<boolean> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    const { data, error } = await supabase.rpc("get_own_or_member_room", {
      p_room_id: roomId,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error("メンバー入室時のアクセス確認に失敗しました", error);
      return false;
    }

    const matched = (data as Array<{ account_id: string }> | null)?.[0];
    if (!matched) return false;

    // 最終アクセス日時の更新に失敗しても「入れる」の結果は変えず、
    // エラーをログに出すだけにする。
    const { error: touchError } = await supabase.rpc(
      "touch_account_membership",
      { p_account_id: matched.account_id },
    );
    if (touchError) {
      // eslint-disable-next-line no-console
      console.error("最終アクセス日時の更新に失敗しました", touchError);
    }

    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("メンバー入室時のアクセス確認で例外が発生しました", err);
    return false;
  }
}
