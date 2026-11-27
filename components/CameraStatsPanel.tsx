"use client";

// カメラ(ビデオ通話)の画質調査(2026-11-27)用、運営者(または
// ?ssdebug=1を付けた人)だけに見える計測パネル。画面共有の計測パネル
// (ScreenShareStatsPanel)と同じ作り:最初は閉じた状態で、開いている間
// だけ2秒ごとに統計を取得する(閉じている間はgetStatsを呼ばない)。
// カメラはsimulcast無効(1層のみ)のため、画面共有のような層ごとの
// 一覧ではなく、送信は1件、受信は受け取っている相手ごとに1行で表示する。
import { useEffect, useRef, useState } from "react";
import type {
  LocalVideoTrack,
  RemoteTrackPublication,
  RemoteVideoTrack,
} from "livekit-client";

const POLL_INTERVAL_MS = 2000;

type SenderStat = {
  frameWidth?: number;
  frameHeight?: number;
  framesPerSecond?: number;
  kbps: number;
  qualityLimitationReason?: string;
  mimeType?: string;
  encoderImplementation?: string;
};

type ReceiverStat = {
  identity: string;
  name: string;
  frameWidth?: number;
  frameHeight?: number;
  framesPerSecond?: number;
  kbps: number;
  mimeType?: string;
  packetsLost?: number;
  framesDropped?: number;
};

type RemoteCameraEntry = {
  identity: string;
  name: string;
  publication: RemoteTrackPublication;
};

type Props = {
  visible: boolean;
  isInCall: boolean;
  getLocalCameraTrack: () => LocalVideoTrack | null;
  getRemoteCameraPublications: () => RemoteCameraEntry[];
};

