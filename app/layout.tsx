import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import { getServerLocale } from "@/lib/i18n/getServerLocale";
import { VersionWatcherProvider } from "@/components/VersionWatcherProvider";
import { TRIAL_DAYS } from "@/lib/types";

// og:image等の相対パスを絶対URLへ解決するために必要(未設定だとLINE等の
// 外部サービスがプレビュー画像を取得できない)。本番の独自ドメイン固定
// (2026-11-28、SEO設定でVercelの既定ドメインから変更)。
const SITE_URL = "https://globy.grovina-studio.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // defaultは子ページがtitleを指定しない場合に使われる値、templateは
  // 子ページが文字列のtitleを指定した時に自動で付く接尾辞(2026-11-28、
  // SEO設定)。ページ自身が「Globy」を含む完全な見出しを出したい場合は、
  // 子ページ側でtitle: { absolute: "..." }を使ってtemplateを無効化する
  // (app/lp/page.tsx参照)。
  title: {
    default: "Globy(グロビー)｜アバターで集まるオンラインオフィス",
    template: "%s｜Globy",
  },
  // 指示文の原文は「まずは30日間無料で試せます」だったが、TRIAL_DAYS
  // (14日、2026-11-27変更)と食い違うため、他の画面と同じくTRIAL_DAYSから
  // 作る文言にした。
  description: `Globyは、アバターで集まり、話し、つながるオンラインオフィスです。近づくだけで会話が始まり、会議室・画面共有・チャットもひとつに。ブラウザですぐ使えて、まずは${TRIAL_DAYS}日間無料で試せます。`,
  // アイコン(ファビコン等)はapp/favicon.ico・app/icon.png・app/apple-icon.png
  // からNext.jsが自動で<link rel="icon">等を出すため、ここでは指定しない
  // (2026-11-28、SEO設定。手動指定と二重になるのを避ける)。
  openGraph: {
    siteName: "Globy",
    locale: "ja_JP",
    type: "website",
    images: ["/icon.png"],
  },
  twitter: {
    card: "summary_large_image",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = getServerLocale();
  return (
    <html lang={locale}>
      <body>
        <LocaleProvider initialLocale={locale}>
          <VersionWatcherProvider>{children}</VersionWatcherProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
