import { describe, expect, it } from "vitest";
import { getJstDayKey, getSecondsUntilNextJstReset } from "./dailyUsage";

// UTC時刻を指定してDateを作るヘルパー(テストの意図を「JST何時か」で
// 書きたいので、呼び出し側ではJST時刻をUTCに変換してから渡す)。
function utc(y: number, m: number, d: number, h: number, min: number, s: number) {
  return new Date(Date.UTC(y, m - 1, d, h, min, s));
}

describe("getJstDayKey", () => {
  it("リセット直前(JST 03:59:59)は前日の日付キーになる", () => {
    // JST 2026-08-08 03:59:59 == UTC 2026-08-07 18:59:59
    expect(getJstDayKey(utc(2026, 8, 7, 18, 59, 59))).toBe("2026-08-07");
  });

  it("リセット時刻ちょうど(JST 04:00:00)は当日の日付キーになる", () => {
    // JST 2026-08-08 04:00:00 == UTC 2026-08-07 19:00:00
    expect(getJstDayKey(utc(2026, 8, 7, 19, 0, 0))).toBe("2026-08-08");
  });

  it("JST 00:00:00(深夜)はまだリセット前なので前日の日付キーになる", () => {
    // JST 2026-08-08 00:00:00 == UTC 2026-08-07 15:00:00
    expect(getJstDayKey(utc(2026, 8, 7, 15, 0, 0))).toBe("2026-08-07");
  });

  it("JST 23:59:59は当日の日付キーになる", () => {
    // JST 2026-08-08 23:59:59 == UTC 2026-08-08 14:59:59
    expect(getJstDayKey(utc(2026, 8, 8, 14, 59, 59))).toBe("2026-08-08");
  });

  it("月をまたぐ境界でも正しく計算される(JST 03:59:59→前月末日)", () => {
    // JST 2026-09-01 03:59:59 == UTC 2026-08-31 18:59:59
    expect(getJstDayKey(utc(2026, 8, 31, 18, 59, 59))).toBe("2026-08-31");
    // JST 2026-09-01 04:00:00 == UTC 2026-08-31 19:00:00
    expect(getJstDayKey(utc(2026, 8, 31, 19, 0, 0))).toBe("2026-09-01");
  });

  it("年をまたぐ境界でも正しく計算される", () => {
    // JST 2027-01-01 03:59:59 == UTC 2026-12-31 18:59:59
    expect(getJstDayKey(utc(2026, 12, 31, 18, 59, 59))).toBe("2026-12-31");
    // JST 2027-01-01 04:00:00 == UTC 2026-12-31 19:00:00
    expect(getJstDayKey(utc(2026, 12, 31, 19, 0, 0))).toBe("2027-01-01");
  });
});

describe("getSecondsUntilNextJstReset", () => {
  it("リセット1時間前(JST 03:00:00)は残り3600秒", () => {
    // JST 2026-08-08 03:00:00 == UTC 2026-08-07 18:00:00
    expect(getSecondsUntilNextJstReset(utc(2026, 8, 7, 18, 0, 0))).toBe(3600);
  });

  it("リセット直後(JST 04:00:00)は満期間の86400秒", () => {
    expect(getSecondsUntilNextJstReset(utc(2026, 8, 7, 19, 0, 0))).toBe(86400);
  });

  it("日中(JST 10:00:00)は残り18時間(64800秒)", () => {
    // JST 2026-08-08 10:00:00 == UTC 2026-08-08 01:00:00
    expect(getSecondsUntilNextJstReset(utc(2026, 8, 8, 1, 0, 0))).toBe(64800);
  });

  it("深夜(JST 23:59:59)は残り4時間1秒(14401秒)", () => {
    expect(getSecondsUntilNextJstReset(utc(2026, 8, 8, 14, 59, 59))).toBe(14401);
  });
});
