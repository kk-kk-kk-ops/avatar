"use client";

// 画面共有の画質調査(2026-11-27)用、運営者(または?ssdebug=1を付けた人)
// だけに見える計測パネル。最初は閉じた状態で、開いている間だけ2秒ごとに
// 統計を取得する(閉じている間はgetStatsを呼ばない)。送信中は自分の
// LocalVideoTrack(画面共有)のRTCRtpSender.getStats()を、受信中は相手の
// RemoteVideoTrack(画面共有)のRTCRtpReceiver.getStats()を読み、層ごとの
// 解像度・fps・ビットレート・コーデック等を表示する。livekit-clientの
// getSenderStats/getReceiverStatsは一部の項目(encoderImplementation・
// 層のactive・totalDecodeTime)を持たないため、ここではRTCRtpSender/
// RTCRtpReceiverの生のgetStats()を直接読む。
import { useEffect, useRef, useState } from "react";
import {
  type LocalVideoTrack,
  type RemoteTrackPublication,
  type RemoteVideoTrack,
} from "livekit-client";

const POLL_INTERVAL_MS = 2000;

type SenderLayerStat = {
  rid: string;
  frameWidth?: number;
  frameHeight?: number;
  framesPerSecond?: number;
  kbps: number;
  qualityLimitationReason?: string;
  mimeType?: string;
  encoderImplementation?: string;
  active?: boolean;
};

type ReceiverStat = {
  frameWidth?: number;
  frameHeight?: number;
  framesPerSecond?: number;
  kbps: number;
  mimeType?: string;
  packetsLost?: number;
  nackCount?: number;
  framesDropped?: number;
  decodeMsPerFrame?: number;
};

type Totals = {
  direction: "send" | "receive" | null;
  totalMB: number;
  avgKbps: number;
  maxKbps: number;
};

type Props = {
  visible: boolean;
  isSharingSelf: boolean;
  activeProfileLabel: string;
  getLocalScreenTrack: () => LocalVideoTrack | null;
  getRemoteScreenPublication: () => RemoteTrackPublication | undefined;
  getDisplayBoxElement: () => HTMLDivElement | null;
};

