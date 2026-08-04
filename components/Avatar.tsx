"use client";

import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from "react";
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

export type AvatarHandle = {
  // 位置を直接DOM操作で更新する。Reactのstateを経由しないため、
  // 毎フレーム呼んでも画面全体の再描画は発生しない。
  updatePosition: (x: number, y: number) => void;
};

const DISPLAY_SIZE = AVATAR_RADIUS * 2; // アバター画像の表示サイズ(正方形)
// 画像自体の上下に含まれる透明な余白を補正する値。
// 数値を大きくするほど、見た目の足元が当たり判定ラインに近づく(=障害物との隙間が減る)。
const FOOT_OFFSET = 20;

const Avatar = forwardRef<AvatarHandle, Props>(function Avatar(
  { player, isSelf },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      updatePosition: (x: number, y: number) => {
        const el = rootRef.current;
        if (!el) return;
        const left = x - DISPLAY_SIZE / 2;
        const top = y + AVATAR_HITBOX_HEIGHT / 2 - DISPLAY_SIZE + FOOT_OFFSET;
        el.style.transform = `translate(${left}px, ${top}px)`;
      },
    }),
    [],
  );

  // 吹き出しは「表示中に他の理由で再描画が起きない限りDate.now()が
  // 再評価されず消えない」問題があったため、タイマーで明示的に非表示へ
  // 切り替える(位置更新はDOM操作のみでReactの再描画を経由しないため、
  // 他のstate変化が起きないと自然には再描画されない)。
  const [bubbleExpired, setBubbleExpired] = useState(false);
  useEffect(() => {
    if (!player.message || !player.messageAt) return;
    setBubbleExpired(false);
    const remaining = CHAT_BUBBLE_DURATION_MS - (Date.now() - player.messageAt);
    if (remaining <= 0) {
      setBubbleExpired(true);
      return;
    }
    const timer = setTimeout(() => setBubbleExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [player.message, player.messageAt]);

  const showBubble =
    !!player.message && !!player.messageAt && !bubbleExpired;
  const showMicBadge = player.micOn !== undefined;
  const avatarImage = player.avatarImage || AVATAR_IMAGES[0];

  return (
    <div
      ref={rootRef}
      className="absolute left-0 top-0 will-change-transform"
      style={{ width: DISPLAY_SIZE, height: DISPLAY_SIZE }}
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
});

// playersステートは誰か一人が変化するたびに新しいオブジェクト参照になり、
// 親(AvatarSpace)は必ず再描画される。memo化しないと、変化していない
// プレイヤーのAvatarまで毎回再描画されてしまうため、propsが変わって
// いない場合はスキップされるようにする。
export default memo(Avatar);
