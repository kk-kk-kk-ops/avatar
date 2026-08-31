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
        // df3-assets(ノイズ抑制フィルター用のWASM/モデル、計約24MB)も
        // 同じ理由で除外し、下の専用ルールで長めにキャッシュさせる
        // (これが無いとマイクをONにするたびに毎回フル再ダウンロードに
        // なってしまう)。
        source:
          "/((?!_next/static|_next/image|favicon.ico|df3-assets/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate",
          },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        // ノイズ抑制フィルター用のWASM(約16MB)・ONNXモデル(約8MB)。
        // ファイル自体を更新する場合はパスも変える想定(内容が変わって
        // もキャッシュされ続けるリスクを避けるため)なので、長めに
        // キャッシュしてよい。
        source: "/df3-assets/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
