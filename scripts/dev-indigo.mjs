#!/usr/bin/env node
// ローカルでindigoモード(POSITION_TRANSPORT==="indigo")を試すための
// 開発用起動スクリプト(2026-11追加)。`npm run dev:indigo`で、
// 1) IndigoPro位置情報WSサーバー(deploy/indigo-position-ws/)と
// 2) Next.js開発サーバー(NEXT_PUBLIC_POSITION_TRANSPORT=indigo)
// を、使い捨てのローカル専用シークレットを自動生成したうえで同時に
// 起動する。本番用の秘密情報には一切触れない(.envファイルも書き換え
// ない。プロセスの環境変数として渡すだけ)。Ctrl+Cで両方とも終了する。
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const wsDir = path.join(repoRoot, "deploy", "indigo-position-ws");
const isWin = process.platform === "win32";
const npmCmd = isWin ? "npm.cmd" : "npm";
const npxCmd = isWin ? "npx.cmd" : "npx";

if (!existsSync(path.join(wsDir, "node_modules"))) {
  console.log(
    "[dev:indigo] 初回のみ: IndigoPro位置情報WSサーバーの依存関係をインストールします...",
  );
  const result = spawnSync(npmCmd, ["install"], {
    cwd: wsDir,
    stdio: "inherit",
    shell: isWin,
  });
  if (result.status !== 0) {
    console.error("[dev:indigo] npm installに失敗しました");
    process.exit(1);
  }
}

const WS_PORT = 8787;
const ADMIN_PORT = 8788;
const secret = randomBytes(32).toString("hex");
const adminSecret = randomBytes(32).toString("hex");

console.log("[dev:indigo] ローカル専用の使い捨てシークレットを生成しました");
console.log(
  `[dev:indigo] WSサーバー: ws://localhost:${WS_PORT} / 管理API: http://localhost:${ADMIN_PORT}`,
);

const wsEnv = {
  ...process.env,
  SERVER_MODE: "production",
  INDIGO_WS_SECRET: secret,
  INDIGO_WS_KID: "production",
  INDIGO_WS_ADMIN_SECRET: adminSecret,
  WS_PORT: String(WS_PORT),
  ADMIN_PORT: String(ADMIN_PORT),
};

const nextEnv = {
  ...process.env,
  NEXT_PUBLIC_POSITION_TRANSPORT: "indigo",
  INDIGO_WS_SECRET: secret,
  INDIGO_WS_KID: "production",
  INDIGO_WS_URL: `ws://localhost:${WS_PORT}`,
  INDIGO_WS_ADMIN_URL: `http://localhost:${ADMIN_PORT}`,
  INDIGO_WS_ADMIN_SECRET: adminSecret,
};

// Windowsでは.cmd/.batをshell: trueなしでspawnするとEINVAL/ENOENTに
// なることがあるため、npx呼び出しはshell: trueにする(node本体の起動は
// 不要)。
const wsProc = spawn("node", ["server.mjs"], {
  cwd: wsDir,
  env: wsEnv,
  stdio: "inherit",
});
const nextProc = spawn(npxCmd, ["next", "dev"], {
  cwd: repoRoot,
  env: nextEnv,
  stdio: "inherit",
  shell: isWin,
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  wsProc.kill();
  nextProc.kill();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
wsProc.on("exit", (code) => {
  if (!shuttingDown && code !== 0) {
    console.error(`[dev:indigo] WSサーバーが終了しました(code=${code})`);
    shutdown();
    process.exitCode = 1;
  }
});
nextProc.on("exit", (code) => {
  if (!shuttingDown) {
    shutdown();
    process.exitCode = code ?? 0;
  }
});
