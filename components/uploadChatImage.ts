import { createClient } from "@/lib/supabase/client";
import { CHAT_IMAGE_ALLOWED_MIME_TYPES, CHAT_IMAGE_MAX_BYTES } from "@/lib/types";

export function validateChatImageFile(file: File): string | null {
  if (
    !(CHAT_IMAGE_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)
  ) {
    return "対応していない画像形式です(JPEG/PNG/WebPのみ)";
  }
  if (file.size > CHAT_IMAGE_MAX_BYTES) {
    return "画像サイズは5MBまでです";
  }
  return null;
}

// 生画像を"raw/{自分のuser_id}/{uuid}.ext"へ直接アップロードする
// (uploadTemplateImageClientと同じ理由: Vercelサーバーレス関数の
// リクエストボディ上限(~4.5MB)を回避するため、ブラウザから直接
// Supabase Storageへアップロードする)。圧縮・最終保存は
// /api/chat/compress-imageが別途行う。
export async function uploadRawChatImage(
  file: File,
  myUserId: string,
): Promise<string> {
  const supabase = createClient();
  const extMatch = /\.[a-zA-Z0-9]+$/.exec(file.name);
  const ext = extMatch ? extMatch[0] : "";
  const path = `raw/${myUserId}/${crypto.randomUUID()}${ext}`;
  const { error } = await supabase.storage
    .from("chat-images")
    .upload(path, file, { contentType: file.type });
  if (error) {
    throw new Error(`画像のアップロードに失敗しました: ${error.message}`);
  }
  return path;
}
