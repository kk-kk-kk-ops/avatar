// マスター画面「サーバーリソース一覧」表に表示するサーバーの設定。
// 行を追加するだけで表にサーバーを増やせるように、種別ごとに必要な
// 情報だけを持つ配列にしている。
//
// - "redis-tcp": TCP接続確認のみ(稼働中/停止中のみ表示)。パスワード認証は
//   行わない(Vercelに新規Secretを増やさないための判断。詳細はPLAN参照)。
// - "node-exporter": 既存のMETRICS_URL / METRICS_BASIC_AUTH_USER /
//   METRICS_BASIC_AUTH_PASSWORD(grovina-livekit-prod用)からフル指標を取得する。
//   prod②等を追加する場合は、サーバーごとに環境変数を分けたうえで
//   app/api/master/server-metrics/route.tsのnode-exporter取得処理をidで
//   分岐させる必要がある(今回はprod①のみのため分岐は未実装)。
export type ServerRowConfig =
  | { id: string; name: string; kind: "redis-tcp"; host: string; port: number }
  | { id: string; name: string; kind: "node-exporter" };

export const SERVER_ROWS: ServerRowConfig[] = [
  {
    id: "redis-1",
    name: "grovina-livekit-redis①",
    kind: "redis-tcp",
    host: "161.34.34.53",
    port: 6379,
  },
  {
    id: "prod-1",
    name: "grovina-livekit-prod①",
    kind: "node-exporter",
  },
];
