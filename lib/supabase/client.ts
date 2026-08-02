import { createBrowserClient } from "@supabase/ssr";
import { SESSION_MAX_AGE } from "./constants";

// Client Component(ブラウザ)側で使うSupabaseクライアント。
// Cookieベースでセッションを管理するため、ログインボタンなど
// 認証操作を行うコンポーネントはこちらを使う。
// セッションCookieの有効期限を24時間に設定し、ブラウザを閉じて
// 再度URLへアクセスしても自動的にログイン状態になるようにしている。
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookieOptions: {
        maxAge: SESSION_MAX_AGE,
      },
    },
  );
}
