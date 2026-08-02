/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ページを常に最新の状態で取得させる(ブラウザ・Vercelのキャッシュを無効化)。
  // これにより、デプロイ後にリロードすればキャッシュクリア不要で最新版が表示される。
  async headers() {
    return [
      {
        source: "/:path*",
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
