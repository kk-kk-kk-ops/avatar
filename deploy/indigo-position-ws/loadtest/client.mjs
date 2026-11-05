// 負荷試験用の疑似クライアント1台分のロジック(2026-11追加)。
// 実クライアント(components/AvatarSpace.tsx・lib/indigoPositionClient.ts)と
// 同じ認証フロー(接続後の最初のメッセージでauthenticate)・同じ指数
// バックオフ再接続を模倣する。本番トークン発行API(/api/indigo-token)は
// 経由せず、loadtest用の鍵で直接JWTを発行する(SERVER_MODE=loadtest専用
// インスタンスに対してのみ接続する前提)。
import WebSocket from "ws";
import jwt from "jsonwebtoken";

const DIR_VECTORS = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
const DIRS = Object.keys(DIR_VECTORS);

function randomDir() {
  return DIRS[Math.floor(Math.random() * DIRS.length)];
}

function makeToken({ secret, kid, roomId, userId, mapW, mapH }) {
  return jwt.sign(
    {
      sub: userId,
      ownerUserId: "loadtest-" + userId,
      roomId,
      kid,
      mapW,
      mapH,
      warpPairs: [],
      zones: [],
    },
    secret,
    { expiresIn: "30m" },
  );
}

// 本番の典型的なペイロード(状態一式、README.md「帯域見積もり」参照、
// 実測約256B)に近づけるためのダミー状態。実際のフィールド名・型だけ
// 本番(PlayerState)に合わせ、値は固定のダミー。
function buildDummyState(userId) {
  return {
    name: "loadtest-user-" + userId.slice(0, 8),
    color: "#3B82F6",
    avatarImage: "/avatar/avatar1.png",
    carImage: null,
    carVisible: false,
    micOn: false,
    announcementOn: false,
    recordingOn: false,
    sharingScreen: false,
    inCall: false,
    meetingZoneId: null,
    message: null,
    showMessage: false,
    status: "available",
    transcriptionStatus: null,
  };
}

// 1台の疑似クライアントを作成する。start()で接続・移動シミュレーション
// 開始、stop()で終了(再接続も止める)。
export function createLoadTestClient({
  wsUrl,
  secret,
  kid,
  roomId,
  userId,
  mapW,
  mapH,
  hz,
  moving, // true: 継続的に動き続ける / false: 静止(ハートビートのみ)
  onLatencySample, // (ms) => void、他の参加者からのmoveを受信するたびに呼ぶ
  onConnected,
  onDisconnected,
  stats, // { connectAttempts, connectSuccess, authFailures } を増やす共有オブジェクト
}) {
  let ws = null;
  let disposed = false;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let moveTimer = null;
  let x = mapW / 2 + (Math.random() - 0.5) * 200;
  let y = mapH / 2 + (Math.random() - 0.5) * 200;
  let dir = randomDir();
  let lastDirChangeAt = 0;
  // 配信取りこぼし率の集計用(2026-11追加)。sentCountは自分が実際に送信
  // したmove件数、receivedCount/receivedBytesは他の参加者から実際に
  // 受信した件数・バイト数。run.mjs側で、同じルームの他クライアントの
  // sentCountの合計(=本来届くはずだった件数)と突き合わせて配信成功率を
  // 算出する。
  const counters = { sentCount: 0, receivedCount: 0, receivedBytes: 0 };

  function scheduleReconnect() {
    if (disposed || reconnectTimer) return;
    const base = Math.min(1000 * 2 ** reconnectAttempt, 30_000);
    const delay = base * (0.8 + Math.random() * 0.4);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    if (disposed) return;
    stats.connectAttempts += 1;
    const token = makeToken({ secret, kid, roomId, userId, mapW, mapH });
    const socket = new WebSocket(wsUrl);
    ws = socket;

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "authenticate", token }));
    });

    // 認証成功の確認は無い(サーバーはエラー時のみcloseで応答する)ため、
    // 送信開始をもって「接続できた」とみなす(実クライアントと同じ想定)。
    let confirmedTimer = setTimeout(() => {
      stats.connectSuccess += 1;
      reconnectAttempt = 0;
      onConnected?.();
      if (moving) startMoving(socket);
      else startHeartbeat(socket);
    }, 300);

    socket.addEventListener("message", (event) => {
      const raw = event.data.toString();
      counters.receivedBytes += Buffer.byteLength(raw);
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      const now = Date.now();
      if (msg.type === "move" && typeof msg.t === "number" && msg.id !== userId) {
        counters.receivedCount += 1;
        onLatencySample?.(now - msg.t);
      } else if (msg.type === "move-batch" && Array.isArray(msg.players)) {
        for (const p of msg.players) {
          if (p.id !== userId && typeof p.t === "number") {
            counters.receivedCount += 1;
            onLatencySample?.(now - p.t);
          }
        }
      }
    });

    socket.addEventListener("close", (event) => {
      clearTimeout(confirmedTimer);
      if (moveTimer) {
        clearInterval(moveTimer);
        moveTimer = null;
      }
      if (ws === socket) ws = null;
      onDisconnected?.(event.code);
      if (disposed) return;
      // 4005(不正メッセージ連打)相当は自動再接続しない(実クライアントと
      // 同じ方針)。それ以外(4001/4002/4003/4004/通常切断)は再接続する。
      if (event.code === 4005) {
        stats.protocolAbuseDisconnects = (stats.protocolAbuseDisconnects ?? 0) + 1;
        return;
      }
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      // closeが追って発火するためここでは何もしない。
    });
  }

  function sendMove(extra = {}) {
    if (!ws || ws.readyState !== ws.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "move",
        x,
        y,
        dir,
        moving,
        t: Date.now(),
        ...buildDummyState(userId),
        ...extra,
      }),
    );
    counters.sentCount += 1;
  }

  function startMoving(socket) {
    const intervalMs = 1000 / hz;
    let lastSentAt = 0;
    moveTimer = setInterval(() => {
      if (ws !== socket || ws.readyState !== ws.OPEN) return;
      const now = Date.now();
      // 向きはたまに変える(実クライアントの「向きが変わった瞬間は即時送信」
      // を模すため、変えた直後に1回送ってから通常間隔に戻す)。
      if (now - lastDirChangeAt > 2000 + Math.random() * 3000) {
        dir = randomDir();
        lastDirChangeAt = now;
        sendMove();
        lastSentAt = now;
        return;
      }
      if (now - lastSentAt < intervalMs) return;
      const { dx, dy } = DIR_VECTORS[dir];
      const speed = 220; // MOVE_SPEED相当(px/秒)、車なしの標準速度
      x = Math.min(Math.max(x + dx * speed * (intervalMs / 1000), 0), mapW);
      y = Math.min(Math.max(y + dy * speed * (intervalMs / 1000), 0), mapH);
      sendMove();
      lastSentAt = now;
    }, Math.max(10, intervalMs / 2));
  }

  function startHeartbeat(socket) {
    moveTimer = setInterval(() => {
      if (ws !== socket || ws.readyState !== ws.OPEN) return;
      sendMove({ moving: false });
    }, 3000);
  }

  return {
    roomId,
    userId,
    counters,
    start: connect,
    stop() {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (moveTimer) clearInterval(moveTimer);
      ws?.close();
      ws = null;
    },
    // 条件6(切断と再接続)用: 外部から強制的に今の接続を切る。
    // disposeはせず、通常の再接続ロジックに任せる。
    forceDisconnect() {
      ws?.close();
    },
  };
}
