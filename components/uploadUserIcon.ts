import { createClient } from "@/lib/supabase/client";
import { USER_ICON_MAX_DIMENSION } from "@/lib/types";

// 画像ファイルをCanvasで最大USER_ICON_MAX_DIMENSION四方(アスペクト比は
// 維持、縮小のみ)に変換し、WebP形式のBlobにする。正方形への切り抜きは
// 行わない(アップロード画面側の「正方形の画像推奨」という案内に留める)。
async function resizeImageToWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(
      1,
      USER_ICON_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画像の変換に失敗しました");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.85),
    );
    if (!blob) throw new Error("画像の変換に失敗しました");
    return blob;
  } finally {
    bitmap.close();
  }
}

// アカウント(ユーザー)ごとに1枚だけ保存されるプロフィールアイコンを
// アップロードする。常に同じパス("{userId}/icon.webp")へupsertするため、
// 再アップロードすると自動的に上書きされる。パスが固定のため、上書き後も
// 同じ公開URLになってしまいブラウザ/CDNにキャッシュされた古い画像が
// 表示され続けないよう、戻り値にはキャッシュを回避するクエリパラメータを
// 付けて返す(このURLをそのままprofiles.avatar_icon_url・presence上の
// avatarImageへ保存する)。
export async function uploadUserIconClient(
  userId: string,
  file: File,
): Promise<string> {
  const blob = await resizeImageToWebp(file);
  const supabase = createClient();
  const path = `${userId}/icon.webp`;
  const { error } = await supabase.storage
    .from("user-icons")
    .upload(path, blob, { contentType: "image/webp", upsert: true });
  if (error) {
    throw new Error(`画像のアップロードに失敗しました: ${error.message}`);
  }
  const {
    data: { publicUrl },
  } = supabase.storage.from("user-icons").getPublicUrl(path);
  return `${publicUrl}?v=${Date.now()}`;
}
