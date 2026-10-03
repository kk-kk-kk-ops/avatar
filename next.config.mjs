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
      {
        // 会議室の文字起こし機能(sherpa-onnx、マルチスレッドWASM)が
        // SharedArrayBufferを使うために必要な「クロスオリジン分離」
        // (2026-10追加)。このヘッダーが無いと、WASM側がWeb Workerへの
        // メモリ受け渡しに失敗し、文字起こしが使えない。
        //
        // 2026-10報告: 一度は「声が途切れる」原因としてこのヘッダーを
        // 撤回して検証したが、実際の原因は1台のPCで2アカウント分
        // (2つのLiveKit接続+2つの描画ループ、場合によっては同じ物理
        // マイクへの同時アクセス)を同時に動かすテスト環境の負荷だった
        // ことが、PCとスマホの2台に分けて通話したところ途切れが一切無く
        // なったことで確定した。このヘッダー自体は無関係だったため復元
        // する。
        //
        // このアプリは管理画面・決済・認証フロー以外のほぼ全体(ログイン
        // 画面〜ロビー〜会議室)が単一のページ(/)で構成されており、
        // Next.jsのパス単位のheaders設定では「会議室の画面だけ」を厳密に
        // 切り分けることができない。そのため、影響範囲を調べた上で
        // (ポップアップでのログインは使っていない、iframeも使っていない)
        // admin/billing/auth/master/plan/apiを除く全体に適用している。
        // Cross-Origin-Embedder-Policyは厳格な"require-corp"ではなく
        // "credentialless"を使うことで、既存のクロスオリジン画像
        // (Supabase Storageの画像など、認証情報無しでアクセスできる
        // 公開URL)への影響を避けている。
        source:
          "/((?!admin|billing|auth|master|plan|api|_next|favicon.ico|df3-assets).*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
