import { createClient } from "@/lib/supabase/client";

// テンプレートの背景画像アップロードは、Server Action経由(ブラウザ→Vercelの
// サーバー関数→Supabase)ではなく、ブラウザから直接Supabase Storageへ行う。
// Server Actionsのボディサイズ上限を引き上げても、Vercelのサーバーレス
// 関数自体のリクエストボディ上限(~4.5MB)は超えられず、少し大きめの背景
// 画像でアップロードが失敗していたため。画像を直接アップロードし、
// Server Actionには結果のURL文字列だけを渡すことでこの上限を回避する。
export async function uploadTemplateImageClient(file: File): Promise<string> {
  const supabase = createClient();
  const path = `${crypto.randomUUID()}-${file.name}`;
  const { error } = await supabase.storage
    .from("template-images")
    .upload(path, file, { contentType: file.type });
  if (error) throw new Error("画像のアップロードに失敗しました");

  const {
    data: { publicUrl },
  } = supabase.storage.from("template-images").getPublicUrl(path);
  return publicUrl;
}
