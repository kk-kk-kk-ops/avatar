import { timingSafeEqual } from "node:crypto";

// 単純な文字列比較(===)は先頭バイトの不一致で早期に処理が終わるため、
// 理論上タイミング攻撃(応答時間の差からシークレットを1バイトずつ推測する)
// の余地がある。長さが異なる場合はtimingSafeEqualが例外を投げるため、
// その場合は一致しないものとして扱う。Vercel Cron認証を行う各Route
// Handler(app/api/cron/*)から共通で使う。
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
