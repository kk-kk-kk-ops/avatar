import { createClient } from "@/lib/supabase/client";
import { CHAT_IMAGE_ALLOWED_MIME_TYPES, CHAT_IMAGE_MAX_BYTES } from "@/lib/types";

const CHAT_IMAGE_MAX_MB = Math.round(CHAT_IMAGE_MAX_BYTES / 1024 / 1024);

export function validateChatImageFile(file: File): string | null {
  if (
    !(CHAT_IMAGE_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)
  ) {
    return "対応していない画像形式です(JPEG/PNG/WebPのみ)";
  }
  if (file.size > CHAT_IMAGE_MAX_BYTES) {
    return `画像サイズは${CHAT_IMAGE_MAX_MB}MBまでです`;
  }
  return null;
}

// 生画像を"raw/{自分のuser_id}/{uuid}.ext"へ直接アップロードする
// (uploadTemplateImageClientと同じ理由: Vercelサーバーレス関数の
// リクエストボディ上限(~4.5MB)を回避するため、ブラウザから直接
// Supabase Storageへアップロードする)。圧縮・最終保存は
// /api/chat/compress-imageが別途行う。
//
// supabase-jsのstorage.upload()はfetchベースで実装されており、
// ブラウザのfetch API自体がアップロード進捗(送信バイト数)を
// 報告する手段を持たない。そのため、進捗表示のためにここでは
// supabase-jsを経由せず、Supabase Storageの公開REST API
// (POST {url}/storage/v1/object/{bucket}/{path})へXMLHttpRequestで
// 直接アップロードし、xhr.upload.onprogressで進捗を取得する
// (URL・ヘッダーの形はsupabase-js storage-jsの実装と同じもの。
// 認証はセッションのaccess_tokenをBearerトークンとして使う。
// RLS("chat-images: insert own raw")がauth.uid()を見るため、
// anon keyだけでは通らずセッショントークンが必要)。
export function uploadRawChatImageWithProgress(
  file: File,
  myUserId: string,
  onProgress: (percent: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    (async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        reject(new Error("認証が必要です"));
        return;
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !anonKey) {
        reject(new Error("Supabaseの設定が不足しています"));
        return;
      }

      const extMatch = /\.[a-zA-Z0-9]+$/.exec(file.name);
      const ext = extMatch ? extMatch[0] : "";
      const path = `raw/${myUserId}/${crypto.randomUUID()}${ext}`;

      const xhr = new XMLHttpRequest();
      xhr.open(
        "POST",
        `${supabaseUrl}/storage/v1/object/chat-images/${path}`,
      );
      xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
      xhr.setRequestHeader("apikey", anonKey);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(100);
          resolve(path);
        } else {
          reject(
            new Error(`画像のアップロードに失敗しました(status ${xhr.status})`),
          );
        }
      };
      xhr.onerror = () => {
        reject(new Error("画像のアップロードに失敗しました"));
      };
      xhr.send(file);
    })().catch(reject);
  });
}
