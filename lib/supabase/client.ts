import { createBrowserClient } from "@supabase/ssr";
import { SESSION_MAX_AGE } from "./constants";

// Client Component(ブラウザ)側で使うSupabaseクライアント。
// Cookieベースでセッションを管理するため、ログインボタンなど
// 認証操作を行うコンポーネントはこちらを使う。
// セッションCookieの有効期限を24時間に設定し、ブラウザを閉じて
// 再度URLへアクセスしても自動的にログイン状態になるようにしている。
//
// AvatarSpace.tsx のRealtime接続(位置情報のbroadcast等)もこのクライアントを
// 使う。以前は@supabase/supabase-jsの素のcreateClient(セッションを持たない
// クライアント)を別途使っており、auth.uid()がRLS側で常にnullになって
// しまっていた。map_layoutテーブルのRLSを「ログイン済みユーザーのみ」に
// 絞るため、ログインセッションを持つこちらのクライアントに統一している。
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookieOptions: {
        maxAge: SESSION_MAX_AGE,
      },
      // 位置情報のbroadcastは最大14回/秒程度送るため、デフォルトの
      // eventsPerSecond(10)だとクライアント側で間引かれてしまう。
      // 旧lib/supabase.tsで設定していた値を引き継ぐ。
      realtime: {
        params: {
          eventsPerSecond: 80,
        },
      },
    },
  );
}
