// 負荷試験オーケストレーター(2026-11追加)。複数ルーム×各ルームの人数分の
// 疑似クライアントを起動し、指定時間だけ走らせて結果を集計・表示する。
// 本番トークンAPIは経由しない。SERVER_MODE=loadtest専用インスタンスに
// 接続する前提(roomIdは自動でloadtest-接頭辞を付ける)。
//
// 使い方の例:
//   node run.mjs --ws-url ws://127.0.0.1:8789 --secret <loadtest秘密鍵> \
//     --rooms 1 --clients-per-room 50 --hz 5 --duration 150 --moving-ratio 1
//
// 詳細なオプション一覧はREADME.md参照。
import { createLoadTestClient } from "./client.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const wsUrl = args["ws-url"];
const secret = args.secret;
const kid = args.kid ?? "loadtest";
const rooms = Number(args.rooms ?? 1);
const clientsPerRoom = Number(args["clients-per-room"] ?? 50);
const hz = Number(args.hz ?? 5);
const durationSec = Number(args.duration ?? 150);
const movingRatio = Math.min(1, Math.max(0, Number(args["moving-ratio"] ?? 1)));
const mapW = Number(args["map-w"] ?? 2000);
const mapH = Number(args["map-h"] ?? 2000);
// 条件5・6(同時入退室・切断と再接続)用: 指定秒おきに、指定割合の接続を
// 強制切断する(再接続は通常の指数バックオフに任せる)。0なら実施しない。
const churnIntervalSec = Number(args["churn-interval-s"] ?? 0);
const churnFraction = Math.min(1, Math.max(0, Number(args["churn-fraction"] ?? 0)));

if (!wsUrl || !secret) {
  console.error(
    "使い方: node run.mjs --ws-url <wss://...> --secret <loadtest秘密鍵> [--rooms N] [--clients-per-room N] [--hz N] [--duration 秒] [--moving-ratio 0-1] [--churn-interval-s 秒] [--churn-fraction 0-1]",
  );
  process.exit(1);
}

console.log(
  `[loadtest] rooms=${rooms} clientsPerRoom=${clientsPerRoom} (合計${rooms * clientsPerRoom}) hz=${hz} duration=${durationSec}s movingRatio=${movingRatio}`,
);

const stats = {
  connectAttempts: 0,
  connectSuccess: 0,
  protocolAbuseDisconnects: 0,
};

// 遅延(配信遅延 = 受信時刻 - 送信側が埋め込んだt)のサンプルを
// リザーバーサンプリングで保持する(全件保持はメモリを圧迫するため、
// 上限件数を超えたらランダムに入れ替える近似方式)。
const RESERVOIR_SIZE = 200_000;
const latencyReservoir = [];
let latencySampleCount = 0;
function recordLatency(ms) {
  latencySampleCount += 1;
  if (latencyReservoir.length < RESERVOIR_SIZE) {
    latencyReservoir.push(ms);
    return;
  }
  const idx = Math.floor(Math.random() * latencySampleCount);
  if (idx < RESERVOIR_SIZE) latencyReservoir[idx] = ms;
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  const idx = Math.min(sortedArr.length - 1, Math.floor(sortedArr.length * p));
  return sortedArr[idx];
}

const clients = [];
let clientIndex = 0;
for (let r = 0; r < rooms; r++) {
  const roomId = `loadtest-room-${r}-${Date.now()}`;
  for (let c = 0; c < clientsPerRoom; c++) {
    const userId = `lt-${clientIndex.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    clientIndex += 1;
    const isMoving = c / clientsPerRoom < movingRatio;
    const client = createLoadTestClient({
      wsUrl,
      secret,
      kid,
      roomId,
      userId,
      mapW,
      mapH,
      hz,
      moving: isMoving,
      onLatencySample: recordLatency,
      stats,
    });
    clients.push(client);
  }
}

// 条件1(全員同時接続): stagger未指定なら全員ほぼ同時に接続する。
for (const client of clients) client.start();

// 条件5・6(同時入退室・切断と再接続)のシミュレーション。
let churnTimer = null;
if (churnIntervalSec > 0 && churnFraction > 0) {
  churnTimer = setInterval(() => {
    const targetCount = Math.floor(clients.length * churnFraction);
    const shuffled = [...clients].sort(() => Math.random() - 0.5).slice(0, targetCount);
    console.log(`[loadtest] churn: ${shuffled.length}件を強制切断(再接続は自動)`);
    shuffled.forEach((c) => c.forceDisconnect());
  }, churnIntervalSec * 1000);
}

const startedAt = Date.now();
const reportTimer = setInterval(() => {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(
    `[loadtest] t=${elapsed}s connectAttempts=${stats.connectAttempts} connectSuccess=${stats.connectSuccess} protocolAbuseDisconnects=${stats.protocolAbuseDisconnects} latencySamples=${latencySampleCount}`,
  );
}, 10_000);

setTimeout(() => {
  if (churnTimer) clearInterval(churnTimer);
  clearInterval(reportTimer);
  for (const client of clients) client.stop();

  const sorted = [...latencyReservoir].sort((a, b) => a - b);
  console.log("");
  console.log("=== 負荷試験結果 ===");
  console.log(`接続試行: ${stats.connectAttempts} / 接続成功: ${stats.connectSuccess}`);
  console.log(`4005(不正メッセージ連打)切断: ${stats.protocolAbuseDisconnects}件(0件であるべき)`);
  console.log(`配信遅延サンプル数: ${latencySampleCount}(うち${sorted.length}件を集計に使用)`);
  if (sorted.length > 0) {
    console.log(`p50: ${percentile(sorted, 0.5)}ms`);
    console.log(`p95: ${percentile(sorted, 0.95)}ms`);
    console.log(`p99: ${percentile(sorted, 0.99)}ms`);
  }
  process.exit(0);
}, durationSec * 1000);
