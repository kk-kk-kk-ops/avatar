"use client";

import {
  AVATAR_IMAGES,
  PlayerState,
  AVATAR_RADIUS,
  CHAT_BUBBLE_DURATION_MS,
} from "@/lib/types";

type Props = {
  player: PlayerState;
  isSelf: boolean;
};

const DISPLAY_SIZE = AVATAR_RADIUS * 5.0; // 見た目上のサイズ(当たり判定はAVATAR_RADIUSのまま)

export default function Avatar({ player, isSelf }: Props) {
  const showBubble =
    player.message &&
    player.messageAt &&
    Date.now() - player.messageAt < CHAT_BUBBLE_DURATION_MS;
  const showMicBadge = player.micOn !== undefined;
  const avatarImage = player.avatarImage || AVATAR_IMAGES[0];

  return (
    <div
      className={`absolute flex flex-col items-center will-change-transform ${
        isSelf ? "" : "transition-[left,top] duration-75 ease-linear"
      }`}
      style={{
        left: player.x - DISPLAY_SIZE / 2,
        top: player.y - DISPLAY_SIZE / 2 - 10,
        width: DISPLAY_SIZE,
      }}
    >
      {showBubble && (
        <div className="absolute -top-9 whitespace-nowrap rounded-full bg-white px-3 py-1 text-xs shadow-md border border-gray-200">
          {player.message}
        </div>
      )}

      <div className="relative flex items-center justify-center">
        {/* アバター画像(背景・枠なしでそのまま表示) */}
        <div style={{ width: DISPLAY_SIZE, height: DISPLAY_SIZE }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarImage}
            alt={player.name}
            className="h-full w-full object-contain drop-shadow-md"
          />
        </div>

        {/* ミーティングエリア在室バッジ */}
        {player.meetingZoneId && (
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
