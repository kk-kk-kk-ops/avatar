import { SupabaseClient } from "@supabase/supabase-js";
import { ProfileRole } from "./types";

// ログイン済みユーザーが次にどこへ行くべきかを、profiles.account_id/role
// から判定する。 "/"・"/plan"・"/admin"・"/rooms" の各ページで
// 同じ判定ロジックを重複させないための共通処理。
export type UserRouteState =
  | { type: "no-account" } // プラン未選択・未招待の新規ユーザー → /plan
  | { type: "admin"; accountId: string } // アカウントのオーナー → /admin
  | { type: "guest"; accountId: string }; // 招待されたゲスト → /rooms

export async function resolveUserRouteState(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserRouteState> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile?.account_id) {
    return { type: "no-account" };
  }

  const role = (profile.role as ProfileRole | null) ?? "guest";
  return role === "admin"
    ? { type: "admin", accountId: profile.account_id }
    : { type: "guest", accountId: profile.account_id };
}
