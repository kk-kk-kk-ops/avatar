import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server Component / Route Handler側で使うSupabaseクライアント。
// Next.jsのcookies()を介してセッション情報を読み書きする。
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Server Componentから呼ばれた場合はcookieを書き込めないことがある。
            // middleware側でセッションのリフレッシュを行うため無視して問題ない。
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // 上記と同様の理由で無視する
          }
        },
      },
    }
  );
}
