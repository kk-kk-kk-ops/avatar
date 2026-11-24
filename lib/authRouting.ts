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
// 段階E-5-1c(2026-11-25)。入室前の画面(app/page.tsx・lib/roomListEntries.ts)
// が別途profilesを読み直していた箇所を減らすため、role以外にも
// locale・display_name・avatar_mode・avatar_icon_urlを同じ1回の読み取りで
// まとめて返す。既存の呼び出し元(9か所)はこのprofileフィールドを使わず
// type/isMaster/accountIdの意味も変えていないため、影響しない。
export type UserRouteStateProfile = {
  role: ProfileRole | null;
  locale: string | null;
  displayName: string | null;
  avatarMode: string | null;
  avatarIconUrl: string | null;
};

export type UserRouteState = (
  | { type: "no-account"; isMaster: boolean } // プラン未選択・未招待の新規ユーザー → /plan
  | { type: "admin"; accountId: string; isMaster: boolean } // アカウントのオーナー → /(ルーム入室画面)
  | { type: "guest"; accountId: string; isMaster: boolean } // 招待されたゲスト → /(ルーム入室画面)
) & { profile: UserRouteStateProfile };

export async function resolveUserRouteState(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserRouteState> {
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "account_id, role, is_master, locale, display_name, avatar_mode, avatar_icon_url",
    )
    .eq("user_id", userId)
    .maybeSingle();

  const isMaster = profile?.is_master === true;
  const profileFields: UserRouteStateProfile = {
    role: (profile?.role as ProfileRole | null) ?? null,
    locale: profile?.locale ?? null,
    displayName: profile?.display_name ?? null,
    avatarMode: profile?.avatar_mode ?? null,
    avatarIconUrl: profile?.avatar_icon_url ?? null,
  };

  if (!profile?.account_id) {
    return { type: "no-account", isMaster, profile: profileFields };
  }

  const role = (profile.role as ProfileRole | null) ?? "guest";
  return role === "admin"
    ? {
        type: "admin",
        accountId: profile.account_id,
        isMaster,
        profile: profileFields,
      }
    : {
        type: "guest",
        accountId: profile.account_id,
        isMaster,
        profile: profileFields,
      };
}
