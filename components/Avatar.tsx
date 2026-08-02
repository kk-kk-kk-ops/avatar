"use client";

import { PlayerState, AVATAR_RADIUS, CHAT_BUBBLE_DURATION_MS } from "@/lib/types";

type Props = {
  player: PlayerState;
  isSelf: boolean;
};

export default function Avatar({ player, isSelf }: Props) {
  const showBubble =
    player.message && player.messageAt && Date.now() - player.messageAt < CHAT_BUBBLE_DURATION_MS;

  return (
    <div
      className="absolute flex flex-col items-center transition-[left,top] duration-75 ease-linear will-change-transform"
      style={{
        left: player.x - AVATAR_RADIUS,
        top: player.y - AVATAR_RADIUS,
        width: AVATAR_RADIUS * 2,
      }}
    >
      {showBubble && (
        <div className="absolute -top-9 whitespace-nowrap rounded-full bg-white px-3 py-1 text-xs shadow-md border border-gray-200">
          {player.message}
        </div>
      )}

      <div
        className={`flex items-center justify-center rounded-full text-white text-xs font-bold shadow-md ${
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

      <span className="mt-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white whitespace-nowrap">
        {player.name}
      </span>
    </div>
  );
}
