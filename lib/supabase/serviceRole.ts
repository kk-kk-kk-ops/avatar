import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// service_roleキーを使う特権クライアント。RLS、および
// role/is_master/planの自己書き換えを防ぐDBトリガー
// (supabase/consolidated_setup.sql参照)の両方をバイパスできる。
// アプリ側で権限チェック済みの処理から、role/is_master/planなど
// 「ユーザー自身には直接書き換えさせたくない列」を更新する
// ピンポイントの書き込みにのみ使うこと。ブラウザには絶対に渡さない
// (サーバー専用。Server Action/Route Handlerからのみ呼び出す)。
export function createServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
