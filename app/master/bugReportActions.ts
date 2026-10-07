"use server";

import { revalidatePath } from "next/cache";
import { requireMaster } from "./actions";

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
