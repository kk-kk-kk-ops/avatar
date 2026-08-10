import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState } from "@/lib/authRouting";
import { parsePrometheusText, sumMetric } from "@/lib/prometheusMetrics";

export const dynamic = "force-dynamic";

// grovina-livekit-prod上のnode_exporterから生のカウンタ値を取得して返すだけの
// エンドポイント。CPU%・帯域(Mbps)はカウンタの差分(レート)でしか出せないが、
// このRoute Handlerはリクエストごとに状態を持たない(Vercelのサーバーレス
// 関数)ため、ここでは前回値との差分計算はしない。差分計算はクライアント側
// (app/master/ServerMetrics.tsx)で、30秒ごとのポーリング間隔を使って行う。
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

  const url = process.env.METRICS_URL;
  const authUser = process.env.METRICS_BASIC_AUTH_USER;
  const authPass = process.env.METRICS_BASIC_AUTH_PASSWORD;
  if (!url || !authUser || !authPass) {
    return NextResponse.json(
      { error: "メトリクスの設定が不足しています" },
      { status: 500 },
    );
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
      return NextResponse.json(
        { error: `node_exporterからの応答が異常です(${res.status})` },
        { status: 502 },
      );
    }
    text = await res.text();
  } catch (err) {
    console.error("node_exporterへの接続に失敗しました", err);
    return NextResponse.json(
      { error: "node_exporterに接続できません" },
      { status: 502 },
    );
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

  return NextResponse.json({
    timestampMs: Date.now(),
    cpu: { idleSecondsTotal: cpuIdle, totalSecondsTotal: cpuTotal },
    network: { rxBytesTotal: rxBytes, txBytesTotal: txBytes },
    memoryUsedPercent: memTotal > 0 ? 100 * (1 - memAvailable / memTotal) : 0,
    tcpConnections: tcpCurrEstab,
  });
}
