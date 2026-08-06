"use client";

import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  AVATAR_IMAGES,
  PlayerState,
  AVATAR_RADIUS,
  AVATAR_HITBOX_HEIGHT,
  PRESENCE_STATUS_COLORS,
  getAvatarSpritePath,
  getAvatarThumbnail,
} from "@/lib/types";

type Props = {
  player: PlayerState;
  isSelf: boolean;
  sizePx?: number; // アバター画像の表示サイズ(正方形、px)。マスター画面で設定可能。
};

export type AvatarHandle = {
  // 位置を直接DOM操作で更新する。Reactのstateを経由しないため、
  // 毎フレーム呼んでも画面全体の再描画は発生しない。
  updatePosition: (x: number, y: number) => void;
};

const DEFAULT_DISPLAY_SIZE = AVATAR_RADIUS * 2; // sizePx未指定時のフォールバック

const Avatar = forwardRef<AvatarHandle, Props>(function Avatar(
  { player, isSelf, sizePx },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const displaySize = sizePx ?? DEFAULT_DISPLAY_SIZE;
  // 画像自体の上下に含まれる透明な余白を補正する値。
  // 数値を大きくするほど、見た目の足元が当たり判定ラインに近づく(=障害物との隙間が減る)。
  // 画像内の透明な余白の割合は表示サイズが変わっても一定なので、
  // 元のサイズ(90px)で調整した比率(20/90)を維持して表示サイズに応じて算出する。
  const footOffset = displaySize * (20 / 90);

  useImperativeHandle(
    ref,
    () => ({
      updatePosition: (x: number, y: number) => {
        const el = rootRef.current;
        if (!el) return;
        const left = x - displaySize / 2;
        const top = y + AVATAR_HITBOX_HEIGHT / 2 - displaySize + footOffset;
        el.style.transform = `translate(${left}px, ${top}px)`;
      },
    }),
    [displaySize, footOffset],
  );

  // 吹き出しは設定画面のチェックボックスで表示/非表示が切り替わる常時
  // 表示方式(自動で消えるタイマーは持たない)。
  const showBubble = !!player.showMessage && !!player.message;
  const showMicBadge = player.micOn !== undefined;
  const avatarImage = player.avatarImage || AVATAR_IMAGES[0];
  const spriteSrc = getAvatarSpritePath(avatarImage, player.dir);

  // 向きごとの画像(back/front/left/right.png)が用意されていないアバターも
  // あるため、読み込みに失敗した場合はfront.png(1枚絵のアバターはそのまま
  // 同じ画像)にフォールバックする。向きが変わった際は改めて読み込みを
  // 試したいので、spriteSrcが変わるたびにエラー状態をリセットする。
  const [spriteLoadFailed, setSpriteLoadFailed] = useState(false);
  useEffect(() => {
    setSpriteLoadFailed(false);
  }, [spriteSrc]);
  const displaySrc = spriteLoadFailed
    ? getAvatarThumbnail(avatarImage)
    : spriteSrc;

  return (
    <div
      ref={rootRef}
      className="absolute left-0 top-0 will-change-transform"
      style={{ width: displaySize, height: displaySize }}
    >
      {/* 名前タグと吹き出しをまとめて1つの基準位置に固定し、吹き出しは
          常にその真上(bottom-full)に積み上げる。吹き出しは改行して
          高さが伸び縮みするため、名前タグ側の位置に影響しないよう
          このように親子関係にしている。 */}
      <div className="absolute -top-6 left-1/2 -translate-x-1/2">
        {showBubble && (
          <div className="absolute bottom-full left-1/2 mb-1 w-[150px] -translate-x-1/2 whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-white px-1.5 py-1 text-center text-[10px] leading-tight shadow-md">
            {player.message}
          </div>
        )}
        <span className="flex items-center gap-1 whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{
              backgroundColor: PRESENCE_STATUS_COLORS[player.status ?? "available"],
            }}
          />
          {player.name}
        </span>
      </div>

      {/* アバター画像(背景・枠なしでそのまま表示) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={displaySrc}
        alt={player.name}
        onError={() => setSpriteLoadFailed(true)}
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
