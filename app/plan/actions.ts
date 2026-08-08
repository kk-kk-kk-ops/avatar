"use server";

import { createClient } from "@/lib/supabase/server";
import { FREE_TRIAL_DAYS } from "@/lib/types";

// β版の運用制限:全顧客合計の同時接続数がこれに達したら新規契約を停止する。
const BETA_ONLINE_CAP = 1000;

// Server Actionのエラーはproduction buildだと.messageが汎用文言に
// 差し替えられてしまう(Next.jsの仕様)ため、throwではなく戻り値で
// 成否とエラーメッセージを伝える(app/master/actions.tsと同じ方針)。
type ActionResult = { ok: true } | { ok: false; error: string };

// 無料お試し(7日間・スタンダードプラン相当)を開始する。
// アカウント作成 → 自分をadminとして紐付け → 初期ルームを1つ作成、の順に行う。
export async function startFreeTrial(): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ログインが必要です" };

  // 既にアカウントを持っていれば作り直さない(二重送信・ブラウザバック対策)
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingProfile?.account_id) return { ok: true };

  // β版の同時接続数上限チェック(全プラン共通の新規契約ゲート)
  const { data: onlineCount, error: countError } = await supabase.rpc(
    "get_online_session_count",
  );
  if (!countError && (onlineCount ?? 0) >= BETA_ONLINE_CAP) {
    return {
      ok: false,
      error:
        "現在アクセスが集中しているため、新規のご契約を一時的に停止しています。しばらくしてから再度お試しください。",
    };
  }

  const trialEndsAt = new Date(
    Date.now() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .insert({
      name: "Globy",
      plan: "free",
      trial_ends_at: trialEndsAt,
      owner_user_id: user.id,
    })
    .select("id")
    .single();

  if (accountError || !account) {
    return { ok: false, error: "アカウントの作成に失敗しました" };
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ account_id: account.id, role: "admin" })
    .eq("user_id", user.id);

  if (profileError) {
    return { ok: false, error: "プロフィールの更新に失敗しました" };
  }

  const { error: roomError } = await supabase.from("rooms").insert({
    account_id: account.id,
    name: "Globy",
    preview_image: "/map-background.webp",
  });

  if (roomError) {
    return { ok: false, error: "初期ルームの作成に失敗しました" };
  }

  return { ok: true };
}
