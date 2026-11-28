import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_MAX_AGE } from "./constants";

// 認証不要でアクセスできるパス("/"はTOPページ。ログイン済みなら
// page.tsx側でプラン選択/管理画面/ルーム選択へ振り分ける。
// "/admin/login"はセッションの有無を無視して常にログインカードを
// 表示する管理者ログイン専用URL。"/lp"・"/terms"・"/privacy"・
// "/tokushoho"はLP・利用規約・プライバシーポリシー・特定商取引法に
// 基づく表記(2026-10追加)。"/login"・"/signup"はログイン・新規登録
// 専用URL、"/contact"はお問い合わせページ(いずれも2026-10末追加)。
// "/features"・"/pricing"・"/security"・"/operator"はLPのヘッダー・
// フッターから飛ぶ別ページ(2026-11-27〜28追加)。"/robots.txt"・
// "/sitemap.xml"は検索エンジン向けのファイル(2026-11-28追加。未ログインの
// クローラーからのアクセスがここで弾かれ"/"へ転送されてしまい、
// 検索エンジンが一切読めなくなる不具合があったため追加)。未ログインでも
// 見られる必要がある)
const PUBLIC_PATHS = [
  "/",
  "/auth/callback",
  "/admin/login",
  "/lp",
  "/terms",
  "/privacy",
  "/tokushoho",
  "/login",
  "/signup",
  "/contact",
  "/features",
  "/pricing",
  "/security",
  "/operator",
  "/robots.txt",
  "/sitemap.xml",
];

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
    // TODO: 全環境の差し替えが終わったら右側のフォールバックを削除する
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) as string,
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

  // 未ログインで、ログイン不要なページ以外へアクセスした場合はTOPへ。
  // クエリ文字列(招待URLの?invite=トークン等)は保持したままリダイレクト
  // する。保持しないと、LINEアプリ内ブラウザ等で一度ログインまで進んだ
  // 招待URLを、セッションCookieを共有しない別のブラウザで開いたときに
  // invite情報が失われ、ゲスト用ログイン画面ではなく素のTOPページ
  // (管理者用ログイン画面)に飛んでしまう不具合があった。
  if (!user && !isPublicPath(pathname)) {
    const redirectUrl = new URL("/", request.url);
    redirectUrl.search = request.nextUrl.search;
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
