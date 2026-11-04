// Globy アバター位置情報WSサーバー(Supabase Realtime moveの移行先、
// 第1段階)。presence・チャット・DM・施錠・強制退出・録画・字幕等は
// 引き続きSupabase Realtimeに残り、このサーバーはmove(座標)と
// state(非位置情報、マイク/車/ステータス等)の2種類のイベントの中継のみを
// 担当する。詳細はREADME.md参照。
import { WebSocketServer } from "ws";
import {
  AUTH_GRACE_PERIOD_MS,
  CLOSE_CODE,
  HEARTBEAT_INTERVAL_MS,
  INVALID_MESSAGE_LIMIT,
  INVALID_MESSAGE_WINDOW_MS,
  MAX_PAYLOAD_BYTES,
  MOVE_RATE_LIMIT,
  STATE_RATE_LIMIT,
  STATE_RATE_WINDOW_MS,
  TELEPORT_RATE_LIMIT,
  TELEPORT_RATE_WINDOW_MS,
  WS_PORT,
} from "./config.mjs";
import { AuthError, verifyToken } from "./lib/auth.mjs";
import { startAdminServer } from "./lib/adminApi.mjs";
import {
  connectionCount,
  findExistingConnection,
  joinRoom,
  leaveRoom,
  relayMove,
  relayState,
  roomCount,
  startTickLoopIfNeeded,
} from "./lib/rooms.mjs";
import { createRateLimiter } from "./lib/rateLimiter.mjs";
import { validateMove } from "./lib/validateMove.mjs";

const wss = new WebSocketServer({ port: WS_PORT, maxPayload: MAX_PAYLOAD_BYTES });

function closeConn(conn, code, reason) {
  try {
    conn.ws.close(code, reason);
  } catch {
    // 既に閉じている場合は無視
  }
}

function applyClaims(conn, claims) {
  conn.userId = claims.userId;
  conn.roomId = claims.roomId;
  conn.mapW = claims.mapW;
  conn.mapH = claims.mapH;
  conn.warpPairs = claims.warpPairs;
  conn.zones = claims.zones;
  conn.tokenExpiresAt = claims.expiresAtSec * 1000;
}

function setupAfterAuth(conn, claims) {
  conn.authenticated = true;
  applyClaims(conn, claims);
  conn.lastAcceptedMove = null;
  conn.moveLimiter = createRateLimiter({
    limit: MOVE_RATE_LIMIT,
    windowMs: 1000,
    mode: "drop",
  });
  conn.teleportLimiter = createRateLimiter({
    limit: TELEPORT_RATE_LIMIT,
    windowMs: TELEPORT_RATE_WINDOW_MS,
    mode: "drop",
  });
  conn.stateLimiter = createRateLimiter({
    limit: STATE_RATE_LIMIT,
    windowMs: STATE_RATE_WINDOW_MS,
    mode: "coalesce",
  });

  // 同一ユーザー(sub+roomId)の既存接続があれば、新しい接続を優先して
  // 古い方を切断する(「後勝ち」方式。2026-11設計レビューの結論)。
  const existing = findExistingConnection(conn.roomId, conn.userId, conn);
  if (existing) {
    leaveRoom(existing.roomId, existing);
    closeConn(existing, CLOSE_CODE.SUPERSEDED, "superseded by new connection");
  }
  joinRoom(conn.roomId, conn);
  startTickLoopIfNeeded();
}

function disposeConn(conn) {
  if (conn.authGraceTimer) clearTimeout(conn.authGraceTimer);
  conn.invalidLimiter?.dispose();
  if (conn.authenticated) {
    leaveRoom(conn.roomId, conn);
    conn.moveLimiter?.dispose();
    conn.teleportLimiter?.dispose();
    conn.stateLimiter?.dispose();
  }
}

// 不正メッセージ(不正JSON・形状不一致・座標範囲外・不正teleport等)を
// 1件記録する。短時間に連打してくる接続は切断する(2026-11追加)。
function recordInvalid(conn) {
  if (!conn.invalidLimiter.tryConsume()) {
    closeConn(conn, CLOSE_CODE.PROTOCOL_ABUSE, "too many invalid messages");
    return false;
  }
  return true;
}

function handleAuthenticate(conn, msg) {
  if (typeof msg.token !== "string" || !msg.token) {
    closeConn(conn, CLOSE_CODE.AUTH_FAILED, "missing token");
    return;
  }
  if (conn.authenticated) {
    // 接続を維持したままのトークン更新(再authenticate、2026-11追加、
    // Tech Lead指摘)。有効期限が切れる前にクライアントが新しいトークンを
    // 送ってくる想定。身元(sub+roomId)の変更は許可しない(なりすまし・
    // 部屋の乗り換えに悪用されないよう、更新は同一身元内でのclaims
    // 差し替えのみに限定する)。
    let claims;
    try {
      claims = verifyToken(msg.token);
    } catch {
      // 更新用トークンが不正でも、動作中の接続自体はそのまま維持する
      // (元のトークンのexpが来れば下のハートビート巡回で自然に切断
      // される。正常稼働中の接続を更新失敗だけで即切断するのは過剰と
      // 判断、2026-11設計判断)。
      console.warn(
        `[auth] re-authenticate failed room=${conn.roomId} user=${conn.userId}, keeping existing connection`,
      );
      return;
    }
    if (claims.userId !== conn.userId || claims.roomId !== conn.roomId) {
      closeConn(
        conn,
        CLOSE_CODE.AUTH_FAILED,
        "re-authenticate identity mismatch",
      );
      return;
    }
    applyClaims(conn, claims);
    return;
  }
  try {
    const claims = verifyToken(msg.token);
    clearTimeout(conn.authGraceTimer);
    setupAfterAuth(conn, claims);
  } catch (err) {
    const isRoomRejected =
      err instanceof AuthError && /roomId prefix/.test(err.message);
    closeConn(
      conn,
      isRoomRejected ? CLOSE_CODE.ROOM_REJECTED : CLOSE_CODE.AUTH_FAILED,
      "authentication failed",
    );
  }
}

