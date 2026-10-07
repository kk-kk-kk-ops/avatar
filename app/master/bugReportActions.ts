"use server";

import { revalidatePath } from "next/cache";
import { requireMaster } from "./actions";
import { BUG_REPORT_STATUSES, type BugReportStatus } from "@/lib/types";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function markBugReportRead(id: string): Promise<ActionResult> {
  const { supabase } = await requireMaster();

  const { error } = await supabase
    .from("bug_reports")
    .update({ is_read: true })
    .eq("id", id);
  if (error) return { ok: false, error: "既読の更新に失敗しました" };

  revalidatePath("/master");
  return { ok: true };
}

export async function updateBugReportStatus(
  id: string,
  status: BugReportStatus,
): Promise<ActionResult> {
  if (!BUG_REPORT_STATUSES.includes(status)) {
    return { ok: false, error: "不正なステータスです" };
  }
  const { supabase } = await requireMaster();

  const { error } = await supabase
    .from("bug_reports")
    .update({ status })
    .eq("id", id);
  if (error) return { ok: false, error: "ステータスの更新に失敗しました" };

  revalidatePath("/master");
  return { ok: true };
}
