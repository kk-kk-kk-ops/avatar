import { describe, expect, it } from "vitest";
import { parsePrometheusText, sumMetric } from "./prometheusMetrics";

// node_exporterの実際の出力を模した固定フィクスチャ(#HELP/#TYPEコメント、
// 複数コア分のラベル付きカウンタ、ラベル無しゲージを含む)。
const FIXTURE = `
# HELP node_cpu_seconds_total Seconds the CPUs spent in each mode.
# TYPE node_cpu_seconds_total counter
node_cpu_seconds_total{cpu="0",mode="idle"} 1000.5
node_cpu_seconds_total{cpu="0",mode="user"} 200.25
node_cpu_seconds_total{cpu="1",mode="idle"} 900.1
node_cpu_seconds_total{cpu="1",mode="user"} 300.4
# HELP node_memory_MemTotal_bytes Total memory.
# TYPE node_memory_MemTotal_bytes gauge
node_memory_MemTotal_bytes 8.192e+09
node_memory_MemAvailable_bytes 2.048e+09
node_network_receive_bytes_total{device="eth0"} 123456
node_network_transmit_bytes_total{device="eth0"} 65432
node_netstat_Tcp_CurrEstab 42
`;

describe("parsePrometheusText", () => {
  it("同名メトリクスをラベル付きで複数サンプル取得できる", () => {
    const metrics = parsePrometheusText(FIXTURE);
    const cpu = metrics.get("node_cpu_seconds_total");
    expect(cpu).toHaveLength(4);
    expect(cpu?.[0]).toEqual({ labels: { cpu: "0", mode: "idle" }, value: 1000.5 });
  });

  it("ラベル無しのゲージも取得できる", () => {
    const metrics = parsePrometheusText(FIXTURE);
    expect(metrics.get("node_netstat_Tcp_CurrEstab")).toEqual([{ labels: {}, value: 42 }]);
  });

  it("指数表記の値を正しく数値として解釈する", () => {
    const metrics = parsePrometheusText(FIXTURE);
    expect(metrics.get("node_memory_MemTotal_bytes")?.[0].value).toBe(8.192e9);
  });

  it("#HELP/#TYPEコメント行を無視する", () => {
    const metrics = parsePrometheusText(FIXTURE);
    expect(metrics.has("HELP")).toBe(false);
  });
});

describe("sumMetric", () => {
  it("複数コア分のnode_cpu_seconds_totalをmodeでフィルタして合計する", () => {
    const metrics = parsePrometheusText(FIXTURE);
    const idleTotal = sumMetric(metrics, "node_cpu_seconds_total", (l) => l.mode === "idle");
    expect(idleTotal).toBeCloseTo(1000.5 + 900.1);
  });

  it("存在しないメトリクス名は0を返す", () => {
    const metrics = parsePrometheusText(FIXTURE);
    expect(sumMetric(metrics, "does_not_exist", () => true)).toBe(0);
  });

  it("ラベル無しメトリクスもpredicateがtrueなら合計できる", () => {
    const metrics = parsePrometheusText(FIXTURE);
    expect(sumMetric(metrics, "node_netstat_Tcp_CurrEstab", () => true)).toBe(42);
  });
});
