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

// 「オブジェクト登録」用の透過PNG画像アップロード(2026-09追加)。背景画像と
// 同じバケット(template-images)を使うが、"objects/"配下に分けて置く
// (バケット自体のMIME制限は背景画像と共用のため付けられない。透過PNGのみ
// という制約はここでのクライアント側チェックで担保する)。
export async function uploadTemplateObjectImageClient(
  file: File,
): Promise<string> {
  const isPng =
    file.type === "image/png" || /\.png$/i.test(file.name);
  if (!isPng) {
    throw new Error("PNG形式の画像のみ登録できます");
  }
  const supabase = createClient();
  const path = `objects/${crypto.randomUUID()}.png`;
  const { error } = await supabase.storage
    .from("template-images")
    .upload(path, file, { contentType: "image/png" });
  if (error) {
    throw new Error(`画像のアップロードに失敗しました: ${error.message}`);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("template-images").getPublicUrl(path);
  return publicUrl;
}