function handleMove(conn, msg) {
  if (!conn.moveLimiter.tryConsume()) return; // 上限超過分は静かに間引く

  const now = Date.now();
  const result = validateMove(msg, conn, now);
  if (!result.ok) {
    // 単発の不正値では切断しない(ネットワーク由来の揺らぎ等でも起こり
    // うるため)。ただし短時間に連打してくる接続はrecordInvalidの側で
    // 切断する(2026-11追加)。
    console.warn(
      `[move-rejected] room=${conn.roomId} user=${conn.userId} reason=${result.reason}`,
    );
    recordInvalid(conn);
    return;
  }

  if (msg.teleport) {
    if (!conn.teleportLimiter.tryConsume()) return; // teleportの頻度超過は静かに間引く
  }

  conn.lastAcceptedMove = { x: msg.x, y: msg.y, at: now };
  relayMove(conn.roomId, conn, {
    x: msg.x,
    y: msg.y,
    dir: msg.dir,
    moving: msg.moving,
    t: msg.t,
  });
}

function handleState(conn, msg) {
  if (typeof msg.payload !== "object" || msg.payload === null) return;
  // stateの中身自体はこのサーバーの関心事ではない(不透明なJSONとして
  // 中継するだけ)。Supabase presence側の「30秒5回」制限とは完全に独立した
  // このサーバー専用の送信制御(STATE_RATE_LIMIT)を適用する。
  conn.stateLimiter.requestSend(msg.payload, (payload) => {
    relayState(conn.roomId, conn, payload);
  });
}

wss.on("connection", (ws) => {
  const conn = { ws, authenticated: false, isAlive: true };
  // forceDisconnect()がwss.clients(wsインスタンスの集合)からconnを
  // たどれるようにするための後方参照。
  ws.__conn = conn;
  // 不正メッセージの連打カウンタ(2026-11追加)。認証前からガベージを
  // 送ってくる接続もあり得るため、認証状態に関わらず接続開始時点で作る。
  conn.invalidLimiter = createRateLimiter({
    limit: INVALID_MESSAGE_LIMIT,
    windowMs: INVALID_MESSAGE_WINDOW_MS,
    mode: "drop",
  });
  ws.on("pong", () => {
    conn.isAlive = true;
  });

  conn.authGraceTimer = setTimeout(() => {
    if (!conn.authenticated) {
      closeConn(conn, CLOSE_CODE.AUTH_FAILED, "authentication timeout");
    }
  }, AUTH_GRACE_PERIOD_MS);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      recordInvalid(conn); // 不正なJSON
      return;
    }
    if (typeof msg !== "object" || msg === null || typeof msg.type !== "string") {
      recordInvalid(conn);
      return;
    }

    if (!conn.authenticated) {
      if (msg.type !== "authenticate") {
        closeConn(conn, CLOSE_CODE.AUTH_FAILED, "first message must authenticate");
        return;
      }
      handleAuthenticate(conn, msg);
      return;
    }

    switch (msg.type) {
      case "move":
        handleMove(conn, msg);
        break;
      case "state":
        handleState(conn, msg);
        break;
      case "authenticate":
        // 接続を維持したままのトークン更新(2026-11追加)。handleAuthenticate
        // 側でconn.authenticatedがtrueの場合は再認証として扱われる。
        handleAuthenticate(conn, msg);
        break;
      default:
        recordInvalid(conn);
        break;
    }
  });

  ws.on("close", () => disposeConn(conn));
  ws.on("error", () => disposeConn(conn));
});

// ping/pongによる無応答接続の検知、および再authenticateが行われないまま
// 元のトークンのexpが過ぎた認証済み接続の切断(2026-11追加)。
const heartbeatTimer = setInterval(() => {
  const now = Date.now();
  for (const ws of wss.clients) {
    const conn = ws.__conn;
    if (!conn) continue;
    if (conn.authenticated && conn.tokenExpiresAt && now >= conn.tokenExpiresAt) {
      closeConn(conn, CLOSE_CODE.AUTH_FAILED, "token expired, no refresh received");
      continue;
    }
    if (conn.isAlive === false) {
      ws.terminate(); // 前回のpingにpongが返っていない=無応答とみなす
      continue;
    }
    conn.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_INTERVAL_MS);
heartbeatTimer.unref?.();

export function forceDisconnect(roomId, userId, code) {
  // adminApi.mjsから呼ばれる。roomId内の該当ユーザーの接続を切断する。
  let count = 0;
  for (const client of wss.clients) {
    // wss.clientsはwsインスタンスの集合であり、ここに紐づくconnオブジェクトは
    // 持たないため、クロージャで保持しているconnをたどる必要がある。
    // 実装簡略化のため、authenticate成功時にws自身へconnへの参照を
    // 持たせておく(下記 conn.ws.__conn 参照)。
    const conn = client.__conn;
    if (conn && conn.authenticated && conn.roomId === roomId && conn.userId === userId) {
      closeConn(conn, code, "force-disconnected by admin");
      count += 1;
    }
  }
  return count;
}

startAdminServer({ forceDisconnect });

console.log(
  `[indigo-position-ws] listening on :${WS_PORT} (rooms=${roomCount()}, connections=${connectionCount()})`,
);
