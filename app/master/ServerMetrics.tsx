"use client";

import { useEffect, useRef, useState } from "react";

type RawSample = {
  timestampMs: number;
  cpu: { idleSecondsTotal: number; totalSecondsTotal: number };
  network: { rxBytesTotal: number; txBytesTotal: number };
  memoryUsedPercent: number;
  tcpConnections: number;
};

type Derived = {
  cpuPercent: number | null;
  ramPercent: number;
  downMbps: number | null;
  upMbps: number | null;
  tcpConnections: number;
};

// VPS(grovina-livekit-prod)のリソース状況をnode_exporter経由で表示する。
// CPU%・Mbpsはカウンタ値のため、前回ポーリング(30秒間隔)との差分から
// 算出する(詳細はapp/api/master/server-metrics/route.tsのコメント参照)。
// マウント直後は前回値が無いため、それらのみ「計測中…」を表示する。
export default function ServerMetrics() {
  const [derived, setDerived] = useState<Derived | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const prevSample = useRef<RawSample | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch("/api/master/server-metrics");
        if (!res.ok) throw new Error(`status ${res.status}`);
        const sample: RawSample = await res.json();
        if (cancelled) return;
        setUnreachable(false);

        const prev = prevSample.current;
        let cpuPercent: number | null = null;
        let downMbps: number | null = null;
        let upMbps: number | null = null;
        if (prev) {
          const elapsedSec = (sample.timestampMs - prev.timestampMs) / 1000;
          if (elapsedSec > 0) {
            const dTotal = sample.cpu.totalSecondsTotal - prev.cpu.totalSecondsTotal;
            const dIdle = sample.cpu.idleSecondsTotal - prev.cpu.idleSecondsTotal;
            cpuPercent =
              dTotal > 0 ? Math.max(0, Math.min(100, 100 * (1 - dIdle / dTotal))) : null;
            const dRx = sample.network.rxBytesTotal - prev.network.rxBytesTotal;
            const dTx = sample.network.txBytesTotal - prev.network.txBytesTotal;
            downMbps = Math.max(0, (dRx * 8) / 1_000_000 / elapsedSec);
            upMbps = Math.max(0, (dTx * 8) / 1_000_000 / elapsedSec);
          }
        }
        prevSample.current = sample;
        setDerived({
          cpuPercent,
          ramPercent: sample.memoryUsedPercent,
          downMbps,
          upMbps,
          tcpConnections: sample.tcpConnections,
        });
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
      <p className="text-xs font-semibold text-slate-500">grovina-livekit-prod</p>
      {!derived && unreachable ? (
        <p className="mt-1 text-sm text-slate-400">取得できません</p>
      ) : (
        <div className="mt-1 grid grid-cols-5 gap-x-3 text-center">
          <Metric label="CPU" value={fmtPercent(derived?.cpuPercent)} />
          <Metric label="RAM" value={derived ? `${derived.ramPercent.toFixed(0)}%` : "…"} />
          <Metric label="↓" value={fmtMbps(derived?.downMbps)} />
          <Metric label="↑" value={fmtMbps(derived?.upMbps)} />
          <Metric label="TCP" value={derived ? String(derived.tcpConnections) : "…"} />
        </div>
      )}
      {unreachable && derived && (
        <p className="mt-1 text-[10px] text-orange-500">
          前回取得時点の値です(現在取得できません)
        </p>
      )}
    </div>
  );
}

function fmtPercent(v: number | null | undefined) {
  return v == null ? "計測中…" : `${v.toFixed(0)}%`;
}

function fmtMbps(v: number | null | undefined) {
  return v == null ? "計測中…" : `${v.toFixed(1)}Mbps`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-bold text-slate-800">{value}</p>
      <p className="text-[10px] text-slate-500">{label}</p>
    </div>
  );
}
