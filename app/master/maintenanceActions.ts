"use server";

import { revalidatePath } from "next/cache";
import { requireMaster } from "./actions";

export type ActionResult = { ok: true } | { ok: false; error: string };

// メンテナンス期間(開始・終了日時)だけを保存する。有効/無効の切り替えは
// setMaintenanceEnabled側で別途行う(チェックボックスの確認ポップアップで
// 個別に確定させるため、期間の保存とは分離している)。
export async function updateMaintenanceWindow(
  startsAt: string,
  endsAt: string,
): Promise<ActionResult> {
  const { supabase } = await requireMaster();
  const starts = new Date(startsAt);
  const ends = new Date(endsAt);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
    return { ok: false, error: "開始・終了日時を入力してください" };
  }
  if (starts.getTime() >= ends.getTime()) {
    return { ok: false, error: "終了日時は開始日時より後にしてください" };
  }

  const { error } = await supabase
    .from("app_settings")
    .update({
      maintenance_starts_at: starts.toISOString(),
      maintenance_ends_at: ends.toISOString(),
    })
    .eq("id", "default");
  if (error) return { ok: false, error: "保存に失敗しました" };

  revalidatePath("/master");
  revalidatePath("/admin");
  revalidatePath("/");
  return { ok: true };
}

// メンテナンス予告表示・入室ブロックのON/OFF切り替え(確認ポップアップの
// 「はい」を押した時に呼ばれる)。ONにする際は開始・終了日時が保存済みで
// あることを要求する(未設定のままONにできてしまうと、期間の無い
// メンテナンス表示になってしまうため)。
export async function setMaintenanceEnabled(
  enabled: boolean,
): Promise<ActionResult> {
  const { supabase } = await requireMaster();

  if (enabled) {
    const { data } = await supabase
      .from("app_settings")
      .select("maintenance_starts_at, maintenance_ends_at")
      .eq("id", "default")
      .maybeSingle();
    if (!data?.maintenance_starts_at || !data?.maintenance_ends_at) {
      return { ok: false, error: "先に開始・終了日時を保存してください" };
    }
  }

  const { error } = await supabase
    .from("app_settings")
    .update({ maintenance_enabled: enabled })
    .eq("id", "default");
  if (error) return { ok: false, error: "保存に失敗しました" };

  revalidatePath("/master");
  revalidatePath("/admin");
  revalidatePath("/");
  return { ok: true };
}
