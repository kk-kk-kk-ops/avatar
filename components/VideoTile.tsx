"use client";

import RemoteVideo from "./RemoteVideo";
import { MicIcon } from "./MicButton";

type Props = {
  name: string;
  stream: MediaStream | null;
  widthPx: number;
  heightPx: number;
  isSelf?: boolean;
  // マイクON中かどうか(相手にも見える)。会議中は誰がマイクONか映像
  // だけでは分からないため、枠の右下にアイコンで示す。
  micOn?: boolean;
  // 文字起こしモデル(sherpa-onnx)のローカルでの準備状況(2026-10追加、
  // 相手にも見える)。マイクアイコンと場所が被らないよう枠の左下に表示
  // する。undefined/"idle"/"error"の場合は何も表示しない。
  transcriptionStatus?: "downloading" | "initializing" | "ready";
  // 準備中の進捗(%)。自分自身の時だけ分かる値のため、相手のタイルには
  // 渡さない(その場合はバッジのみ表示し、数字は出さない)。
  transcriptionPercent?: number;
};

// ビデオ通話の映像枠(常時表示プレビュー行・会議画面モーダルの両方で
// 使い回す)。streamが無い(=カメラOFF)場合は黒背景+名前だけを表示する。
export default function VideoTile({
  name,
  stream,
  widthPx,
  heightPx,
  isSelf,
  micOn,
  transcriptionStatus,
  transcriptionPercent,
}: Props) {
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-md border border-slate-500 bg-black"
      style={{ width: widthPx, height: heightPx }}
    >
      {stream ? (
        <>
          <RemoteVideo stream={stream} className="h-full w-full object-cover" />
          <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
            {isSelf ? "あなた" : name}
          </span>
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] text-slate-300">
          {name}
        </div>
      )}
      {micOn && (
        <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
          <MicIcon enabled size={10} />
        </span>
      )}
      {(transcriptionStatus === "downloading" ||
        transcriptionStatus === "initializing") && (
        <span className="absolute bottom-1 left-1 flex items-center gap-1">
          <span
            className="flex h-4 w-4 shrink-0 animate-pulse items-center justify-center rounded-full bg-amber-500 text-[9px] text-white shadow"
            title="文字起こしを準備中です"
          >
            ⋯
          </span>
          {typeof transcriptionPercent === "number" && (
            <span className="rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white shadow">
              文字起こし準備中:{transcriptionPercent}%
            </span>
          )}
        </span>
      )}
      {transcriptionStatus === "ready" && (
        <span
          className="absolute bottom-1 left-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-[9px] text-white shadow"
          title="文字起こし準備完了"
        >
          ✓
        </span>
      )}
    </div>
  );
}
