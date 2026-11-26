import { createClient } from "@/lib/supabase/client";

// ②-2 ロビーでのロゴ差し替え(2026-11追加)用の、サーバー側で縮める前の
// 生画像アップロード。形式の検証(PNG/JPEG/WebPのみ、SVGは拒否)・長い辺
// 1600px以下への縮小・WebP変換・プランの確認はreplaceRoomLogo(Server
// Action)がサービスロールで行うため、ここでは「10MB以下か」のクライアント
// 側チェックだけ行い、元のファイルをそのままroom-logosバケットの
// "{roomId}/raw/"配下へ直接アップロードする(app/master/
// uploadTemplateImage.tsのuploadTemplateLogoRawImageClientと同じ方針。
// Server Actions経由にしないのもテンプレートのロゴと同じ理由)。戻り値は
// Storage上のパス(公開URLではない。Server Action側がサービスロールで
// downloadするための位置情報として使う)。
const MAX_ROOM_LOGO_RAW_IMAGE_BYTES = 10 * 1024 * 1024;

export async function uploadRoomLogoRawImageClient(
  roomId: string,
  file: File,
): Promise<string> {
  const isPng = file.type === "image/png" || /\.png$/i.test(file.name);
  const isJpeg = file.type === "image/jpeg" || /\.(jpe?g)$/i.test(file.name);
  const isWebp = file.type === "image/webp" || /\.webp$/i.test(file.name);
  if (!isPng && !isJpeg && !isWebp) {
    throw new Error("PNG・JPEG・WebP形式の画像のみ登録できます");
  }
  if (file.size > MAX_ROOM_LOGO_RAW_IMAGE_BYTES) {
    throw new Error("画像は10MB以下にしてください");
  }
  const contentType = isPng
    ? "image/png"
    : isJpeg
      ? "image/jpeg"
      : "image/webp";
  const supabase = createClient();
  const extMatch = /\.[a-zA-Z0-9]+$/.exec(file.name);
  const ext = extMatch ? extMatch[0] : "";
  const path = `${roomId}/raw/${crypto.randomUUID()}${ext}`;
  const { error } = await supabase.storage
    .from("room-logos")
    .upload(path, file, { contentType });
  if (error) {
    throw new Error(`画像のアップロードに失敗しました: ${error.message}`);
  }
  return path;
}
