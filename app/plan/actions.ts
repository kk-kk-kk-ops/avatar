"use server";

import { createClient } from "@/lib/supabase/server";
import { FREE_TRIAL_DAYS } from "@/lib/types";

// 無料お試し(7日間・スタンダードプラン相当)を開始する。
// アカウント作成 → 自分をadminとして紐付け → 初期ルームを1つ作成、の順に行う。
// 遷移(/adminへ)はredirect()ではなく呼び出し元(クライアント)の
// router.push()に任せる。redirect()はNext.js内部で特殊な例外を投げて
// 実現されるため、呼び出し元がtry/catchで囲んでいると遷移が握りつぶされて
// しまう(実際にそれが原因で「次へ」を押しても管理画面に進めない不具合が
// 発生していた)。
export async function startFreeTrial() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("ログインが必要です");

  // 既にアカウントを持っていれば作り直さない(二重送信・ブラウザバック対策)
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingProfile?.account_id) return;

  const trialEndsAt = new Date(
    Date.now() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .insert({
      name: "Grovina Office",
      plan: "free",
      trial_ends_at: trialEndsAt,
      owner_user_id: user.id,
    })
    .select("id")
    .single();

  if (accountError || !account) {
    throw new Error("アカウントの作成に失敗しました");
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ account_id: account.id, role: "admin" })
    .eq("user_id", user.id);

  if (profileError) {
    throw new Error("プロフィールの更新に失敗しました");
  }

  const { error: roomError } = await supabase.from("rooms").insert({
    account_id: account.id,
    name: "Grovina Office",
    preview_image: "/map-background.webp",
  });

  if (roomError) {
    throw new Error("初期ルームの作成に失敗しました");
  }
}
