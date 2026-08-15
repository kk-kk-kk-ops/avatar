import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState } from "@/lib/authRouting";
import { parsePrometheusText, sumMetric, type MetricSample } from "@/lib/prometheusMetrics";
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

// grovina-livekit-prod上のnode_exporterから生のメトリクスをまとめて取得する。
// CPU%・帯域(Mbps)はカウンタの差分(レート)でしか出せないが、このRoute
// Handlerはリクエストごとに状態を持たない(Vercelのサーバーレス関数)ため、
// ここでは前回値との差分計算はしない。差分計算はクライアント側
// (app/master/ServerResourceTable.tsx)で、30秒ごとのポーリング間隔を使って行う。
//
// Redis(redis-tcp行)の稼働状況もこの同じレスポンスから読み取る
// (redis_upというtextfile collectorメトリクス。grovina-livekit-prod上の
// cron(check-redis.sh)が1分おきに書き出している)。Vercelから
// Redisへ直接TCP接続する方式は、WebARENA Indigo側のネットワークで外部
// からの到達がブロックされており常に「停止中」に誤表示されていたため、
// 実際にRedisへ到達できているgrovina-livekit-prod経由に切り替えた。
async function fetchNodeExporterMetrics(): Promise<
  Map<string, MetricSample[]> | { error: string }
> {
  const url = process.env.METRICS_URL;
  const authUser = process.env.METRICS_BASIC_AUTH_USER;
  const authPass = process.env.METRICS_BASIC_AUTH_PASSWORD;
  if (!url || !authUser || !authPass) {
    return { error: "メトリクスの設定が不足しています" };
  }

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
      return { error: `node_exporterからの応答が異常です(${res.status})` };
    }
    const text = await res.text();
    return parsePrometheusText(text);
  } catch (err) {
    console.error("node_exporterへの接続に失敗しました", err);
    return { error: "node_exporterに接続できません" };
  }
}

function buildNodeExporterResult(
  id: string,
  metrics: Map<string, MetricSample[]>,
): NodeExporterResult {
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

  // node_exporterの取得は1回だけ行い、node-exporter行・redis-tcp行の両方の
  // 結果をそこから導出する(redis-tcp行の詳細は上のfetchNodeExporterMetrics
  // のコメント参照)。
  const metricsResult = await fetchNodeExporterMetrics();

  const servers: ServerResult[] = SERVER_ROWS.map((row: ServerRowConfig) => {
    if ("error" in metricsResult) {
      return row.kind === "redis-tcp"
        ? { id: row.id, kind: "redis-tcp", reachable: false }
        : { id: row.id, kind: "node-exporter", error: metricsResult.error };
    }
    if (row.kind === "redis-tcp") {
      const reachable = sumMetric(metricsResult, "redis_up", () => true) === 1;
      return { id: row.id, kind: "redis-tcp", reachable };
    }
    return buildNodeExporterResult(row.id, metricsResult);
  });

  return NextResponse.json({ timestampMs: Date.now(), servers });
}
