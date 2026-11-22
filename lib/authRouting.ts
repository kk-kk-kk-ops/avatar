import { SupabaseClient } from "@supabase/supabase-js";
import { ProfileRole } from "./types";

// ログイン済みユーザーが次にどこへ行くべきかを、profiles.account_id/role
// から判定する。ログイン後のルーティングが必要な各ページ("/"・"/plan"・
// /master等)で同じ判定ロジックを重複させないための共通処理。
//
// isMasterはaccount_id/roleとは独立した軸(プラットフォーム全体を横断して
// 見られる権限)。k.one.for.all.k@gmail.comのように「自分のアカウントの
// adminであり、かつマスターでもある」状態を表現するため、type(no-account/
// admin/guest)を上書きせずisMasterを別フィールドとして持たせている。
// TOPページ(/)はisMasterを優先して/masterへ振り分ける(マスターが
// 自分のルームに入る時は、/master画面の「ルームへ」から自分の招待URL
// 〈/?invite=トークン〉経由で入る)。
export type UserRouteState =
  | { type: "no-account"; isMaster: boolean } // プラン未選択・未招待の新規ユーザー → /plan
  | { type: "admin"; accountId: string; isMaster: boolean } // アカウントのオーナー → /(ルーム入室画面)
  | { type: "guest"; accountId: string; isMaster: boolean }; // 招待されたゲスト → /(ルーム入室画面)

export async function resolveUserRouteState(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserRouteState> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id, role, is_master")
    .eq("user_id", userId)
    .maybeSingle();

  const isMaster = profile?.is_master === true;

  if (!profile?.account_id) {
    return { type: "no-account", isMaster };
  }

  const role = (profile.role as ProfileRole | null) ?? "guest";
  return role === "admin"
    ? { type: "admin", accountId: profile.account_id, isMaster }
    : { type: "guest", accountId: profile.account_id, isMaster };
}
