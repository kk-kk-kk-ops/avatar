// JWT検証(接続時のトークン認証)。
//
// 設計方針(2026-11の設計レビューで確定): このWSサーバーはSupabaseの
// 認証情報(service role key等)を一切保持しない。代わりに、Next.js側の
// トークン発行API(別ブランチで実装予定)が、ルーム参加権限の確認・
// マップサイズ/ワープ地点/ゾーン情報の取得をSupabase側で済ませたうえで、
// それらを全てこの署名付きトークンに埋め込んで渡す。このWSサーバーは
// トークンの署名検証だけを行えばよく、Supabaseへ問い合わせる必要がない。
//
// kid(鍵ID)によって本番用/負荷試験用の鍵を厳密に分離する。本番モードの
// サーバーは本番kid以外を一切受け付けず、負荷試験モードのサーバーは
// 負荷試験kid以外を一切受け付けない(双方向に排他)。
import jwt from "jsonwebtoken";
import { JWT, SERVER_MODE } from "../config.mjs";

export class AuthError extends Error {}

function secretForMode() {
  if (SERVER_MODE === "production") {
    if (!JWT.productionSecret) {
      throw new Error("INDIGO_WS_SECRET is not set (SERVER_MODE=production)");
    }
    return { secret: JWT.productionSecret, expectedKid: JWT.productionKid };
  }
  if (!JWT.loadtestSecret) {
    throw new Error("INDIGO_WS_TEST_SECRET is not set (SERVER_MODE=loadtest)");
  }
  return { secret: JWT.loadtestSecret, expectedKid: JWT.loadtestKid };
}

// トークンのclaims形状(Next.js側の発行APIが守るべき契約):
// {
//   sub: string,        // identity(components/AvatarSpace.tsxのselfId相当。
//                        // ブラウザごとのランダムID、再読み込みで変わる)
//   ownerUserId: string,// 認証済みSupabaseユーザーID(auth.uid())。subとは
//                        // 別物(2026-11追加、なりすまし対策。下記参照)
//   roomId: string,
//   kid: string,        // "production" | "loadtest"(鍵IDと一致必須)
//   exp: number,        // 短命(〜30分目安)
//   mapW: number, mapH: number,
//   warpPairs: [[x1,y1,x2,y2], ...],
//   zones: [{ id, kind, x, y, w, h }, ...],
// }
//
// ownerUserIdについて(2026-11、トークン発行API実装時に発見したセキュリティ
// 対応): subの値(identity)は同室の他参加者がSupabase presence経由で知る
// ことができるため、検証なしに「sub一致なら既存接続を取って代わってよい」
// としてしまうと、他人のidentityを騙ってトークンを取得し、本物の接続を
// 強制的に蹴り出せてしまう(app/api/livekit-token/route.tsのLiveKit側
// なりすまし対策と同種の脆弱性)。ownerUserIdは常にNext.js側でSupabase
// セッションから取得した値のみが入るため、クライアントが偽装できない。
// server.mjsのsetupAfterAuthで、既存接続への「取って代わり」を許可する
// 前にownerUserIdの一致を必須条件とする。
export function verifyToken(token) {
  const { secret, expectedKid } = secretForMode();
  let decoded;
  try {
    decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
  } catch (err) {
    throw new AuthError(`invalid token: ${err.message}`);
  }
  if (typeof decoded !== "object" || decoded === null) {
    throw new AuthError("invalid token payload");
  }
  if (decoded.kid !== expectedKid) {
    // 本番サーバーに負荷試験トークンが来た場合(またはその逆)はここで
    // 必ず弾く。鍵が別々でも、kidクレームの不一致チェックを独立して
    // 持たせることで二重に保証する。
    throw new AuthError(`kid mismatch: expected ${expectedKid}`);
  }
  if (typeof decoded.sub !== "string" || !decoded.sub) {
    throw new AuthError("missing sub claim");
  }
  if (typeof decoded.ownerUserId !== "string" || !decoded.ownerUserId) {
    throw new AuthError("missing ownerUserId claim");
  }
  if (typeof decoded.roomId !== "string" || !decoded.roomId) {
    throw new AuthError("missing roomId claim");
  }
  if (SERVER_MODE === "loadtest" && !decoded.roomId.startsWith(JWT.loadtestRoomPrefix)) {
    // 鍵・kidの分離に加えた二重の隔離(本番データへの誤混入防止)。
    throw new AuthError(`loadtest server requires roomId prefix "${JWT.loadtestRoomPrefix}"`);
  }
  if (
    typeof decoded.mapW !== "number" ||
    typeof decoded.mapH !== "number" ||
    !Array.isArray(decoded.warpPairs) ||
    !Array.isArray(decoded.zones)
  ) {
    throw new AuthError("missing map/zone validation data");
  }
  if (typeof decoded.exp !== "number") {
    throw new AuthError("missing exp claim");
  }
  return {
    userId: decoded.sub,
    ownerUserId: decoded.ownerUserId,
    roomId: decoded.roomId,
    mapW: decoded.mapW,
    mapH: decoded.mapH,
    warpPairs: decoded.warpPairs,
    zones: decoded.zones,
    // expはUnix秒(JWT標準)。呼び出し側でミリ秒に変換して保持する。
    expiresAtSec: decoded.exp,
  };
}
