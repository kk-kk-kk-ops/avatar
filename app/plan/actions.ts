"use server";

import { createClient } from "@/lib/supabase/server";
import { provisionAccountForUser } from "@/lib/accountProvisioning";
import { FREE_TRIAL_DAYS } from "@/lib/types";

// Server Actionのエラーはproduction buildだと.messageが汎用文言に
// 差し替えられてしまう(Next.jsの仕様)ため、throwではなく戻り値で
// 成否とエラーメッセージを伝える(app/master/actions.tsと同じ方針)。
type ActionResult = { ok: true } | { ok: false; error: string };

// 無料お試し(7日間・スタンダードプラン相当)を開始する。
// アカウント作成 → 自分をadminとして紐付け → 初期ルームを1つ作成、の実処理は
// lib/accountProvisioning.tsに共通化されている(有料プランを直接選んだ場合の
// Checkout Session作成前にも同じ処理が必要なため)。
export async function startFreeTrial(): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ログインが必要です" };

  const trialEndsAt = new Date(
    Date.now() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const result = await provisionAccountForUser(supabase, user, { trialEndsAt });
  if (!result.ok) return result;
  return { ok: true };
}
