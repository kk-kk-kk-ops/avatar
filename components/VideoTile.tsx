"use client";

import RemoteVideo from "./RemoteVideo";

type Props = {
  name: string;
  stream: MediaStream | null;
  widthPx: number;
  heightPx: number;
  isSelf?: boolean;
};

// ビデオ通話の映像枠(常時表示プレビュー行・会議画面モーダルの両方で
// 使い回す)。streamが無い(=カメラOFF)場合は黒背景+名前だけを表示する。
export default function VideoTile({
  name,
  stream,
  widthPx,
  heightPx,
  isSelf,
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
    </div>
  );
}
