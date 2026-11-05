// 監視用の軽量なカウンタ(2026-11追加)。プロセス内メモリに保持するだけで、
// 永続化はしない(再起動でリセットされる)。目的はdocker logsをgrepするだけで
// 日次の健全性確認(受理/拒否の件数、理由別の内訳)ができるようにすること。
const rejectedByReason = Object.create(null);
let acceptedCount = 0;
let recoveredCount = 0;

export function recordMoveAccepted() {
  acceptedCount += 1;
}

export function recordMoveRejected(reason) {
  rejectedByReason[reason] = (rejectedByReason[reason] ?? 0) + 1;
}

// implausible-speedの連続拒否から自動復帰(teleport扱いで受理)した件数
// (2026-11追加)。recordMoveAcceptedとは別枠で数え、復帰がどの程度
// 発生しているか日次の健全性確認で見えるようにする。
export function recordMoveRecovered() {
  recoveredCount += 1;
}

// ---- 負荷試験(STEP7)向け: 1秒あたりのメッセージ数・送信間引き件数 ----
// (2026-11追加、Tech Lead指摘)。上記の累積カウンタと違い、こちらは
// 「直近のレポート区間(既定5分)で観測した最大値」という性格のため、
// snapshotMetrics()で読み出すたびにピークをリセットする(区間ごとの
// スパイクを見るための数値であり、プロセス起動からの累積合計ではない)。
const receivedThisSecond = new Map(); // roomId -> この1秒間の受信件数
const relayedThisSecond = new Map(); // roomId -> この1秒間の配信(実送信)件数
let receivedTotalThisSecond = 0;
let relayedTotalThisSecond = 0;

let peakReceivedPerSec = 0;
let peakReceivedPerSecRoom = 0;
let peakRelayedPerSec = 0;
let peakRelayedPerSecRoom = 0;
let sendSkippedCount = 0;

// move/stateメッセージを受信するたびに呼ぶ(moveLimiter等で後段で間引かれる
// 分も含め、トランスポート層に実際に届いた件数を数える)。
export function recordReceived(roomId) {
  receivedTotalThisSecond += 1;
  receivedThisSecond.set(roomId, (receivedThisSecond.get(roomId) ?? 0) + 1);
}

// 1件の配信(ある接続へws.send()が実際に呼ばれた回数)ごとに呼ぶ。
// 1件のmoveがルーム内N人に配信されればN回呼ばれる想定。
export function recordRelayed(roomId) {
  relayedTotalThisSecond += 1;
  relayedThisSecond.set(roomId, (relayedThisSecond.get(roomId) ?? 0) + 1);
}

// 送信バッファ詰まり(bufferedAmount超過)によりmove配信をスキップした回数
// (lib/rooms.mjsのsendLatestOnly参照)。
export function recordSendSkipped() {
  sendSkippedCount += 1;
}

// 1秒ごとに「この1秒間」の値を見て、区間内の最大値(ピーク)を更新してから
// 次の1秒間のためにリセットする。
function tickPerSecond() {
  peakReceivedPerSec = Math.max(peakReceivedPerSec, receivedTotalThisSecond);
  peakRelayedPerSec = Math.max(peakRelayedPerSec, relayedTotalThisSecond);
  let maxRoomReceived = 0;
  for (const v of receivedThisSecond.values()) {
    maxRoomReceived = Math.max(maxRoomReceived, v);
  }
  let maxRoomRelayed = 0;
  for (const v of relayedThisSecond.values()) {
    maxRoomRelayed = Math.max(maxRoomRelayed, v);
  }
  peakReceivedPerSecRoom = Math.max(peakReceivedPerSecRoom, maxRoomReceived);
  peakRelayedPerSecRoom = Math.max(peakRelayedPerSecRoom, maxRoomRelayed);
  receivedTotalThisSecond = 0;
  relayedTotalThisSecond = 0;
  receivedThisSecond.clear();
  relayedThisSecond.clear();
}
const perSecondTimer = setInterval(tickPerSecond, 1000);
perSecondTimer.unref?.();

export function snapshotMetrics() {
  const snapshot = {
    moveAccepted: acceptedCount,
    moveRecovered: recoveredCount,
    moveRejectedByReason: { ...rejectedByReason },
    // 直近のレポート区間内でのピーク値(読み出し後にリセットされる)。
    peakMsgsPerSec: { received: peakReceivedPerSec, relayed: peakRelayedPerSec },
    peakMsgsPerSecPerRoom: {
      received: peakReceivedPerSecRoom,
      relayed: peakRelayedPerSecRoom,
    },
    sendSkipped: sendSkippedCount,
  };
  peakReceivedPerSec = 0;
  peakRelayedPerSec = 0;
  peakReceivedPerSecRoom = 0;
  peakRelayedPerSecRoom = 0;
  sendSkippedCount = 0;
  return snapshot;
}
