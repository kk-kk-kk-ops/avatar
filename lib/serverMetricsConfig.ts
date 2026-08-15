// マスター画面「サーバーリソース一覧」表に表示するサーバーの設定。
// 行を追加するだけで表にサーバーを増やせるように、種別ごとに必要な
// 情報だけを持つ配列にしている。
//
// - "redis-tcp": Redisの稼働状況を、prod-1(grovina-livekit-prod)のnode_exporter
//   経由で取得する(redis_upというtextfile collectorメトリクス。cronで
//   grovina-livekit-prod上のcheck-redis.shが1分おきに書き出す)。
//   VercelからRedis(161.34.34.53:6379)へ直接TCP接続する方式だったが、
//   WebARENA Indigo側のネットワークで外部からの到達がブロックされており
//   常に「停止中」に誤表示される不具合があったため、実際にRedisへ到達
//   できているgrovina-livekit-prod経由の間接確認に切り替えた
//   (2026-08、詳細はマスター画面の調査経緯を参照)。kind名は元のまま
//   残しているが、直接のTCP接続は行っていない点に注意。
// - "node-exporter": 既存のMETRICS_URL / METRICS_BASIC_AUTH_USER /
//   METRICS_BASIC_AUTH_PASSWORD(grovina-livekit-prod用)からフル指標を取得する。
//   prod②等を追加する場合は、サーバーごとに環境変数を分けたうえで
//   app/api/master/server-metrics/route.tsのnode-exporter取得処理をidで
//   分岐させる必要がある(今回はprod①のみのため分岐は未実装)。redis-tcp行も
//   現状この唯一のnode-exporter取得結果からredis_upを読み取っているため、
//   prod②を追加する場合はredis-tcp側の参照先も合わせて見直すこと。
export type ServerRowConfig =
  | { id: string; name: string; kind: "redis-tcp" }
  | { id: string; name: string; kind: "node-exporter" };

export const SERVER_ROWS: ServerRowConfig[] = [
  {
    id: "redis-1",
    name: "grovina-livekit-redis①",
    kind: "redis-tcp",
  },
  {
    id: "prod-1",
    name: "grovina-livekit-prod①",
    kind: "node-exporter",
  },
];
