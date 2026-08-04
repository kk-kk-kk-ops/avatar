import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_MAX_AGE } from "./constants";

// 認証不要でアクセスできるパス("/"はTOPページ。ログイン済みなら
// page.tsx側でプラン選択/管理画面/ルーム選択へ振り分ける)
const PUBLIC_PATHS = ["/", "/auth/callback"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({
            name,
            value,
            ...options,
            maxAge: SESSION_MAX_AGE,
          });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // 未ログインで、ログイン不要なページ以外へアクセスした場合はTOPへ
  if (!user && !isPublicPath(pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}
