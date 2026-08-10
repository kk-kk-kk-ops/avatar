// Prometheusのtext exposition formatを最小限パースする。
// node_exporterの出力専用の割り切った実装で、汎用性は狙わない
// (prom-client等の依存追加を避けるため。ラベル値にカンマを含む
// ケースはnode_exporterの出力には現れないため未対応)。

export type MetricSample = { labels: Record<string, string>; value: number };

export function parsePrometheusText(text: string): Map<string, MetricSample[]> {
  const result = new Map<string, MetricSample[]>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const spaceIdx = line.lastIndexOf(" ");
    if (spaceIdx === -1) continue;
    const value = Number(line.slice(spaceIdx + 1));
    if (Number.isNaN(value)) continue;

    const metricPart = line.slice(0, spaceIdx);
    const braceIdx = metricPart.indexOf("{");
    const name = braceIdx === -1 ? metricPart : metricPart.slice(0, braceIdx);

    const labels: Record<string, string> = {};
    if (braceIdx !== -1) {
      const labelPart = metricPart.slice(braceIdx + 1, metricPart.lastIndexOf("}"));
      labelPart.split(",").forEach((pair) => {
        const eq = pair.indexOf("=");
        if (eq === -1) return;
        labels[pair.slice(0, eq)] = pair.slice(eq + 1).replace(/^"|"$/g, "");
      });
    }

    if (!result.has(name)) result.set(name, []);
    result.get(name)!.push({ labels, value });
  }
  return result;
}

// 指定したメトリクス名のうち、predicateに一致するサンプルの値を合計する。
// (例: node_cpu_seconds_totalをcore横断で合計する、node_network_*_bytes_totalを
// インターフェース横断で合計する、など)
export function sumMetric(
  metrics: Map<string, MetricSample[]>,
  name: string,
  predicate: (labels: Record<string, string>) => boolean,
): number {
  return (metrics.get(name) ?? [])
    .filter((s) => predicate(s.labels))
    .reduce((total, s) => total + s.value, 0);
}
