"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PLANS } from "@/lib/types";
import { ROOM_TEMPLATES } from "./roomTemplates";

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
  const template =
    ROOM_TEMPLATES.find((t) => t.id === templateId) ?? ROOM_TEMPLATES[0];

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
    name: template.name,
    preview_image: template.previewImage,
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
