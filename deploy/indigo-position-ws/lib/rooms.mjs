// ルームごとの接続管理と配信(中継)。単一インスタンス前提のインメモリ
// 実装(複数台構成時のRedis/NATS等によるサーバー間中継は、2026-11の設計
// レビューで「今は不要な複雑さを持ち込まない」として明示的にスコープ外)。
import {
  MAX_BUFFERED_BYTES_FOR_MOVE,
  RELAY_MODE,
  TICK_INTERVAL_MS,
} from "../config.mjs";

const rooms = new Map(); // roomId -> Set<connection>
const tickBuffers = new Map(); // roomId -> Map<userId, payload>
let tickTimer = null;

export function joinRoom(roomId, conn) {
  let set = rooms.get(roomId);
  if (!set) {
    set = new Set();
    rooms.set(roomId, set);
  }
  set.add(conn);
}

export function leaveRoom(roomId, conn) {
  const set = rooms.get(roomId);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) {
    rooms.delete(roomId);
    tickBuffers.delete(roomId);
  }
}

// 同一ユーザー(sub+roomId)の既存接続を探す(新しい接続に取って代わられる
// 対象。2026-11設計レビュー: 「後勝ち」方式、user-session-{userId}
// チャンネルの既存パターンを踏襲)。
export function findExistingConnection(roomId, userId, excludeConn) {
  const set = rooms.get(roomId);
  if (!set) return null;
  for (const conn of set) {
    if (conn !== excludeConn && conn.userId === userId) return conn;
  }
  return null;
}

function send(conn, data) {
  if (conn.ws.readyState !== conn.ws.OPEN) return;
  conn.ws.send(data);
}

// move/move-batch専用の「最新値優先」送信(2026-11追加、Tech Lead指摘)。
// 受信側の送信バッファ(OSへまだ渡せていないバイト数)が詰まっている間は
// このmove更新だけをスキップする。次のmove/tickが来れば自然に最新の
// 位置へ追いつくため無限にキューを溜め込ませない。state・管理API経由の
// 切断等、取りこぼしたくない配信には使わない(通常のsend()のまま)。
function sendLatestOnly(conn, data) {
  if (conn.ws.readyState !== conn.ws.OPEN) return;
  if (conn.ws.bufferedAmount > MAX_BUFFERED_BYTES_FOR_MOVE) return;
  conn.ws.send(data);
}

// 「止まった瞬間」とteleportは稀にしか起きない上に、受信側がこれを
// 取りこぼすと見た目が不自然になる(止まったのに動き続けて見える、
// 瞬間移動が補間で滑って見える等)ため、送信バッファが詰まっていても
// 最新値優先のスキップ対象にしない(2026-11、Tech Lead指摘)。通常の
// 移動中の更新(次が高頻度ですぐ来る)だけがスキップ対象。
function isCriticalMovePayload(payload) {
  return payload.moving === false || payload.teleport === true;
}

function relayImmediate(roomId, fromConn, type, payload) {
  const set = rooms.get(roomId);
  if (!set) return;
  const data = JSON.stringify({ type, id: fromConn.userId, ...payload });
  const sender =
    type === "move" && !isCriticalMovePayload(payload) ? sendLatestOnly : send;
  for (const conn of set) {
    if (conn === fromConn) continue;
    sender(conn, data);
  }
}

export function relayMove(roomId, fromConn, payload) {
  if (RELAY_MODE === "immediate") {
    relayImmediate(roomId, fromConn, "move", payload);
    return;
  }
  // tickモード: ルームごとのバッファに「ユーザーごとの最新値」を保持し、
  // 一定間隔でまとめて配信する(同一ユーザーの複数回分は上書きされ最新
  // だけが送られる=帯域削減が目的のため古い中間値は不要)。
  let buf = tickBuffers.get(roomId);
  if (!buf) {
    buf = new Map();
    tickBuffers.set(roomId, buf);
  }
  buf.set(fromConn.userId, payload);
}

// state(非位置情報)は常に即時中継する(低頻度のため集約の恩恵が薄く、
// 反映の速さを優先する2026-11設計レビューの結論)。
export function relayState(roomId, fromConn, payload) {
  relayImmediate(roomId, fromConn, "state", payload);
}

function flushTicks() {
  for (const [roomId, buf] of tickBuffers) {
    if (buf.size === 0) continue;
    const set = rooms.get(roomId);
    if (!set) {
      tickBuffers.delete(roomId);
      continue;
    }
    const entries = Array.from(buf.entries()).map(([id, payload]) => ({
      id,
      ...payload,
    }));
    buf.clear();
    const data = JSON.stringify({ type: "move-batch", players: entries });
    for (const conn of set) {
      // バッチには自分自身の分も含まれ得るが、受信側(将来のクライアント
      // 実装)でid === 自分のidの要素を無視すればよい(Supabase broadcast
      // が送信者自身に返らない挙動と同じ結果になる)。サーバー側で
      // 接続ごとに除外版を作り直すコストの方が高いため、受信側フィルタ
      // 方式を採用する。
      // 既知の制約(tickモード限定、2026-11時点では未解消): あるユーザーの
      // 「止まった」状態が乗ったtickが、特定の受信者の送信バッファ詰まりで
      // スキップされると、その受信者だけはそのユーザーが再度動くまで古い
      // 位置のまま見える(immediateモードと違い、tickバッファは1回の
      // flushで消費されるため再送されない)。tickモードは現状デフォルトでは
      // なく、負荷試験で実際に採用を検討する際に「ユーザーごとの直近状態を
      // 保持し毎tick必ず含める」方式へ拡張するかを判断する。
      sendLatestOnly(conn, data);
    }
  }
}

export function startTickLoopIfNeeded() {
  if (RELAY_MODE !== "tick" || tickTimer) return;
  tickTimer = setInterval(flushTicks, TICK_INTERVAL_MS);
  tickTimer.unref?.();
}

export function roomCount() {
  return rooms.size;
}

export function connectionCount() {
  let n = 0;
  for (const set of rooms.values()) n += set.size;
  return n;
}
