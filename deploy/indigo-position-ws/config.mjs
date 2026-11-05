// 全ての調整可能なパラメータをここに集約する。運用者がserver.mjs等の
// ロジック本体を触らずに挙動を調整できるようにするための単一の情報源。
// 値は環境変数で上書き可能(未設定時は下記のデフォルト値を使う)。

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envStr(name, fallback) {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

// ---- サーバー起動モード ----
// "production": INDIGO_WS_SECRET/INDIGO_WS_KIDのトークンのみ受け付ける。
// "loadtest"  : INDIGO_WS_TEST_SECRET/INDIGO_WS_TEST_KIDのトークンのみ
//               受け付ける。さらにroomIdが"loadtest-"始まりのものだけに
//               制限する(本番データへの誤混入を防ぐ二重の隔離)。
// 2つのモードは排他的であり、互いのkidのトークンは必ず拒否する。
export const SERVER_MODE = envStr("SERVER_MODE", "production");
if (SERVER_MODE !== "production" && SERVER_MODE !== "loadtest") {
  throw new Error(`SERVER_MODE must be "production" or "loadtest", got: ${SERVER_MODE}`);
}

export const JWT = {
  productionSecret: envStr("INDIGO_WS_SECRET", ""),
  productionKid: envStr("INDIGO_WS_KID", "production"),
  loadtestSecret: envStr("INDIGO_WS_TEST_SECRET", ""),
  loadtestKid: envStr("INDIGO_WS_TEST_KID", "loadtest"),
  loadtestRoomPrefix: "loadtest-",
};

// ---- WebSocketサーバー ----
export const WS_PORT = envInt("WS_PORT", 8787);
// ping/pongによる無応答接続の切断間隔(ms)。この間隔の前回チェックから
// pongが一度も返っていない接続はterminate()する(2026-11追加、Tech Lead
// レビューの指摘。死んだ接続がルームに残り続けるのを防ぐ)。ついでに、
// 再authenticateが一度も行われないまま元のトークンのexpが過ぎた接続も
// この周期でまとめて切断する(下記AUTH_GRACE_PERIOD_MSと同様、専用の
// タイマーを増やさずこの既存の巡回に相乗りする)。
export const HEARTBEAT_INTERVAL_MS = envInt("HEARTBEAT_INTERVAL_MS", 30_000);
// 想定ペイロードはmove約150バイトだが、接続後最初に送るauthenticate
// メッセージはJWT(mapW/mapH/warpPairs/zonesを埋め込むため、ゾーン数等に
// よっては1〜2KB程度になりうる。実測値はREADME参照)を含むため、それが
// 収まる余裕を持たせつつ異常に大きいフレームはトランスポート層で弾く上限。
export const MAX_PAYLOAD_BYTES = envInt("MAX_PAYLOAD_BYTES", 8192);
// 接続後、この時間内にauthenticateメッセージが届かなければ切断する
// (2026-11修正: トークンをURLクエリパラメータで渡すとログ・プロキシ・
// ブラウザ履歴に残るリスクがあるため、接続後の最初のメッセージとして
// 送る方式に変更。それまでの間は未認証状態として扱う)。
export const AUTH_GRACE_PERIOD_MS = envInt("AUTH_GRACE_PERIOD_MS", 8000);

// ---- move(位置情報)の送信制御 ----
// クライアント側は100ms間隔(10回/秒)+開始/停止/向き変更時の即時送信を
// 想定しているが、バグ・不正クライアント対策として余裕を持った上限を
// サーバー側でも設ける(これを超えた分は間引く、切断はしない)。
export const MOVE_RATE_LIMIT = envInt("MOVE_RATE_LIMIT_PER_SEC", 25);

// 受信者側の送信バッファ(ws の bufferedAmount、OSへまだ渡せていない
// バイト数)がこれを超えている間は、そのmove更新だけをその接続にスキップ
// する(2026-11追加、Tech Lead指摘の「送信キューの最新値優先制御」)。
// 詰まっている接続に送信をため込ませるとメモリが無限に膨らむため、
// 1〜数件分のmoveが収まる程度の小さい値にし、次のmove/tickが来れば
// 自然に最新の位置へ追いつく(stateやforceDisconnect用の切断には
// 適用しない=そちらは取りこぼしたくないため)。
export const MAX_BUFFERED_BYTES_FOR_MOVE = envInt(
  "MAX_BUFFERED_BYTES_FOR_MOVE",
  4096,
);

// 既知の理論上の最大移動速度: MOVE_SPEED(220px/秒) × 車の最大倍率(2.5倍)
// = 550px/秒(components/AvatarSpace.tsx・lib/types.tsの定数を参照)。
// ネットワーク遅延・フレーム処理のばらつきを見込んで余裕を持たせた閾値。
export const MAX_SPEED_PX_PER_SEC = envInt("MAX_SPEED_PX_PER_SEC", 900);

// teleport: true を伴うmoveの座標検証の許容誤差(px)。ワープ地点・会議室
// 入室地点とのズレがこの範囲内なら正規の瞬間移動とみなす。
export const TELEPORT_TOLERANCE_PX = envInt("TELEPORT_TOLERANCE_PX", 10);
// 会議室入室時の瞬間移動距離(components/AvatarSpace.tsxのMEETING_ENTRY_STEP
// と一致させる)。ゾーン境界からこの距離+許容誤差の範囲内への着地のみ許可する。
export const MEETING_ENTRY_STEP_PX = envInt("MEETING_ENTRY_STEP_PX", 30);
// teleport:trueの受理頻度上限(正規の操作は稀なため厳しめに設定)。
export const TELEPORT_RATE_LIMIT = envInt("TELEPORT_RATE_LIMIT", 2);
export const TELEPORT_RATE_WINDOW_MS = envInt("TELEPORT_RATE_WINDOW_MS", 5000);

// ---- state(非位置情報)の送信制御 ----
// Supabase presenceの「30秒5回」制限とは完全に無関係な、このWSサーバー
// 独自の上限(自前サーバーなのでSupabaseより緩く設定してよい)。
export const STATE_RATE_LIMIT = envInt("STATE_RATE_LIMIT", 20);
export const STATE_RATE_WINDOW_MS = envInt("STATE_RATE_WINDOW_MS", 10_000);

// ---- 不正メッセージの連打対策 ----
// 不正なJSON・形状不一致・座標範囲外・不正teleport等、1件ずつは切断せず
// 捨てているメッセージでも、短時間に大量に送ってくる接続は明らかな不正
// クライアントとみなして切断する(2026-11追加、Tech Lead指摘)。
// 未認証(authenticate前)の段階から数える(ガベージの連打は認証前でも
// あり得るため)。
export const INVALID_MESSAGE_LIMIT = envInt("INVALID_MESSAGE_LIMIT", 20);
export const INVALID_MESSAGE_WINDOW_MS = envInt(
  "INVALID_MESSAGE_WINDOW_MS",
  10_000,
);

// ---- 配信方式 ----
// "immediate": 受信したmoveを即座に中継する(現在のSupabase broadcastに
//              最も近い挙動。デフォルト)。
// "tick"     : ルームごとに一定間隔でまとめてバッチ配信する(人数が多い
//              ルームでの帯域削減用。負荷試験での比較のために実装するが、
//              デフォルトではない)。
export const RELAY_MODE = envStr("RELAY_MODE", "immediate");
if (RELAY_MODE !== "immediate" && RELAY_MODE !== "tick") {
  throw new Error(`RELAY_MODE must be "immediate" or "tick", got: ${RELAY_MODE}`);
}
export const TICK_INTERVAL_MS = envInt("TICK_INTERVAL_MS", 50);

// ---- WebSocketクローズコード(アプリ定義、4000-4999の範囲) ----
export const CLOSE_CODE = {
  FORCE_DISCONNECTED: 4001, // /internal/disconnectによる強制切断
  SUPERSEDED: 4002, // 同一ユーザーの新しい接続に取って代わられた
  AUTH_FAILED: 4003, // トークン検証失敗(期限切れ・kid不一致・署名不正等)
  ROOM_REJECTED: 4004, // loadtestモードでroomId規則違反等
  PROTOCOL_ABUSE: 4005, // 不正メッセージの連打(INVALID_MESSAGE_LIMIT超過)
};

// ---- 管理API(/internal/disconnect) ----
export const ADMIN = {
  port: envInt("ADMIN_PORT", 8788),
  secret: envStr("INDIGO_WS_ADMIN_SECRET", ""),
  // HMAC署名に添えるタイムスタンプがこの秒数以上ズレていたらリプレイ
  // とみなして拒否する。
  replayWindowSec: envInt("ADMIN_REPLAY_WINDOW_SEC", 60),
  // 送信元IPごとの認証失敗レート制限。
  maxAuthFailures: envInt("ADMIN_MAX_AUTH_FAILURES", 5),
  authFailureWindowMs: envInt("ADMIN_AUTH_FAILURE_WINDOW_MS", 60_000),
  blockDurationMs: envInt("ADMIN_BLOCK_DURATION_MS", 10 * 60_000),
};
