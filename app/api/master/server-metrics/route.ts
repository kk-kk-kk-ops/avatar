import { NextResponse } from "next/server";
import { connect } from "net";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState } from "@/lib/authRouting";
import { parsePrometheusText, sumMetric } from "@/lib/prometheusMetrics";
import { SERVER_ROWS, type ServerRowConfig } from "@/lib/serverMetricsConfig";

export const dynamic = "force-dynamic";

type NodeExporterResult =
  | {
      id: string;
      kind: "node-exporter";
      cpu: { idleSecondsTotal: number; totalSecondsTotal: number };
      network: { rxBytesTotal: number; txBytesTotal: number };
      memoryUsedPercent: number;
      tcpConnections: number;
    }
  | { id: string; kind: "node-exporter"; error: string };

type RedisTcpResult = { id: string; kind: "redis-tcp"; reachable: boolean };

type ServerResult = NodeExporterResult | RedisTcpResult;

// grovina-livekit-prod上のnode_exporterから生のカウンタ値を取得して返すだけの
// エンドポイント。CPU%・帯域(Mbps)はカウンタの差分(レート)でしか出せないが、
// このRoute Handlerはリクエストごとに状態を持たない(Vercelのサーバーレス
// 関数)ため、ここでは前回値との差分計算はしない。差分計算はクライアント側
// (app/master/ServerResourceTable.tsx)で、30秒ごとのポーリング間隔を使って行う。
async function fetchNodeExporter(id: string): Promise<NodeExporterResult> {
  const url = process.env.METRICS_URL;
  const authUser = process.env.METRICS_BASIC_AUTH_USER;
  const authPass = process.env.METRICS_BASIC_AUTH_PASSWORD;
  if (!url || !authUser || !authPass) {
    return { id, kind: "node-exporter", error: "メトリクスの設定が不足しています" };
  }

  let text: string;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${authUser}:${authPass}`).toString("base64"),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return {
        id,
        kind: "node-exporter",
        error: `node_exporterからの応答が異常です(${res.status})`,
      };
    }
    text = await res.text();
  } catch (err) {
    console.error("node_exporterへの接続に失敗しました", err);
    return { id, kind: "node-exporter", error: "node_exporterに接続できません" };
  }

  const metrics = parsePrometheusText(text);

  // guest/guest_niceはuser/nice内に既に含まれているため二重計上を避ける
  const cpuIdle = sumMetric(metrics, "node_cpu_seconds_total", (l) => l.mode === "idle");
  const cpuTotal = sumMetric(
    metrics,
    "node_cpu_seconds_total",
    (l) => l.mode !== "guest" && l.mode !== "guest_nice",
  );
  const rxBytes = sumMetric(metrics, "node_network_receive_bytes_total", () => true);
  const txBytes = sumMetric(metrics, "node_network_transmit_bytes_total", () => true);
  const memTotal = sumMetric(metrics, "node_memory_MemTotal_bytes", () => true);
  const memAvailable = sumMetric(metrics, "node_memory_MemAvailable_bytes", () => true);
  const tcpCurrEstab = sumMetric(metrics, "node_netstat_Tcp_CurrEstab", () => true);

  return {
    id,
    kind: "node-exporter",
    cpu: { idleSecondsTotal: cpuIdle, totalSecondsTotal: cpuTotal },
    network: { rxBytesTotal: rxBytes, txBytesTotal: txBytes },
    memoryUsedPercent: memTotal > 0 ? 100 * (1 - memAvailable / memTotal) : 0,
    tcpConnections: tcpCurrEstab,
  };
}

// Redisへの生TCP接続確認のみ行う(PING等のアプリケーションレベルの
// ヘルスチェックは行わない)。ポートが開いていて接続が確立できれば
// 「稼働中」とみなす。パスワード認証は不要なため、Vercel側に新たな
// Secretを追加せずに実装できる(詳細は導入時のPLANを参照)。
function checkRedisTcp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 3000 });
    const finish = (reachable: boolean) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function fetchServerResult(row: ServerRowConfig): Promise<ServerResult> {
  if (row.kind === "redis-tcp") {
    const reachable = await checkRedisTcp(row.host, row.port);
    return { id: row.id, kind: "redis-tcp", reachable };
  }
  return fetchNodeExporter(row.id);
}

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const state = await resolveUserRouteState(supabase, user.id);
  if (!state.isMaster) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const servers = await Promise.all(SERVER_ROWS.map(fetchServerResult));

  return NextResponse.json({ timestampMs: Date.now(), servers });
}
