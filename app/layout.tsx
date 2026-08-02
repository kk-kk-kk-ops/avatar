import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grovina Office",
  description: "Grovina Officeの2Dアバタースペース (Next.js + Supabase)",
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
