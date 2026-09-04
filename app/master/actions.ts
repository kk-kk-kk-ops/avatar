"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  Obstacle,
  MeetingZone,
  WarpPoint,
  PlacedObject,
  TemplateObjectImage,
} from "@/lib/types";

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

  // /master/page.tsxのページ表示をバイパスしてServer Actionを直接
  // 呼ばれた場合(盗まれたセッションCookie等)にも備え、MFA設定済み
  // アカウントはここでもaal2を要求する。
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect("/master/mfa-challenge");
  }

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
  spawnPoint: { x: number; y: number } | null,
  warpPoints: WarpPoint[],
  placedObjects: PlacedObject[],
): Promise<ActionResult> {
  const { supabase } = await requireMaster();
  const { error } = await supabase
    .from("templates")
    .update({
      obstacles,
      meeting_area: meetingZones,
      map_width: mapWidth,
      map_height: mapHeight,
      spawn_x: spawnPoint?.x ?? null,
      spawn_y: spawnPoint?.y ?? null,
      warp_points: warpPoints,
      placed_objects: placedObjects,
    })
    .eq("id", templateId);
  if (error) return { ok: false, error: "レイアウトの保存に失敗しました" };

  revalidatePath("/master");
  return { ok: true };
}

// 「オブジェクト登録」ライブラリの更新(登録・削除どちらもクライアント側で
// 配列を組み立てた上でこの1つのアクションを呼ぶ)。壁・エリア等とは異なり、
// レイアウトの「保存」ボタンを待たずに都度即時保存する(背景画像の変更と
// 同じ考え方。エディタを保存せずに閉じても、アップロード済みの登録画像
// 自体は失われないようにするため)。
export async function updateTemplateObjectLibrary(
  templateId: string,
  objectLibrary: TemplateObjectImage[],
): Promise<ActionResult> {
  const { supabase } = await requireMaster();
  const { error } = await supabase
    .from("templates")
    .update({ object_library: objectLibrary })
    .eq("id", templateId);
  if (error)
    return { ok: false, error: "オブジェクトライブラリの更新に失敗しました" };

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
  revalidatePath("/");
  return { ok: true };
}

// 契約(アカウント)に固定で割り当てる物理LiveKitサーバーを、マスターが
// 手動で変更する。同一会社が複数契約する場合に、それぞれを別サーバーへ
// 固定する目的(単一送信元からの同時接続が1サーバーに集中しないようにする)
// で使う。serverIdにnullを渡すと「未割り当て(デフォルトサーバーを使う)」
// に戻せる。
export async function updateAccountLivekitServer(
  accountId: string,
  serverId: string | null,
): Promise<ActionResult> {
  const { supabase } = await requireMaster();

  const { error } = await supabase
    .from("accounts")
    .update({ livekit_server_id: serverId })
    .eq("id", accountId);
  if (error) return { ok: false, error: "サーバー割り当ての変更に失敗しました" };

  revalidatePath("/master");
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
