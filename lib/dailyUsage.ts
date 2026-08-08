// 画面共有・ビデオ通話の「1日あたり利用時間」で使う、JST 4:00を境界とした
// 日付キー計算のクライアント側リファレンス実装。
//
// 実際の判定・書き込みは常にDB側(supabase/consolidated_setup.sqlの
// increment_daily_usage_seconds/get_daily_usage_used_seconds、内部で
// `(timezone('Asia/Tokyo', now()) - interval '4 hours')::date` を使用)で
// 行われ、この関数はサーバーの判定を上書きしたり置き換えたりするものでは
// ない。SQL側の日付キー計算式と全く同じ計算をJS側でも再現し、テストで
// 固定できるようにしておくことで、境界(4:00ちょうど・日またぎ・月またぎ)
// の挙動をSQLを起動せずに検証できるようにするためのもの。SQL側の計算式を
// 変更した場合は、必ずこちらも合わせて変更すること。
//
// 日本標準時(Asia/Tokyo)は夏時間が無く常にUTC+9固定のため、Intl API等を
// 使わずシンプルな固定オフセット計算で正しく求められる。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const RESET_HOUR_MS = 4 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 指定した時刻(省略時は現在時刻)における、JST 4:00境界の日付キー
// ("YYYY-MM-DD"、その時刻から4時間引いたJST日付)を返す。
export function getJstDayKey(date: Date = new Date()): string {
  const shiftedMs = date.getTime() + JST_OFFSET_MS - RESET_HOUR_MS;
  const shifted = new Date(shiftedMs);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 指定した時刻(省略時は現在時刻)から、次のJST 4:00境界までの残り秒数を返す。
// ちょうど4:00の瞬間は「直前にリセットされた直後」として24時間(次の
// リセットまでの満期間)を返す。
export function getSecondsUntilNextJstReset(date: Date = new Date()): number {
  const jstMs = date.getTime() + JST_OFFSET_MS;
  const msSinceMidnightJst = ((jstMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
  const msUntilReset =
    msSinceMidnightJst < RESET_HOUR_MS
      ? RESET_HOUR_MS - msSinceMidnightJst
      : MS_PER_DAY - msSinceMidnightJst + RESET_HOUR_MS;
  return Math.floor(msUntilReset / 1000);
}
