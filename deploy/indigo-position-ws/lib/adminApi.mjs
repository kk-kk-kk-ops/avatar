// 管理用HTTP API(/internal/disconnect)。Next.js(Vercelの送信元IPは固定
// できない)からの呼び出しを想定しているため、送信元IP制限ではなく
// HMAC署名+タイムスタンプ(リプレイ対策)による認証を主な防御とする
// (2026-11設計レビューの結論。固定IPアドオンは導入しない方針)。
import crypto from "node:crypto";
import http from "node:http";
import { ADMIN, CLOSE_CODE } from "../config.mjs";
import { createKeyedFailureLimiter } from "./rateLimiter.mjs";

const failureLimiter = createKeyedFailureLimiter({
  maxFailures: ADMIN.maxAuthFailures,
  windowMs: ADMIN.authFailureWindowMs,
  blockDurationMs: ADMIN.blockDurationMs,
});

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // 長さが違う時点でtimingSafeEqualは例外を投げるため、先に固定長の
  // ダミー比較を1回挟んでから早期returnする(長さ漏洩を気にするほどの
  // シークレットではないが、落ちないようにするための単純なガード)。
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyHmac(timestampHeader, signatureHeader, rawBody) {
  if (!ADMIN.secret) {
    throw new Error("INDIGO_WS_ADMIN_SECRET is not set");
  }
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > ADMIN.replayWindowSec) return false;

  const expected = crypto
    .createHmac("sha256", ADMIN.secret)
    .update(`${timestampHeader}:${rawBody}`)
    .digest("hex");
  return timingSafeEqualStr(expected, signatureHeader ?? "");
}

function clientIp(req) {
  // Caddy等のリバースプロキシ配下を想定(X-Forwarded-Forの先頭)。直接
  // 到達の場合はsocketのアドレスにフォールバックする。
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

export function startAdminServer({ forceDisconnect }) {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/internal/disconnect") {
      res.writeHead(404).end();
      return;
    }
    const ip = clientIp(req);
    if (failureLimiter.isBlocked(ip)) {
      res.writeHead(429).end();
      return;
    }

    let rawBody = "";
    req.on("data", (chunk) => {
      rawBody += chunk;
      // 極端に大きいボディは早期に打ち切る(DoS対策)。
      if (rawBody.length > 8192) req.destroy();
    });
    req.on("end", () => {
      try {
        const ok = verifyHmac(
          req.headers["x-timestamp"],
          req.headers["x-signature"],
          rawBody,
        );
        if (!ok) {
          failureLimiter.recordFailure(ip);
          res.writeHead(401).end();
          return;
        }
        failureLimiter.recordSuccess(ip);

        const body = JSON.parse(rawBody);
        // userIdを省略した場合はルーム全体を対象にする(2026-11追加。
        // Next.js側のプラン変更時・ルーム変更時の強制退出(app/admin/
        // actions.ts・lib/broadcastForceLeave.ts)は、現在誰が接続中かを
        // 知らないため特定の1人を名指しできない。roomIdは必須のまま)。
        if (
          typeof body.roomId !== "string" ||
          (body.userId !== undefined && typeof body.userId !== "string")
        ) {
          res.writeHead(400).end();
          return;
        }
        const count = forceDisconnect(
          body.roomId,
          body.userId ?? null,
          CLOSE_CODE.FORCE_DISCONNECTED,
        );
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({ disconnected: count }),
        );
      } catch {
        failureLimiter.recordFailure(ip);
        res.writeHead(400).end();
      }
    });
  });
  server.listen(ADMIN.port);
  return server;
}