export default function CameraStatsPanel({
  visible,
  isInCall,
  getLocalCameraTrack,
  getRemoteCameraPublications,
}: Props) {
  const [open, setOpen] = useState(false);
  const [senderStat, setSenderStat] = useState<SenderStat | null>(null);
  const [receiverStats, setReceiverStats] = useState<ReceiverStat[]>([]);

  const prevSenderRef = useRef<{ bytes: number; t: number } | null>(null);
  const prevReceiverRef = useRef<Map<string, { bytes: number; t: number }>>(
    new Map(),
  );

  useEffect(() => {
    if (!visible || !open) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;

      if (isInCall) {
        const track = getLocalCameraTrack();
        const sender = track?.sender;
        if (sender?.getStats) {
          try {
            const report = await sender.getStats();
            const codecMimeTypes = new Map<string, string>();
            report.forEach((v: any) => {
              if (v.type === "codec") codecMimeTypes.set(v.id, v.mimeType);
            });
            let stat: SenderStat | null = null;
            report.forEach((v: any) => {
              if (v.type !== "outbound-rtp" || v.kind !== "video") return;
              const bytesSent: number = v.bytesSent ?? 0;
              const prev = prevSenderRef.current;
              const kbps =
                prev && v.timestamp > prev.t
                  ? ((bytesSent - prev.bytes) * 8) / (v.timestamp - prev.t)
                  : 0;
              prevSenderRef.current = { bytes: bytesSent, t: v.timestamp };
              stat = {
                frameWidth: v.frameWidth,
                frameHeight: v.frameHeight,
                framesPerSecond: v.framesPerSecond,
                kbps: Math.max(0, Math.round(kbps)),
                qualityLimitationReason: v.qualityLimitationReason,
                mimeType: v.codecId ? codecMimeTypes.get(v.codecId) : undefined,
                encoderImplementation: v.encoderImplementation,
              };
            });
            if (!cancelled) setSenderStat(stat);
          } catch {
            // 統計取得に失敗した場合は前回の表示を維持する(無視してよい)
          }
        } else {
          setSenderStat(null);
          prevSenderRef.current = null;
        }
      } else {
        setSenderStat(null);
        prevSenderRef.current = null;
      }

      const entries = getRemoteCameraPublications();
      const nowIdentities = new Set(entries.map((e) => e.identity));
      for (const key of Array.from(prevReceiverRef.current.keys())) {
        if (!nowIdentities.has(key)) prevReceiverRef.current.delete(key);
      }

      const results: ReceiverStat[] = [];
      for (const entry of entries) {
        const track = entry.publication.track as RemoteVideoTrack | undefined;
        const receiver = track?.receiver;
        if (!receiver?.getStats) continue;
        try {
          const report = await receiver.getStats();
          const codecMimeTypes = new Map<string, string>();
          report.forEach((v: any) => {
            if (v.type === "codec") codecMimeTypes.set(v.id, v.mimeType);
          });
          report.forEach((v: any) => {
            if (v.type !== "inbound-rtp" || v.kind !== "video") return;
            const bytesReceived: number = v.bytesReceived ?? 0;
            const prev = prevReceiverRef.current.get(entry.identity);
            const kbps =
              prev && v.timestamp > prev.t
                ? ((bytesReceived - prev.bytes) * 8) / (v.timestamp - prev.t)
                : 0;
            prevReceiverRef.current.set(entry.identity, {
              bytes: bytesReceived,
              t: v.timestamp,
            });
            results.push({
              identity: entry.identity,
              name: entry.name,
              frameWidth: v.frameWidth,
              frameHeight: v.frameHeight,
              framesPerSecond: v.framesPerSecond,
              kbps: Math.max(0, Math.round(kbps)),
              mimeType: v.codecId ? codecMimeTypes.get(v.codecId) : undefined,
              packetsLost: v.packetsLost,
              framesDropped: v.framesDropped,
            });
          });
        } catch {
          // このpublicationの統計取得に失敗した場合はこの行をスキップする
        }
      }
      if (!cancelled) setReceiverStats(results);
    };

    tick();
    const timer = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [visible, open, isInCall, getLocalCameraTrack, getRemoteCameraPublications]);

  if (!visible) return null;

  const totalReceivedKbps = receiverStats.reduce((sum, r) => sum + r.kbps, 0);

  return (
    <div className="pointer-events-auto fixed bottom-2 left-2 z-50 w-56 rounded-md bg-black/85 text-[10px] leading-tight text-slate-100 shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2 py-1">
        <span className="font-semibold">カメラテスト計測</span>
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
          <div>
            <div className="mb-1 text-slate-300">送信(自分のカメラ)</div>
            {senderStat ? (
              <>
                <div>
                  {senderStat.frameWidth ?? "-"}x{senderStat.frameHeight ?? "-"} /{" "}
                  {senderStat.framesPerSecond ?? "-"}fps / {senderStat.kbps}kbps
                </div>
                <div>
                  制限理由: {senderStat.qualityLimitationReason ?? "-"} /{" "}
                  {senderStat.mimeType ?? "-"}
                </div>
                <div>encoder: {senderStat.encoderImplementation ?? "-"}</div>
              </>
            ) : (
              <div className="text-slate-400">カメラオフ</div>
            )}
          </div>
          <div className="border-t border-white/10 pt-1">
            <div className="mb-1 text-slate-300">受信(相手のカメラ)</div>
            {receiverStats.length === 0 ? (
              <div className="text-slate-400">受信なし</div>
            ) : (
              receiverStats.map((r) => (
                <div
                  key={r.identity}
                  className="mb-1 border-b border-white/10 pb-1 last:border-none"
                >
                  <div>{r.name}</div>
                  <div>
                    {r.frameWidth ?? "-"}x{r.frameHeight ?? "-"} / {r.framesPerSecond ?? "-"}
                    fps / {r.kbps}kbps / {r.mimeType ?? "-"}
                  </div>
                  <div>
                    lost: {r.packetsLost ?? "-"} / drop: {r.framesDropped ?? "-"}
                  </div>
                </div>
              ))
            )}
            {receiverStats.length > 0 && (
              <div className="border-t border-white/10 pt-1 text-slate-300">
                受信合計 {totalReceivedKbps}kbps
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
