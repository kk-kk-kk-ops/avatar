import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * 以下を除くすべてのリクエストパスにマッチ:
     * - _next/static (静的ファイル)
     * - _next/image (画像最適化ファイル)
     * - favicon.ico
     * - 画像ファイル(png, svg, jpg, jpeg, gif, webp)
     * - api/ (Route Handlerは全てCookieセッションに依存せず自前で認証
     *   している。ここでマッチさせると、Cookieを持たないリクエスト
     *   (Vercel Cronからのcurl等)がuser=nullとして"/"へ307
     *   リダイレクトされてしまう不具合があったため除外する)
     */
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:png|svg|jpg|jpeg|gif|webp)$).*)",
  ],
};
