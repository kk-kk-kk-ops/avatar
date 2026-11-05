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
import os from "node:os";
import { createLoadTestClient } from "./client.mjs";

// 試験側(生成元マシン)のCPU使用率を計測する(2026-11追加、Tech Lead
// 指摘: 試験側がボトルネックになっていないか判別できるようにするため)。
// os.cpus()の累積値同士の差分から、サンプリング区間内の使用率を算出する。
// 外部コマンド(vnstat/sar等)への依存を避け、生成元マシンに何もインストール
// せず使えるようにするための選択。
function cpuUsageSnapshot() {
  return os.cpus().map((c) => ({ ...c.times }));
}
function cpuUsagePercent(prev, curr) {
  let idleDiff = 0;
  let totalDiff = 0;
  for (let i = 0; i < curr.length; i++) {
    const p = prev[i];
    const c = curr[i];
    const idle = c.idle - p.idle;
    const total =
      c.user - p.user + (c.nice - p.nice) + (c.sys - p.sys) + idle + (c.irq - p.irq);
    idleDiff += idle;
    totalDiff += total;
  }
  if (totalDiff <= 0) return 0;
  return (1 - idleDiff / totalDiff) * 100;
}

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

// 試験側マシンのCPU使用率・受信帯域のサンプリング(2026-11追加)。
let lastCpuSnapshot = cpuUsageSnapshot();
let lastReceivedBytesTotal = 0;
let lastSampleAt = Date.now();
const cpuSamples = [];
const recvMbpsSamples = [];

const startedAt = Date.now();
const reportTimer = setInterval(() => {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);

  const now = Date.now();
  const currCpuSnapshot = cpuUsageSnapshot();
  const cpuPercent = cpuUsagePercent(lastCpuSnapshot, currCpuSnapshot);
  lastCpuSnapshot = currCpuSnapshot;
  cpuSamples.push(cpuPercent);

  const receivedBytesTotal = clients.reduce(
    (sum, c) => sum + c.counters.receivedBytes,
    0,
  );
  const intervalSec = (now - lastSampleAt) / 1000;
  const recvMbps =
    intervalSec > 0
      ? ((receivedBytesTotal - lastReceivedBytesTotal) * 8) / 1_000_000 / intervalSec
      : 0;
  lastReceivedBytesTotal = receivedBytesTotal;
  lastSampleAt = now;
  recvMbpsSamples.push(recvMbps);

  console.log(
    `[loadtest] t=${elapsed}s connectAttempts=${stats.connectAttempts} connectSuccess=${stats.connectSuccess} protocolAbuseDisconnects=${stats.protocolAbuseDisconnects} latencySamples=${latencySampleCount} generatorCpu=${cpuPercent.toFixed(1)}% generatorRecv=${recvMbps.toFixed(1)}Mbps`,
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

  // 配信取りこぼし率(2026-11追加): 各クライアントについて「同じルームの
  // 他クライアントが実際に送信した件数の合計(=本来届くはずだった件数)」と
  // 「自分が実際に受信した件数」を比較する。
  const byRoom = new Map();
  for (const c of clients) {
    if (!byRoom.has(c.roomId)) byRoom.set(c.roomId, []);
    byRoom.get(c.roomId).push(c);
  }
  let totalExpected = 0;
  let totalActual = 0;
  for (const roomClients of byRoom.values()) {
    const totalSentInRoom = roomClients.reduce((sum, c) => sum + c.counters.sentCount, 0);
    for (const c of roomClients) {
      const expected = totalSentInRoom - c.counters.sentCount; // 自分以外の送信合計
      totalExpected += expected;
      totalActual += c.counters.receivedCount;
    }
  }
  const deliveryRate = totalExpected > 0 ? (totalActual / totalExpected) * 100 : null;
  console.log("");
  console.log(
    `配信成功率: ${deliveryRate !== null ? deliveryRate.toFixed(2) + "%" : "算出不可(送信が無かった)"}(期待件数=${totalExpected}、実受信件数=${totalActual})`,
  );

  // 試験側(生成元)マシンのリソース使用状況(2026-11追加)。これが高い
  // (特にCPUが張り付いている)場合、上記の指標がサーバー側ではなく
  // 試験側の限界を反映している可能性がある。
  const avgCpu = cpuSamples.length
    ? cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length
    : 0;
  const peakCpu = cpuSamples.length ? Math.max(...cpuSamples) : 0;
  const avgRecvMbps = recvMbpsSamples.length
    ? recvMbpsSamples.reduce((a, b) => a + b, 0) / recvMbpsSamples.length
    : 0;
  const peakRecvMbps = recvMbpsSamples.length ? Math.max(...recvMbpsSamples) : 0;
  console.log("");
  console.log(
    `試験側(生成元)マシン: CPU平均${avgCpu.toFixed(1)}% / ピーク${peakCpu.toFixed(1)}%、受信帯域平均${avgRecvMbps.toFixed(1)}Mbps / ピーク${peakRecvMbps.toFixed(1)}Mbps`,
  );
  console.log(
    "(CPUが高止まりしている、または受信帯域が頭打ちで伸びていない場合は、試験側がボトルネックの可能性があります)",
  );
  process.exit(0);
}, durationSec * 1000);
