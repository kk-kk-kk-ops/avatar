"use client";

import {
  AVATAR_IMAGES,
  PlayerState,
  AVATAR_RADIUS,
  AVATAR_HITBOX_HEIGHT,
  CHAT_BUBBLE_DURATION_MS,
} from "@/lib/types";

type Props = {
  player: PlayerState;
  isSelf: boolean;
};

const DISPLAY_SIZE = AVATAR_RADIUS * 2; // アバター画像の表示サイズ(正方形)

export default function Avatar({ player, isSelf }: Props) {
  const showBubble =
    player.message &&
    player.messageAt &&
    Date.now() - player.messageAt < CHAT_BUBBLE_DURATION_MS;
  const showMicBadge = player.micOn !== undefined;
  const avatarImage = player.avatarImage || AVATAR_IMAGES[0];

  return (
    <div
      className={`absolute will-change-transform ${
        isSelf ? "" : "transition-[left,top] duration-75 ease-linear"
      }`}
      style={{
        left: player.x - DISPLAY_SIZE / 2,
        // 画像の下端(足元)が当たり判定の下端とぴったり揃うようにする。
        // こうすることで、障害物に接触する瞬間と足元が重なる瞬間が一致し、
        // 「めり込んで見える」ことがなくなる。
        top: player.y + AVATAR_HITBOX_HEIGHT / 2 - DISPLAY_SIZE,
        width: DISPLAY_SIZE,
        height: DISPLAY_SIZE,
      }}
    >
      {showBubble && (
        <div className="absolute -top-14 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-3 py-1 text-xs shadow-md border border-gray-200">
          {player.message}
        </div>
      )}

      <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
        {player.name}
      </span>

      {/* アバター画像(背景・枠なしでそのまま表示) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={avatarImage}
        alt={player.name}
        className="h-full w-full object-contain drop-shadow-md"
      />

      {/* ミーティングエリア在室バッジ */}
      {player.meetingZoneId && (
        <span className="absolute right-0 top-0 z-20 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] shadow">
          💬
        </span>
      )}

      {/* マイクのON/OFF状態(相手にも見える) */}
      {showMicBadge && (
        <span
          className={`absolute left-0 top-0 z-20 flex h-4 w-4 items-center justify-center rounded-full text-[9px] shadow ${
            player.micOn ? "bg-emerald-500" : "bg-slate-500"
          }`}
        >
          {player.micOn ? "🎤" : "🔇"}
        </span>
      )}
    </div>
  );
}
