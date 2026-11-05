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

export function snapshotMetrics() {
  return {
    moveAccepted: acceptedCount,
    moveRecovered: recoveredCount,
    moveRejectedByReason: { ...rejectedByReason },
  };
}
