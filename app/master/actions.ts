"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Obstacle, MeetingZone } from "@/lib/types";

// Server Actionからthrowしたエラーは、本番ビルドでは詳細メッセージが
// Next.jsによって「An error occurred in the Server Components render...」
// という汎用文言に置き換えられてしまい、「このテンプレートを使用している
// ルームがあるため削除できません」のような、ユーザーに見せるべき具体的な
// 理由が伝わらなくなる。そのため各アクションはthrowせず、成功/失敗を
// この型で返し、呼び出し側はresult.okを見て表示する。
export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireMaster() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_master")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.is_master) redirect("/");

  return { supabase };
}

// 画像自体はクライアント側からSupabase Storageへ直接アップロード済み
// (uploadTemplateImageClient参照)。ここではURL文字列を受け取ってDBに
// 保存するだけ。
export async function createTemplate(
  name: string,
  backgroundImageUrl: string,
): Promise<ActionResult> {
  const { supabase } = await requireMaster();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "テンプレート名を入力してください" };
  if (!backgroundImageUrl)
    return { ok: false, error: "背景画像を選択してください" };

  const { error } = await supabase.from("templates").insert({
    name: trimmed,
    background_image_url: backgroundImageUrl,
  });
  if (error) return { ok: false, error: "テンプレートの作成に失敗しました" };

  revalidatePath("/master");
  return { ok: true };
}

export async function renameTemplate(
  templateId: string,
  name: string,
): Promise<ActionResult> {
  const { supabase } = await requireMaster();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "テンプレート名を入力してください" };

  const { error } = await supabase
    .from("templates")
    .update({ name: trimmed })
    .eq("id", templateId);
  if (error) return { ok: false, error: "テンプレート名の変更に失敗しました" };

  revalidatePath("/master");
  return { ok: true };
}

export async function updateTemplateLayout(
  templateId: string,
  obstacles: Obstacle[],
  meetingZones: MeetingZone[],
  mapWidth: number,
  mapHeight: number,
): Promise<ActionResult> {
  const { supabase } = await requireMaster();
  const { error } = await supabase
    .from("templates")
    .update({
      obstacles,
      meeting_area: meetingZones,
      map_width: mapWidth,
      map_height: mapHeight,
    })
    .eq("id", templateId);
  if (error) return { ok: false, error: "レイアウトの保存に失敗しました" };

  revalidatePath("/master");
  return { ok: true };
}

export async function replaceTemplateImage(
  templateId: string,
  backgroundImageUrl: string,
): Promise<ActionResult> {
  const { supabase } = await requireMaster();
  if (!backgroundImageUrl) return { ok: false, error: "画像を選択してください" };

  const { error } = await supabase
    .from("templates")
    .update({ background_image_url: backgroundImageUrl })
    .eq("id", templateId);
  if (error) return { ok: false, error: "画像の更新に失敗しました" };

  revalidatePath("/master");
  return { ok: true };
}

export async function updateAvatarSize(sizePx: number): Promise<ActionResult> {
  const { supabase } = await requireMaster();
  if (!Number.isFinite(sizePx) || sizePx < 8 || sizePx > 200) {
    return { ok: false, error: "8〜200pxの範囲で入力してください" };
  }

  const { error } = await supabase
    .from("app_settings")
    .update({ avatar_size_px: Math.round(sizePx) })
    .eq("id", "default");
  if (error) return { ok: false, error: "保存に失敗しました" };

  revalidatePath("/master");
  revalidatePath("/rooms");
  return { ok: true };
}

export async function deleteTemplate(templateId: string): Promise<ActionResult> {
  const { supabase } = await requireMaster();

  const { count } = await supabase
    .from("rooms")
    .select("id", { count: "exact", head: true })
    .eq("template_id", templateId);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: "このテンプレートを使用しているルームがあるため削除できません",
    };
  }

  const { error } = await supabase
    .from("templates")
    .delete()
    .eq("id", templateId);
  if (error) {
    return {
      ok: false,
      error: `テンプレートの削除に失敗しました: ${error.message}`,
    };
  }

  revalidatePath("/master");
  return { ok: true };
}
