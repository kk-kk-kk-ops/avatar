// 複数の物理LiveKitサーバーを扱うための設定。lib/serverMetricsConfig.tsと
// 同じ「コードが唯一の情報源」方針で、行を足すだけでサーバーを増やせる。
//
// 単一送信元からの同時接続50人規模で、WebARENA Indigo側のネットワーク機器が
// 異常検知して通信を遮断する現象が負荷テストで判明した(deploy/livekit/
// LOAD_TEST_PLAN.md参照)。そのため、契約(アカウント)ごとに固定の物理
// サーバーへ割り当てる方式にした(動的な人数監視による振り分けは行わない。
// 「同じ部屋にいるのに音声だけ分断される」利用者が出ることを避けるため)。
export type LivekitServerConfig = {
  id: string;
  label: string; // マスター画面表示用
  urlEnv: string;
  apiKeyEnv: string;
  apiSecretEnv: string;
};

// 先頭のnode-1は既存のLIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRETを
// そのまま使うため、サーバーを1台追加するまでVercelの環境変数は変更不要。
// 2台目以降を実際に用意する際は、Vercelに LIVEKIT_URL_2 / LIVEKIT_API_KEY_2 /
// LIVEKIT_API_SECRET_2 のような環境変数を追加し、ここに1行足すだけでよい。
export const LIVEKIT_SERVERS: LivekitServerConfig[] = [
  {
    id: "node-1",
    label: "grovina-livekit-prod①",
    urlEnv: "LIVEKIT_URL",
    apiKeyEnv: "LIVEKIT_API_KEY",
    apiSecretEnv: "LIVEKIT_API_SECRET",
  },
];

export const DEFAULT_LIVEKIT_SERVER_ID = LIVEKIT_SERVERS[0].id;

// アカウントに割り当てられたlivekit_server_id(未割り当てならnull)から、
// 実際に接続すべきLiveKitサーバーの認証情報を解決する。該当するサーバーが
// 見つからない場合(設定ミス・未割り当て等)は先頭のサーバーにフォールバック
// する(前回のテンプレート初期位置と同じ、nullable+アプリ側フォールバックの方針)。
export function resolveLivekitServerCredentials(serverId: string | null): {
  serverId: string;
  url: string | undefined;
  apiKey: string | undefined;
  apiSecret: string | undefined;
} {
  const config =
    LIVEKIT_SERVERS.find((s) => s.id === serverId) ?? LIVEKIT_SERVERS[0];
  return {
    serverId: config.id,
    url: process.env[config.urlEnv],
    apiKey: process.env[config.apiKeyEnv],
    apiSecret: process.env[config.apiSecretEnv],
  };
}
