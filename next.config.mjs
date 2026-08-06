/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ページを常に最新の状態で取得させる(ブラウザ・Vercelのキャッシュを無効化)。
  // これにより、デプロイ後にリロードすればキャッシュクリア不要で最新版が表示される。
  async headers() {
    return [
      {
        // ハッシュ付きファイル名の静的アセット(_next/static)と画像は
        // デプロイごとにファイル名自体が変わるため、キャッシュ無効化は
        // 不要かつ有害(毎回フル再ダウンロードでVercel転送量・体感速度が
        // 悪化する)。ページ本体(HTML/RSC)とAPIだけに絞る。
        source:
          "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate",
          },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ];
  },
};

export default nextConfig;
