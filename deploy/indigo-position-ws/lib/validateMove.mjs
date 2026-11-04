// moveメッセージのサーバー側検証。型・座標範囲・速度(瞬間移動)を
// チェックする。不正なメッセージは1件だけ捨てる(接続は切らない。
// 単発の不正値で切断するとネットワークの瞬断等でも接続が壊れやすく
// なるため)。
import {
  MAX_SPEED_PX_PER_SEC,
  MEETING_ENTRY_STEP_PX,
  TELEPORT_TOLERANCE_PX,
} from "../config.mjs";

const VALID_DIRS = new Set(["up", "down", "left", "right"]);

export function isValidShape(msg) {
  return (
    typeof msg === "object" &&
    msg !== null &&
    typeof msg.x === "number" &&
    Number.isFinite(msg.x) &&
    typeof msg.y === "number" &&
    Number.isFinite(msg.y) &&
    VALID_DIRS.has(msg.dir) &&
    typeof msg.moving === "boolean" &&
    typeof msg.t === "number" &&
    (msg.teleport === undefined || typeof msg.teleport === "boolean")
  );
}

export function isWithinMapBounds(msg, conn) {
  return (
    msg.x >= 0 && msg.x <= conn.mapW && msg.y >= 0 && msg.y <= conn.mapH
  );
}

// teleport:trueが申告された移動先が、正規の瞬間移動先(ワープペアの
// 対になる地点、または会議室ゾーンの入室想定地点)として妥当かを確認する。
function isLegitimateTeleportDestination(msg, conn) {
  const { x, y } = msg;
  for (const pair of conn.warpPairs) {
    const [x1, y1, x2, y2] = pair;
    const nearA = Math.hypot(x - x1, y - y1) <= TELEPORT_TOLERANCE_PX;
    const nearB = Math.hypot(x - x2, y - y2) <= TELEPORT_TOLERANCE_PX;
    if (nearA || nearB) return true;
  }
  const maxEntryDist = MEETING_ENTRY_STEP_PX + TELEPORT_TOLERANCE_PX;
  for (const zone of conn.zones) {
    const withinX = x >= zone.x - maxEntryDist && x <= zone.x + zone.w + maxEntryDist;
    const withinY = y >= zone.y - maxEntryDist && y <= zone.y + zone.h + maxEntryDist;
    // ゾーン本体の内側(当たり判定の余白込み)にいるかどうかで判定する。
    // 入室地点の座標そのものをピンポイントで要求すると、押し戻し等の
    // 既存ロジックで数px変わるだけで弾かれてしまうため、ゾーン矩形+
    // 余白の範囲内かどうかという緩い基準にする。
    if (withinX && withinY) return true;
  }
  return false;
}

// 検証結果: { ok: true } または { ok: false, reason: string }
export function validateMove(msg, conn, now) {
  if (!isValidShape(msg)) {
    return { ok: false, reason: "invalid-shape" };
  }
  if (!isWithinMapBounds(msg, conn)) {
    return { ok: false, reason: "out-of-bounds" };
  }

  if (msg.teleport) {
    if (!isLegitimateTeleportDestination(msg, conn)) {
      return { ok: false, reason: "illegitimate-teleport" };
    }
    return { ok: true };
  }

  // 初回メッセージ(直前の座標が無い)は速度チェックの対象外。
  if (conn.lastAcceptedMove === null) {
    return { ok: true };
  }

  const prev = conn.lastAcceptedMove;
  const dt = Math.max((now - prev.at) / 1000, 0.001);
  const dist = Math.hypot(msg.x - prev.x, msg.y - prev.y);
  const speed = dist / dt;
  if (speed > MAX_SPEED_PX_PER_SEC) {
    return { ok: false, reason: "implausible-speed" };
  }
  return { ok: true };
}
