import { createClient } from "@/lib/supabase/client";

// テンプレートの背景画像アップロードは、Server Action経由(ブラウザ→Vercelの
// サーバー関数→Supabase)ではなく、ブラウザから直接Supabase Storageへ行う。
// Server Actionsのボディサイズ上限を引き上げても、Vercelのサーバーレス
// 関数自体のリクエストボディ上限(~4.5MB)は超えられず、少し大きめの背景
// 画像でアップロードが失敗していたため。画像を直接アップロードし、
// Server Actionには結果のURL文字列だけを渡すことでこの上限を回避する。
export async function uploadTemplateImageClient(file: File): Promise<string> {
  const supabase = createClient();
  // 元のファイル名(日本語を含むことがある)をそのままStorageのパスに使うと
  // URLエンコーディングの問題でアップロードが失敗することがあるため、
  // 拡張子だけを取り出しランダムなファイル名にする。
  const extMatch = /\.[a-zA-Z0-9]+$/.exec(file.name);
  const ext = extMatch ? extMatch[0] : "";
  const path = `${crypto.randomUUID()}${ext}`;
  const { error } = await supabase.storage
    .from("template-images")
    .upload(path, file, { contentType: file.type });
  if (error) {
    throw new Error(`画像のアップロードに失敗しました: ${error.message}`);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("template-images").getPublicUrl(path);
  return publicUrl;
}

// ロゴ区画(2026-11追加)用の、サーバー側で縮める前の生画像アップロード。
// 形式の検証(PNG/JPEG/WebPのみ、SVGは拒否)・長い辺1600px以下への縮小・
// WebP変換はreplaceTemplateDefaultLogo(Server Action)がサービスロールで
// 行うため、ここでは「10MB以下か」のクライアント側チェックだけ行い、
// 元のファイルをそのまま"logos/raw/"配下へ直接アップロードする(背景
// 画像と同じ理由でServer Actions経由にはしない)。戻り値はStorage上の
// パス(公開URLではない。Server Action側がサービスロールでdownloadする
// ための位置情報として使う)。
const MAX_LOGO_RAW_IMAGE_BYTES = 10 * 1024 * 1024;

export async function uploadTemplateLogoRawImageClient(
  file: File,
): Promise<string> {
  const isPng = file.type === "image/png" || /\.png$/i.test(file.name);
  const isJpeg =
    file.type === "image/jpeg" || /\.(jpe?g)$/i.test(file.name);
  const isWebp = file.type === "image/webp" || /\.webp$/i.test(file.name);
  if (!isPng && !isJpeg && !isWebp) {
    throw new Error("PNG・JPEG・WebP形式の画像のみ登録できます");
  }
  if (file.size > MAX_LOGO_RAW_IMAGE_BYTES) {
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
  const path = `logos/raw/${crypto.randomUUID()}${ext}`;
  const { error } = await supabase.storage
    .from("template-images")
    .upload(path, file, { contentType });
  if (error) {
    throw new Error(`画像のアップロードに失敗しました: ${error.message}`);
  }
  return path;
}

// 「オブジェクト登録」用の透過PNG/WEBP画像アップロード(2026-09追加、
// 2026-11にWEBPも許可)。背景画像と同じバケット(template-images)を
// 使うが、"objects/"配下に分けて置く(バケット自体のMIME制限は背景画像と
// 共用のため付けられない。PNG/WEBPのみという制約はここでのクライアント側
// チェックで担保する)。
export async function uploadTemplateObjectImageClient(
  file: File,
): Promise<string> {
  const isPng = file.type === "image/png" || /\.png$/i.test(file.name);
  const isWebp = file.type === "image/webp" || /\.webp$/i.test(file.name);
  if (!isPng && !isWebp) {
    throw new Error("PNGまたはWEBP形式の画像のみ登録できます");
  }
  const contentType = isWebp ? "image/webp" : "image/png";
  const ext = isWebp ? "webp" : "png";
  const supabase = createClient();
  const path = `objects/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("template-images")
    .upload(path, file, { contentType });
  if (error) {
    throw new Error(`画像のアップロードに失敗しました: ${error.message}`);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("template-images").getPublicUrl(path);
  return publicUrl;
}
