import { SupabaseClient } from "@supabase/supabase-js";
import { ProfileRole } from "./types";

// ログイン済みユーザーが次にどこへ行くべきかを、profiles.account_id/role
// から判定する。 "/"・"/plan"・"/admin" の各ページで同じ判定ロジックを
// 重複させないための共通処理。
//
// isMasterはaccount_id/roleとは独立した軸(プラットフォーム全体を横断して
// 見られる権限)。k.one.for.all.k@gmail.comのように「自分のアカウントの
// adminであり、かつマスターでもある」状態を表現するため、type(no-account/
// admin/guest)を上書きせずisMasterを別フィールドとして持たせている。
// TOPページ(/)はisMasterを優先して/masterへ振り分けるが、/adminは
// account所有だけを見るため、マスターであっても自分のアカウントの
// 管理画面には引き続きアクセスできる。
export type UserRouteState =
  | { type: "no-account"; isMaster: boolean } // プラン未選択・未招待の新規ユーザー → /plan
  | { type: "admin"; accountId: string; isMaster: boolean } // アカウントのオーナー → /admin
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