export default function ScreenShareStatsPanel({
  visible,
  isSharingSelf,
  activeProfileLabel,
  getLocalScreenTrack,
  getRemoteScreenPublication,
  getDisplayBoxElement,
}: Props) {
  const [open, setOpen] = useState(false);
  const [senderLayers, setSenderLayers] = useState<SenderLayerStat[]>([]);
  const [receiverStat, setReceiverStat] = useState<ReceiverStat | null>(null);
  const [displayBox, setDisplayBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [totals, setTotals] = useState<Totals>({
    direction: null,
    totalMB: 0,
    avgKbps: 0,
    maxKbps: 0,
  });

  // 累積(合計MB・平均/最大kbps)計算用。送信⇄受信の切り替えや、受信相手の
  // 切り替え、共有の再開(バイト数がリセットされる)を検知したら
  // ゼロから計算し直す。
  const prevSenderBytesRef = useRef<Map<string, { bytes: number; t: number }>>(new Map());
  const prevReceiverRef = useRef<{ bytes: number; t: number } | null>(null);
  const baselineRef = useRef<{ key: string | null; startBytes: number }>({
    key: null,
    startBytes: 0,
  });
  const kbpsSamplesRef = useRef<number[]>([]);

  useEffect(() => {
    if (!visible || !open) return;
    let cancelled = false;

    const resetAccumulationIfNeeded = (key: string, totalBytesNow: number) => {
      if (
        baselineRef.current.key !== key ||
        totalBytesNow < baselineRef.current.startBytes
      ) {
        baselineRef.current = { key, startBytes: totalBytesNow };
        kbpsSamplesRef.current = [];
        prevSenderBytesRef.current = new Map();
        prevReceiverRef.current = null;
      }
    };

    const tick = async () => {
      if (cancelled) return;

      const box = getDisplayBoxElement();
      setDisplayBox(box ? { width: box.clientWidth, height: box.clientHeight } : null);

      if (isSharingSelf) {
        const track = getLocalScreenTrack();
        const sender = track?.sender;
        if (!sender || !sender.getStats) {
          setSenderLayers([]);
          setReceiverStat(null);
          return;
        }
        try {
          const report = await sender.getStats();
          const codecMimeTypes = new Map<string, string>();
          report.forEach((v: any) => {
            if (v.type === "codec") codecMimeTypes.set(v.id, v.mimeType);
          });
          const layers: SenderLayerStat[] = [];
          let totalBytesNow = 0;
          const nowSnapshot = new Map<string, { bytes: number; t: number }>();
          report.forEach((v: any) => {
            if (v.type !== "outbound-rtp" || v.kind !== "video") return;
            const rid: string = v.rid || v.id;
            const bytesSent: number = v.bytesSent ?? 0;
            totalBytesNow += bytesSent;
            const prev = prevSenderBytesRef.current.get(rid);
            const kbps =
              prev && v.timestamp > prev.t
                ? ((bytesSent - prev.bytes) * 8) / (v.timestamp - prev.t)
                : 0;
            nowSnapshot.set(rid, { bytes: bytesSent, t: v.timestamp });
            layers.push({
              rid,
              frameWidth: v.frameWidth,
              frameHeight: v.frameHeight,
              framesPerSecond: v.framesPerSecond,
              kbps: Math.max(0, Math.round(kbps)),
              qualityLimitationReason: v.qualityLimitationReason,
              mimeType: v.codecId ? codecMimeTypes.get(v.codecId) : undefined,
              encoderImplementation: v.encoderImplementation,
              active: v.active,
            });
          });
          layers.sort((a, b) => (b.frameWidth ?? 0) - (a.frameWidth ?? 0));
          prevSenderBytesRef.current = nowSnapshot;
          setSenderLayers(layers);
          setReceiverStat(null);

          resetAccumulationIfNeeded("send", totalBytesNow);
          const totalKbpsNow = layers.reduce((sum, l) => sum + l.kbps, 0);
          if (totalKbpsNow > 0) kbpsSamplesRef.current.push(totalKbpsNow);
          const samples = kbpsSamplesRef.current;
          const avgKbps = samples.length
            ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
            : 0;
          const maxKbps = samples.length ? Math.max(...samples) : 0;
          const totalMB = (totalBytesNow - baselineRef.current.startBytes) / (1024 * 1024);
          setTotals({ direction: "send", totalMB: Math.max(0, totalMB), avgKbps, maxKbps });
        } catch {
          // 統計取得に失敗した場合は前回の表示を維持する(無視してよい)
        }
        return;
      }

      const publication = getRemoteScreenPublication();
      const track = publication?.track as RemoteVideoTrack | undefined;
      const receiver = track?.receiver;
      if (!receiver || !receiver.getStats || !publication) {
        setReceiverStat(null);
        setSenderLayers([]);
        return;
      }
      try {
        const report = await receiver.getStats();
        const codecMimeTypes = new Map<string, string>();
        report.forEach((v: any) => {
          if (v.type === "codec") codecMimeTypes.set(v.id, v.mimeType);
        });
        let stat: ReceiverStat | null = null;
        report.forEach((v: any) => {
          if (v.type !== "inbound-rtp" || v.kind !== "video") return;
          const bytesReceived: number = v.bytesReceived ?? 0;
          const prev = prevReceiverRef.current;
          const kbps =
            prev && v.timestamp > prev.t
              ? ((bytesReceived - prev.bytes) * 8) / (v.timestamp - prev.t)
              : 0;
          prevReceiverRef.current = { bytes: bytesReceived, t: v.timestamp };
          stat = {
            frameWidth: v.frameWidth,
            frameHeight: v.frameHeight,
            framesPerSecond: v.framesPerSecond,
            kbps: Math.max(0, Math.round(kbps)),
            mimeType: v.codecId ? codecMimeTypes.get(v.codecId) : undefined,
            packetsLost: v.packetsLost,
            nackCount: v.nackCount,
            framesDropped: v.framesDropped,
            decodeMsPerFrame:
              v.framesDecoded > 0 ? (v.totalDecodeTime / v.framesDecoded) * 1000 : undefined,
          };

          resetAccumulationIfNeeded(`receive:${publication.trackSid}`, bytesReceived);
          if (stat.kbps > 0) kbpsSamplesRef.current.push(stat.kbps);
          const samples = kbpsSamplesRef.current;
          const avgKbps = samples.length
            ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
            : 0;
          const maxKbps = samples.length ? Math.max(...samples) : 0;
          const totalMB = (bytesReceived - baselineRef.current.startBytes) / (1024 * 1024);
          setTotals({ direction: "receive", totalMB: Math.max(0, totalMB), avgKbps, maxKbps });
        });
        setReceiverStat(stat);
        setSenderLayers([]);
      } catch {
        // 統計取得に失敗した場合は前回の表示を維持する(無視してよい)
      }
    };

    tick();
    const timer = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    visible,
    open,
    isSharingSelf,
    getLocalScreenTrack,
    getRemoteScreenPublication,
    getDisplayBoxElement,
  ]);

  if (!visible) return null;

  return (
    <div className="pointer-events-auto fixed bottom-2 right-2 z-50 w-56 rounded-md bg-black/85 text-[10px] leading-tight text-slate-100 shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2 py-1">
        <span className="font-semibold">画面共有テスト計測</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded bg-white/10 px-1.5 py-0.5 text-slate-200 hover:bg-white/20"
        >
          {open ? "閉じる" : "開く"}
        </button>
      </div>
      {open && (
        <div className="max-h-72 space-y-2 overflow-auto px-2 py-2">
          {isSharingSelf ? (
            <div>
              <div className="mb-1 text-slate-300">送信中(設定: {activeProfileLabel})</div>
              {senderLayers.length === 0 && (
                <div className="text-slate-400">統計取得待ち…</div>
              )}
              {senderLayers.map((l) => (
                <div key={l.rid} className="mb-1 border-b border-white/10 pb-1 last:border-none">
                  <div>
                    層 {l.rid}
                    {l.active === false ? "(無効)" : ""}
                  </div>
                  <div>
                    {l.frameWidth ?? "-"}x{l.frameHeight ?? "-"} / {l.framesPerSecond ?? "-"}
                    fps / {l.kbps}kbps
                  </div>
                  <div>
                    制限理由: {l.qualityLimitationReason ?? "-"} / {l.mimeType ?? "-"}
                  </div>
                  <div>encoder: {l.encoderImplementation ?? "-"}</div>
                </div>
              ))}
            </div>
          ) : receiverStat ? (
            <div>
              <div className="mb-1 text-slate-300">受信中</div>
              <div>
                {receiverStat.frameWidth ?? "-"}x{receiverStat.frameHeight ?? "-"} /{" "}
                {receiverStat.framesPerSecond ?? "-"}fps / {receiverStat.kbps}kbps
              </div>
              <div>{receiverStat.mimeType ?? "-"}</div>
              <div>
                lost: {receiverStat.packetsLost ?? "-"} / nack: {receiverStat.nackCount ?? "-"}{" "}
                / drop: {receiverStat.framesDropped ?? "-"}
              </div>
              <div>
                decode/frame:{" "}
                {receiverStat.decodeMsPerFrame !== undefined
                  ? `${receiverStat.decodeMsPerFrame.toFixed(2)}ms`
                  : "-"}
              </div>
              <div>
                表示枠: {displayBox ? `${displayBox.width}x${displayBox.height}` : "-"} (DPR{" "}
                {typeof window !== "undefined" ? window.devicePixelRatio : "-"})
              </div>
            </div>
          ) : (
            <div className="text-slate-400">画面共有なし</div>
          )}
          {totals.direction && (
            <div className="border-t border-white/10 pt-1 text-slate-300">
              合計 {totals.totalMB.toFixed(1)}MB / 平均 {totals.avgKbps}kbps / 最大{" "}
              {totals.maxKbps}kbps
            </div>
          )}
        </div>
      )}
    </div>
  );
}
