// スライディングウィンドウ方式のレート制限器。
//
// 2つの超過時の挙動をサポートする:
// - "drop"    : 上限超過分は単純に捨てる(次のメッセージがすぐ来る高頻度の
//                move・teleportの頻度制限に使う。古い値を後から送り直す
//                必要がないため)。
// - "coalesce": 上限超過時は捨てずに、枠が空いた時点で「最後に渡された
//                ペイロード」を1回だけ送る(低頻度だが取りこぼしたくない
//                state送信に使う。components/AvatarSpace.tsxのSupabase
//                presence向けrequestPresenceTrack()と同じ考え方)。
export function createRateLimiter({ limit, windowMs, mode = "drop" }) {
  const timestamps = [];
  let pendingFlush = null; // { timer, payload, send } | null

  function prune(now) {
    while (timestamps.length > 0 && now - timestamps[0] >= windowMs) {
      timestamps.shift();
    }
  }

  function hasCapacity(now) {
    prune(now);
    return timestamps.length < limit;
  }

  // dropモード: 送れるならtrue、送れないならfalseを返すだけ(呼び出し側が
  // 判断に応じて送信するかどうかを決める)。
  function tryConsume() {
    const now = Date.now();
    if (!hasCapacity(now)) return false;
    timestamps.push(now);
    return true;
  }

  // coalesceモード: 送れるならその場でsend(payload)を呼ぶ。送れない場合は
  // 枠が空くタイミングで1回だけ自動的にsend()するようスケジュールする
  // (複数回呼ばれても保留中のフラッシュは1つに合流する=常に最新の
  // payload/sendが使われる)。
  function requestSend(payload, send) {
    const now = Date.now();
    if (hasCapacity(now)) {
      timestamps.push(now);
      send(payload);
      return;
    }
    if (pendingFlush) {
      // 既存の保留分を最新のpayload/sendで上書きするだけ(タイマーの
      // 再予約はしない=最初に空く時刻のまま)。
      pendingFlush.payload = payload;
      pendingFlush.send = send;
      return;
    }
    const oldest = timestamps[0];
    const waitMs = windowMs - (now - oldest) + 20;
    const entry = { timer: null, payload, send };
    entry.timer = setTimeout(() => {
      pendingFlush = null;
      // この時点でのpendingFlush.payload/sendが最新値。
      requestSend(entry.payload, entry.send);
    }, waitMs);
    pendingFlush = entry;
  }

  function dispose() {
    if (pendingFlush) {
      clearTimeout(pendingFlush.timer);
      pendingFlush = null;
    }
    timestamps.length = 0;
  }

  if (mode === "coalesce") {
    return { requestSend, dispose };
  }
  return { tryConsume, dispose };
}

// IPアドレス等のキーごとに独立したカウンタを保持する単純な失敗回数
// レート制限(管理API認証失敗の連打対策用)。
export function createKeyedFailureLimiter({ maxFailures, windowMs, blockDurationMs }) {
  const failures = new Map(); // key -> timestamps[]
  const blockedUntil = new Map(); // key -> timestamp

  function isBlocked(key) {
    const until = blockedUntil.get(key);
    if (until === undefined) return false;
    if (Date.now() >= until) {
      blockedUntil.delete(key);
      return false;
    }
    return true;
  }

  function recordFailure(key) {
    const now = Date.now();
    const list = (failures.get(key) ?? []).filter((t) => now - t < windowMs);
    list.push(now);
    failures.set(key, list);
    if (list.length >= maxFailures) {
      blockedUntil.set(key, now + blockDurationMs);
      failures.delete(key);
    }
  }

  function recordSuccess(key) {
    failures.delete(key);
  }

  return { isBlocked, recordFailure, recordSuccess };
}
