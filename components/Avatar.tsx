"use client";

import {
  PlayerState,
  AVATAR_RADIUS,
  CHAT_BUBBLE_DURATION_MS,
} from "@/lib/types";

type Props = {
  player: PlayerState;
  isSelf: boolean;
};

export default function Avatar({ player, isSelf }: Props) {
  const showBubble =
    player.message &&
    player.messageAt &&
    Date.now() - player.messageAt < CHAT_BUBBLE_DURATION_MS;
  const showMicBadge = player.micOn !== undefined;

  return (
    <div
      className={`absolute flex flex-col items-center will-change-transform ${
        isSelf ? "" : "transition-[left,top] duration-75 ease-linear"
      }`}
      style={{
        left: player.x - AVATAR_RADIUS,
        top: player.y - AVATAR_RADIUS - 10,
        width: AVATAR_RADIUS * 2,
      }}
    >
      {showBubble && (
        <div className="absolute -top-9 whitespace-nowrap rounded-full bg-white px-3 py-1 text-xs shadow-md border border-gray-200">
          {player.message}
        </div>
      )}

      <div className="relative flex flex-col items-center">
        {/* 頭 */}
        <div
          className={`z-10 flex items-center justify-center rounded-full text-white text-xs font-bold shadow-md ${
            isSelf ? "ring-2 ring-offset-2 ring-black" : ""
          }`}
          style={{
            width: AVATAR_RADIUS * 2,
            height: AVATAR_RADIUS * 2,
            backgroundColor: player.color,
          }}
        >
          {player.name.slice(0, 1).toUpperCase()}
        </div>
        {/* 体(頭の少し後ろに重ねて簡易キャラクター風に) */}
        <div
          className="-mt-1 rounded-t-full opacity-90"
          style={{
            width: AVATAR_RADIUS * 1.6,
            height: AVATAR_RADIUS * 0.9,
            backgroundColor: player.color,
          }}
        />

        {/* ミーティングエリア在室バッジ */}
        {player.inMeetingArea && (
          <span className="absolute -right-1 -top-1 z-20 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] shadow">
            💬
          </span>
        )}

        {/* マイクのON/OFF状態(相手にも見える) */}
        {showMicBadge && (
          <span
            className={`absolute -left-1 -top-1 z-20 flex h-4 w-4 items-center justify-center rounded-full text-[9px] shadow ${
              player.micOn ? "bg-emerald-500" : "bg-slate-500"
            }`}
          >
            {player.micOn ? "🎤" : "🔇"}
          </span>
        )}
      </div>

      <span className="mt-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white whitespace-nowrap">
        {player.name}
      </span>
    </div>
  );
}
