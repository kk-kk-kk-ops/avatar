"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PLANS, type PlanId } from "@/lib/types";

// Server Actionのエラーはproduction buildだと.messageが汎用文言に
// 差し替えられてしまう(Next.jsの仕様)ため、debugSetPlanだけは
// throwではなく戻り値で成否とエラーメッセージを伝える
// (app/master/actions.tsと同じ方針。他の関数は既存のまま据え置く)。
type ActionResult = { ok: true } | { ok: false; error: string };

// デバッグ用プラン切り替えで選べる5プラン(masterは対象外)。
const DEBUG_SWITCHABLE_PLANS: PlanId[] = [
  "free",
  "light",
  "standard",
  "pro",
  "business",
];

async function requireAdminAccount() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: account } = await supabase
    .from("accounts")
    .select("id, plan")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (!account) redirect("/plan");

  return { supabase, account };
}

export async function addRoom(templateId: string) {
  const { supabase, account } = await requireAdminAccount();

  const { data: template } = await supabase
    .from("templates")
    .select("id, name, background_image_url")
    .eq("id", templateId)
    .maybeSingle();
  if (!template) throw new Error("テンプレートが見つかりません");

  const { count } = await supabase
    .from("rooms")
    .select("id", { count: "exact", head: true })
    .eq("account_id", account.id);

  const maxRooms = PLANS[account.plan as keyof typeof PLANS].maxRooms;
  if ((count ?? 0) >= maxRooms) {
    throw new Error(
      `現在のプランではルームを${maxRooms}個までしか作成できません。プランを変更してください。`,
    );
  }

  const { error } = await supabase.from("rooms").insert({
    account_id: account.id,
    template_id: template.id,
    name: template.name,
    preview_image: template.background_image_url,
  });
  if (error) throw new Error("ルームの作成に失敗しました");

  revalidatePath("/admin");
}

export async function renameRoom(roomId: string, name: string) {
  const { supabase, account } = await requireAdminAccount();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("ルーム名を入力してください");

  const { error } = await supabase
    .from("rooms")
    .update({ name: trimmed })
    .eq("id", roomId)
    .eq("account_id", account.id);
  if (error) throw new Error("ルーム名の変更に失敗しました");

  revalidatePath("/admin");
}

export async function deleteRoom(roomId: string) {
  const { supabase, account } = await requireAdminAccount();

  const { error } = await supabase
    .from("rooms")
    .delete()
    .eq("id", roomId)
    .eq("account_id", account.id);
  if (error) throw new Error("ルームの削除に失敗しました");

  revalidatePath("/admin");
}

// 招待URLのトークンを再発行する(古いURLは自動的に無効になる)
export async function regenerateInviteToken() {
  const { supabase, account } = await requireAdminAccount();
  const newToken = crypto.randomUUID().replace(/-/g, "");

  const { error } = await supabase
    .from("accounts")
    .update({ invite_token: newToken })
    .eq("id", account.id);
  if (error) throw new Error("招待URLの再発行に失敗しました");

  revalidatePath("/admin");
}

// 招待URLからログイン画面に遷移したときに表示する招待者名
// (「〇〇〇さんからの招待」の〇〇〇部分)を設定する。
export async function updateInviteInviterName(name: string) {
  const { supabase, account } = await requireAdminAccount();
  const trimmed = name.trim();

  const { error } = await supabase
    .from("accounts")
    .update({ invite_inviter_name: trimmed || null })
    .eq("id", account.id);
  if (error) throw new Error("招待者名の更新に失敗しました");

  revalidatePath("/admin");
}

// デバッグ用: 環境変数DEBUG_PLAN_SWITCH_EMAILに一致するアカウントだけが、
// 自分のプランを5プランの中から自由に切り替えられる(動作確認用)。
// クライアント側の表示制御(app/admin/page.tsxのisDebugPlanSwitcherAllowed)
// とは別に、ここでも必ずメールアドレスを再検証する
// (Server Actionは表示上のUIに関わらず直接呼び出せるため)。
//
// 注意: supabase/consolidated_setup.sqlのセクション10は、is_master=trueの
// ユーザーが所有するアカウントのplanを毎回'master'へ強制的に戻す。
// そのため、このデバッグ切り替えで選んだプランは、consolidated_setup.sql
// を再実行すると'master'に巻き戻る(意図的な既存の挙動であり、この関数の
// バグではない)。
export async function debugSetPlan(planId: PlanId): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ログインが必要です" };

  const allowedEmail = process.env.DEBUG_PLAN_SWITCH_EMAIL;
  if (!allowedEmail || user.email !== allowedEmail) {
    return { ok: false, error: "この機能を利用する権限がありません" };
  }

  if (!DEBUG_SWITCHABLE_PLANS.includes(planId)) {
    return { ok: false, error: "不正なプランです" };
  }

  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (!account) return { ok: false, error: "アカウントが見つかりません" };

  const { error } = await supabase
    .from("accounts")
    .update({ plan: planId })
    .eq("id", account.id);
  if (error) return { ok: false, error: "プランの更新に失敗しました" };

  revalidatePath("/admin");
  return { ok: true };
}
