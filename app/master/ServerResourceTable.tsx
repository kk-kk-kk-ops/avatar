"use client";

import { useEffect, useRef, useState } from "react";
import { SERVER_ROWS } from "@/lib/serverMetricsConfig";

type NodeExporterSample = {
  cpu: { idleSecondsTotal: number; totalSecondsTotal: number };
  network: { rxBytesTotal: number; txBytesTotal: number };
  memoryUsedPercent: number;
  tcpConnections: number;
};

type ServerResult =
  | ({ id: string; kind: "node-exporter" } & (
      | NodeExporterSample
      | { error: string }
    ))
  | { id: string; kind: "redis-tcp"; reachable: boolean };

type ApiResponse = { timestampMs: number; servers: ServerResult[] };

type NodeExporterDerived = {
  cpuPercent: number | null;
  ramPercent: number;
  downMbps: number | null;
  upMbps: number | null;
  tcpConnections: number;
};

// マスター画面「サーバーリソース一覧」表。/api/master/server-metricsを
// 30秒おきにポーリングし、行の種別(node-exporterのフル指標 / redisの
// 簡易稼働状況)ごとに表示を出し分ける。CPU%・Mbpsはカウンタ値のため、
// node-exporter行ごとに前回サンプルとの差分から算出する
// (詳細はapp/api/master/server-metrics/route.tsのコメント参照)。
export default function ServerResourceTable() {
  const [derivedById, setDerivedById] = useState<Map<string, NodeExporterDerived>>(new Map());
  const [errorById, setErrorById] = useState<Map<string, string>>(new Map());
  const [reachableById, setReachableById] = useState<Map<string, boolean>>(new Map());
  const [unreachable, setUnreachable] = useState(false);
  const prevSamples = useRef<Map<string, { timestampMs: number } & NodeExporterSample>>(new Map());

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch("/api/master/server-metrics");
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data: ApiResponse = await res.json();
        if (cancelled) return;
        setUnreachable(false);

        // 毎回のレスポンスに常に全行分のデータが含まれるため、前回の
        // 表示状態とマージする必要はなく、都度作り直すだけでよい。
        const nextDerived = new Map<string, NodeExporterDerived>();
        const nextErrors = new Map<string, string>();
        const nextReachable = new Map<string, boolean>();

        for (const server of data.servers) {
          if (server.kind === "redis-tcp") {
            nextReachable.set(server.id, server.reachable);
            continue;
          }
          if ("error" in server) {
            nextErrors.set(server.id, server.error);
            continue;
          }
          nextErrors.delete(server.id);

          const prev = prevSamples.current.get(server.id);
          let cpuPercent: number | null = null;
          let downMbps: number | null = null;
          let upMbps: number | null = null;
          if (prev) {
            const elapsedSec = (data.timestampMs - prev.timestampMs) / 1000;
            if (elapsedSec > 0) {
              const dTotal = server.cpu.totalSecondsTotal - prev.cpu.totalSecondsTotal;
              const dIdle = server.cpu.idleSecondsTotal - prev.cpu.idleSecondsTotal;
              cpuPercent =
                dTotal > 0 ? Math.max(0, Math.min(100, 100 * (1 - dIdle / dTotal))) : null;
              const dRx = server.network.rxBytesTotal - prev.network.rxBytesTotal;
              const dTx = server.network.txBytesTotal - prev.network.txBytesTotal;
              downMbps = Math.max(0, (dRx * 8) / 1_000_000 / elapsedSec);
              upMbps = Math.max(0, (dTx * 8) / 1_000_000 / elapsedSec);
            }
          }
          prevSamples.current.set(server.id, { timestampMs: data.timestampMs, ...server });
          nextDerived.set(server.id, {
            cpuPercent,
            ramPercent: server.memoryUsedPercent,
            downMbps,
            upMbps,
            tcpConnections: server.tcpConnections,
          });
        }

        setDerivedById(nextDerived);
        setErrorById(nextErrors);
        setReachableById(nextReachable);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("サーバーメトリクスの取得に失敗しました", err);
        if (!cancelled) setUnreachable(true);
      }
    };

    poll();
    const interval = setInterval(poll, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-slate-500">サーバーリソース一覧</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-center text-sm">
          <thead>
            <tr className="text-[11px] text-slate-500">
              <th className="pb-2 text-left font-semibold">サーバー名</th>
              <th className="pb-2 font-semibold">CPU</th>
              <th className="pb-2 font-semibold">RAM</th>
              <th className="pb-2 font-semibold">下り</th>
              <th className="pb-2 font-semibold">上り</th>
              <th className="pb-2 font-semibold">TCP接続数</th>
            </tr>
          </thead>
          <tbody>
            {SERVER_ROWS.map((row) => {
              if (row.kind === "redis-tcp") {
                const reachable = reachableById.get(row.id);
                return (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="py-2 text-left font-medium text-slate-700">{row.name}</td>
                    <td className="py-2" colSpan={5}>
                      <StatusBadge reachable={unreachable ? undefined : reachable} />
                    </td>
                  </tr>
                );
              }

              const derived = derivedById.get(row.id);
              const error = errorById.get(row.id);
              return (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="py-2 text-left font-medium text-slate-700">{row.name}</td>
                  {error ? (
                    <td className="py-2 text-slate-400" colSpan={5}>
                      取得できません
                    </td>
                  ) : (
                    <>
                      <td className="py-2 font-bold text-slate-800">
                        {fmtPercent(derived?.cpuPercent)}
                      </td>
                      <td className="py-2 font-bold text-slate-800">
                        {derived ? `${derived.ramPercent.toFixed(0)}%` : "…"}
                      </td>
                      <td className="py-2 font-bold text-slate-800">
                        {fmtMbps(derived?.downMbps)}
                      </td>
                      <td className="py-2 font-bold text-slate-800">
                        {fmtMbps(derived?.upMbps)}
                      </td>
                      <td className="py-2 font-bold text-slate-800">
                        {derived ? String(derived.tcpConnections) : "…"}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {unreachable && (
        <p className="mt-1 text-[10px] text-orange-500">
          前回取得時点の値です(現在取得できません)
        </p>
      )}
    </div>
  );
}

function StatusBadge({ reachable }: { reachable: boolean | undefined }) {
  if (reachable === undefined) {
    return <span className="text-sm text-slate-400">計測中…</span>;
  }
  return reachable ? (
    <span className="inline-block rounded-full bg-emerald-100 px-3 py-0.5 text-xs font-semibold text-emerald-700">
      稼働中
    </span>
  ) : (
    <span className="inline-block rounded-full bg-red-100 px-3 py-0.5 text-xs font-semibold text-red-700">
      停止中
    </span>
  );
}

function fmtPercent(v: number | null | undefined) {
  return v == null ? "…" : `${v.toFixed(0)}%`;
}

function fmtMbps(v: number | null | undefined) {
  return v == null ? "…" : `${v.toFixed(1)}Mbps`;
}
