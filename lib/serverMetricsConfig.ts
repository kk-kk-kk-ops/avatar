// マスター画面「サーバーリソース一覧」表に表示するサーバーの設定。
// 行を追加するだけで表にサーバーを増やせるように、種別ごとに必要な
// 情報だけを持つ配列にしている。
//
// 2026-08、本番LiveKitサーバーをWebARENA Indigo(grovina-livekit-prod、
// 解約済み)からIndigoPro(target-pro、grovina-livekit-pro①)へ移行。
// 旧prod上で動いていたnode_exporter・check-redis.shはtarget-pro上に
// 作り直した(deploy/livekit/LOAD_TEST_PLAN.md参照)。
//
// - "redis-tcp": Redis(grovina-livekit-redis)の稼働状況を、pro-1
//   (target-pro)のnode_exporter経由で取得する種別(redis_upという
//   textfile collectorメトリクス。target-pro上のcheck-redis.shが1分
//   おきに書き出す。cron自体は将来の複数ノード構成に備えて稼働継続中)。
//   2026-08時点、target-pro自体のlivekit.yamlはRedis未設定(単一ノード
//   構成のため実運用上Redisに依存していない)上、Redis側ファイア
//   ウォールがtarget-proの新IPをまだ許可しておらず疎通できないため、
//   誤解を招く「停止中」表示を避けるべくSERVER_ROWSから行自体を削除
//   している。複数ノード構成でRedisを実際に使うようになったら、
//   ファイアウォール更新とあわせて行を復活させること。
// - "node-exporter": METRICS_URL / METRICS_BASIC_AUTH_USER /
//   METRICS_BASIC_AUTH_PASSWORD(target-pro用に発行し直した認証情報)から
//   フル指標を取得する。pro②等を追加する場合は、サーバーごとに環境変数を
//   分けたうえでapp/api/master/server-metrics/route.tsのnode-exporter
//   取得処理をidで分岐させる必要がある(今回はpro①のみのため分岐は
//   未実装)。
export type ServerRowConfig =
  | { id: string; name: string; kind: "redis-tcp" }
  | { id: string; name: string; kind: "node-exporter" };

export const SERVER_ROWS: ServerRowConfig[] = [
  {
    id: "pro-1",
    name: "grovina-livekit-pro①",
    kind: "node-exporter",
  },
];
