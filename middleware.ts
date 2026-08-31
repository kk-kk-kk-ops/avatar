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
     * - df3-assets/ (ノイズ抑制フィルター用のWASM/モデルファイル。
     *   public/配下の静的ファイルだが上記に含まれず、認証チェックに
     *   引っかかって未ログイン時に"/"へリダイレクトされてしまって
     *   いた。マイクON操作(=ログイン後)からのfetchのみが対象で、
     *   本来この認証チェックは不要な純粋な静的アセットのため除外する)
     */
    "/((?!_next/static|_next/image|favicon.ico|df3-assets/|api/|.*\\.(?:png|svg|jpg|jpeg|gif|webp)$).*)",
  ],
};
