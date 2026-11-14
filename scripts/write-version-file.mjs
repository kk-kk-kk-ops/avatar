#!/usr/bin/env node
// 段階0(docs/realtime-authorization-plan.md 6-2節)のための、ビルド前に
// public/version.jsonを書き出すスクリプト。npm run build / npm run devの
// 前に自動実行される(package.jsonのprebuild/predev)。
//
// VERCEL_DEPLOYMENT_ID(Vercelが各デプロイに自動で発行する識別子)が
// 無いローカル開発環境では、deploymentIdをnullのまま書き出す。クライアント
// 側のNEXT_PUBLIC_DEPLOYMENT_IDもローカルでは未設定(undefined)になり、
// VersionWatcher側はNEXT_PUBLIC_DEPLOYMENT_IDが無い場合はチェック自体を
// 行わない設計のため、ローカル開発でバナー・強制リロードのどちらも
// 発生しない(lib/versionWatcher.ts参照)。
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_GENERATION } from "../lib/buildGeneration.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outPath = path.join(repoRoot, "public", "version.json");

const content = {
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  buildGeneration: BUILD_GENERATION,
};

writeFileSync(outPath, JSON.stringify(content), "utf-8");
// eslint-disable-next-line no-console
console.log(`[write-version-file] wrote ${outPath}:`, content);
