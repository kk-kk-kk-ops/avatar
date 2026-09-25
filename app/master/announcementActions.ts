"use server";

import { revalidatePath } from "next/cache";
import { requireMaster } from "./actions";

// Server Actionのエラーはproduction buildだと.messageが汎用文言に
// 差し替えられてしまう(Next.jsの仕様)ため、throwではなく戻り値で
// 成否とエラーメッセージを伝える(app/master/actions.tsと同じ方針)。
export type ActionResult = { ok: true } | { ok: false; error: string };

// 日付入力(<input type="date">の"YYYY-MM-DD")をtimestamptzへ変換する。
// 空文字・不正な値の場合は現在日時を使う(未入力でも登録できるようにする)。
function toTimestamp(dateInput: string): string {
  const parsed = new Date(dateInput);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export async function createAnnouncement(
  title: string,
  body: string,
  publishedAt: string,
): Promise<ActionResult> {
  const { supabase } = await requireMaster();
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  if (!trimmedTitle) return { ok: false, error: "タイトルを入力してください" };
  if (!trimmedBody) return { ok: false, error: "本文を入力してください" };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("announcements").insert({
    title: trimmedTitle,
    body: trimmedBody,
    published_at: toTimestamp(publishedAt),
    created_by: user?.id ?? null,
  });
  if (error) return { ok: false, error: "お知らせの作成に失敗しました" };

  revalidatePath("/master");
  return { ok: true };
}

export async function updateAnnouncement(
  id: string,
  title: string,
  body: string,
  publishedAt: string,
): Promise<ActionResult> {
  const { supabase } = await requireMaster();
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  if (!trimmedTitle) return { ok: false, error: "タイトルを入力してください" };
  if (!trimmedBody) return { ok: false, error: "本文を入力してください" };

  const { error } = await supabase
    .from("announcements")
    .update({
      title: trimmedTitle,
      body: trimmedBody,
      published_at: toTimestamp(publishedAt),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: "お知らせの更新に失敗しました" };

  revalidatePath("/master");
  return { ok: true };
}

export async function deleteAnnouncement(id: string): Promise<ActionResult> {
  const { supabase } = await requireMaster();

  const { error } = await supabase.from("announcements").delete().eq("id", id);
  if (error) return { ok: false, error: "お知らせの削除に失敗しました" };

  revalidatePath("/master");
  return { ok: true };
}
