"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Obstacle, MeetingZone } from "@/lib/types";

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
export async function createTemplate(name: string, backgroundImageUrl: string) {
  const { supabase } = await requireMaster();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("テンプレート名を入力してください");
  if (!backgroundImageUrl) throw new Error("背景画像を選択してください");

  const { error } = await supabase.from("templates").insert({
    name: trimmed,
    background_image_url: backgroundImageUrl,
  });
  if (error) throw new Error("テンプレートの作成に失敗しました");

  revalidatePath("/master");
}

export async function renameTemplate(templateId: string, name: string) {
  const { supabase } = await requireMaster();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("テンプレート名を入力してください");

  const { error } = await supabase
    .from("templates")
    .update({ name: trimmed })
    .eq("id", templateId);
  if (error) throw new Error("テンプレート名の変更に失敗しました");

  revalidatePath("/master");
}

export async function updateTemplateLayout(
  templateId: string,
  obstacles: Obstacle[],
  meetingZones: MeetingZone[],
  mapWidth: number,
  mapHeight: number,
) {
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
  if (error) throw new Error("レイアウトの保存に失敗しました");

  revalidatePath("/master");
}

export async function replaceTemplateImage(
  templateId: string,
  backgroundImageUrl: string,
) {
  const { supabase } = await requireMaster();
  if (!backgroundImageUrl) throw new Error("画像を選択してください");

  const { error } = await supabase
    .from("templates")
    .update({ background_image_url: backgroundImageUrl })
    .eq("id", templateId);
  if (error) throw new Error("画像の更新に失敗しました");

  revalidatePath("/master");
}

export async function updateAvatarSize(sizePx: number) {
  const { supabase } = await requireMaster();
  if (!Number.isFinite(sizePx) || sizePx < 8 || sizePx > 200) {
    throw new Error("8〜200pxの範囲で入力してください");
  }

  const { error } = await supabase
    .from("app_settings")
    .update({ avatar_size_px: Math.round(sizePx) })
    .eq("id", "default");
  if (error) throw new Error("保存に失敗しました");

  revalidatePath("/master");
  revalidatePath("/rooms");
}

export async function deleteTemplate(templateId: string) {
  const { supabase } = await requireMaster();

  const { count } = await supabase
    .from("rooms")
    .select("id", { count: "exact", head: true })
    .eq("template_id", templateId);
  if ((count ?? 0) > 0) {
    throw new Error(
      "このテンプレートを使用しているルームがあるため削除できません",
    );
  }

  const { error } = await supabase
    .from("templates")
    .delete()
    .eq("id", templateId);
  if (error) {
    throw new Error(`テンプレートの削除に失敗しました: ${error.message}`);
  }

  revalidatePath("/master");
}
