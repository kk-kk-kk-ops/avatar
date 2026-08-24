import type { Metadata, Viewport } from "next";
import "./globals.css";

// og:image等の相対パスを絶対URLへ解決するために必要(未設定だとLINE等の
// 外部サービスがプレビュー画像を取得できない)。本番のVercel URL固定。
const SITE_URL = "https://avatar-pi-dun.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Globy",
  description: "Globyの2Dアバタースペース (Next.js + Supabase)",
  // logo-icon.pngはlogo.png(透過背景)に白丸の背景を敷いたもの
  // (public/logo.pngから生成)。ダークなタブ背景でも視認できるようにする。
  icons: {
    icon: "/logo-icon.png",
    apple: "/logo-icon.png",
  },
  openGraph: {
    title: "Globy",
    description: "Globyの2Dアバタースペース (Next.js + Supabase)",
    siteName: "Globy",
    images: ["/logo-icon.png"],
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Globy",
    description: "Globyの2Dアバタースペース (Next.js + Supabase)",
    images: ["/logo-icon.png"],
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
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
