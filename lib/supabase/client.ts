import { createBrowserClient } from "@supabase/ssr";

// Client Component(ブラウザ)側で使うSupabaseクライアント。
// Cookieベースでセッションを管理するため、ログインボタンなど
// 認証操作を行うコンポーネントはこちらを使う。
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
  );
}
