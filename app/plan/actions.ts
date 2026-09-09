"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { provisionAccountForUser } from "@/lib/accountProvisioning";
import { TRIAL_DAYS } from "@/lib/types";

// Server Actionのエラーはproduction buildだと.messageが汎用文言に
// 差し替えられてしまう(Next.jsの仕様)ため、throwではなく戻り値で
// 成否とエラーメッセージを伝える(app/master/actions.tsと同じ方針)。
type ActionResult = { ok: true } | { ok: false; error: string };

// 30日間無料トライアル(standardプラン相当・カード登録不要)を開始する。
// アカウント作成 → 自分をadminとして紐付け → 初期ルームを1つ作成、の実処理は
// lib/accountProvisioning.tsに共通化されている(有料プランを直接選んだ場合の
// Checkout Session作成前にも同じ処理が必要なため)。
export async function startFreeTrial(): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ログインが必要です" };

  const provision = await provisionAccountForUser(supabase, user);
  if (!provision.ok) return provision;

  // 新規作成された場合のみ30日間のトライアルを付与する(既存アカウント
  // なら何もしない=初回のみの保証)。/plan(このServer Actionを呼べる
  // 唯一の画面)は既にアカウントを持つユーザーを/adminへリダイレクトする
  // ため(app/plan/page.tsx)、実質「新規登録時は必ず1回だけ」トライアル
  // が始まる。
  if (provision.created) {
    const trialEndsAt = new Date(
      Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    // plan・trial_ends_at・trial_usedはいずれも権限昇格防止トリガー
    // (consolidated_setup.sql)の対象列のため、service_roleクライアントで
    // 1回のUPDATEにまとめて更新する。
    const { error } = await createServiceRoleClient()
      .from("accounts")
      .update({ plan: "standard", trial_ends_at: trialEndsAt, trial_used: true })
      .eq("id", provision.accountId);
    if (error) return { ok: false, error: "トライアルの開始に失敗しました" };
  }

  return { ok: true };
}
