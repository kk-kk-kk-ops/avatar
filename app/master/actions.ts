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

async function uploadTemplateImage(
  supabase: Awaited<ReturnType<typeof requireMaster>>["supabase"],
  file: File,
) {
  const path = `${crypto.randomUUID()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from("template-images")
    .upload(path, file, { contentType: file.type });
  if (uploadError) throw new Error("画像のアップロードに失敗しました");

  const {
    data: { publicUrl },
  } = supabase.storage.from("template-images").getPublicUrl(path);
  return publicUrl;
}

export async function createTemplate(formData: FormData) {
  const { supabase } = await requireMaster();
  const name = String(formData.get("name") ?? "").trim();
  const file = formData.get("image") as File | null;
  if (!name) throw new Error("テンプレート名を入力してください");
  if (!file || file.size === 0) throw new Error("背景画像を選択してください");

  const publicUrl = await uploadTemplateImage(supabase, file);

  const { error } = await supabase.from("templates").insert({
    name,
    background_image_url: publicUrl,
  });
  if (error) throw new Error("テンプレートの作成に失敗しました");

  revalidatePath("/master");
}

export async function updateTemplateLayout(
  templateId: string,
  obstacles: Obstacle[],
  meetingZones: MeetingZone[],
) {
  const { supabase } = await requireMaster();
  const { error } = await supabase
    .from("templates")
    .update({ obstacles, meeting_area: meetingZones })
    .eq("id", templateId);
  if (error) throw new Error("レイアウトの保存に失敗しました");

  revalidatePath("/master");
}

export async function replaceTemplateImage(
  templateId: string,
  formData: FormData,
) {
  const { supabase } = await requireMaster();
  const file = formData.get("image") as File | null;
  if (!file || file.size === 0) throw new Error("画像を選択してください");

  const publicUrl = await uploadTemplateImage(supabase, file);

  const { error } = await supabase
    .from("templates")
    .update({ background_image_url: publicUrl })
    .eq("id", templateId);
  if (error) throw new Error("画像の更新に失敗しました");

  revalidatePath("/master");
  return publicUrl;
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
  if (error) throw new Error("テンプレートの削除に失敗しました");

  revalidatePath("/master");
}
