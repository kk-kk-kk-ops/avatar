"use client";

import { useEffect, useRef, useState } from "react";
import type { PlacedObject } from "@/lib/types";
import MicButton from "@/components/MicButton";
import ScreenShareButton from "@/components/ScreenShareButton";
import VideoCallButton from "@/components/VideoCallButton";
import LeaveRoomButton from "@/components/LeaveRoomButton";

const AVATAR_FRONT_IMAGE = "/avatar/goo/front.webp";

// 実際に入室した際にどう見えるか(ヘッダー・サイドバー込み)を確認する
// ための静止画プレビュー。実際のAvatarSpace.tsxと同じく、マップは画面上
// 等倍(mapScale=1)で表示され、カメラは自分を中心にマップ端で止まる
// ため、地図の見切れ方を正しく再現するには「マップを映す領域の実際の
// 画面幅・高さ」が必要になる。固定値だと実ブラウザとの比率がずれて
// 過剰にズームして見えてしまうため、この領域を実測して使う。
export default function TemplateRoomPreview({
  mapWidth,
  mapHeight,
  backgroundImageUrl,
  avatarSizePx,
  spawnPoint,
  placedObjects,
  onClose,
}: {
  mapWidth: number;
  mapHeight: number;
  backgroundImageUrl: string;
  avatarSizePx: number;
  spawnPoint: { x: number; y: number } | null;
  placedObjects: PlacedObject[];
  onClose: () => void;
}) {
  const mapAreaRef = useRef<HTMLDivElement>(null);
  const [areaSize, setAreaSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = mapAreaRef.current;
    if (!el) return;
    const recompute = () =>
      setAreaSize({ width: el.clientWidth, height: el.clientHeight });
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ここは実際の画面の描画領域そのものの幅・高さを使う(mapWidth/Height側に
  // クランプしてはいけない)。クランプしてしまうと、マップが画面より小さい
  // 場合にmaxCameraが常に0に潰れ、マップ(と中心にいるアバター)が画面左上に
  // 張り付いて見えてしまう(=アバターが画面中央より上に見えるバグの原因)。
  const viewportWidth = areaSize.width;
  const viewportHeight = areaSize.height;
  const spawnX = spawnPoint?.x ?? mapWidth / 2;
  const spawnY = spawnPoint?.y ?? mapHeight / 2;
  // マップが画面より小さい場合はcameraを負の値にしてマップ自体を画面中央へ
  // 寄せ、大きい場合は従来通り画面端で止める。どちらの場合も
  // 「アバターは常に画面の中央」になる。
  const cameraX = Math.min(
    Math.max(spawnX - viewportWidth / 2, Math.min(0, mapWidth - viewportWidth)),
    Math.max(0, mapWidth - viewportWidth),
  );
  const cameraY = Math.min(
    Math.max(spawnY - viewportHeight / 2, Math.min(0, mapHeight - viewportHeight)),
    Math.max(0, mapHeight - viewportHeight),
  );
  const avatarLeft = spawnX - cameraX - avatarSizePx / 2;
  const avatarTop = spawnY - cameraY - avatarSizePx;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900">
      {/* ここから下はAvatarSpace.tsxの実際の画面構成(ヘッダー・サイドバー・
          マップ)を模した静止画。ヘッダー内のアイコン類は見た目確認用の
          飾りで、押しても何も起きない(実際に閉じるのは右端の
          「プレビューを閉じる」ボタンのみ)。 */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-950 px-3 py-2 text-white">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Globy" className="h-4 w-4 object-contain" />
          </div>
          <span className="text-sm font-semibold">Globy</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-xs text-slate-300 sm:inline">
            オンライン: 1人
          </span>
          <MicButton enabled={false} onClick={() => {}} />
          <ScreenShareButton enabled={false} onClick={() => {}} />
          <VideoCallButton enabled={false} onClick={() => {}} />
          <LeaveRoomButton onClick={() => {}} />
          <button
            onClick={onClose}
            className="ml-2 shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100"
          >
            ✕ プレビューを閉じる
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="hidden w-56 shrink-0 flex-col gap-4 border-r border-slate-800 bg-slate-900 p-3 text-white sm:flex">
          <div>
            <h2 className="mb-2 text-xs font-semibold text-slate-400">自分</h2>
            <div className="flex items-center gap-1.5 rounded px-1 py-1.5 text-sm">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
              <span className="min-w-0 flex-1 truncate">あなた</span>
            </div>
          </div>
          <div>
            <h2 className="mb-2 text-xs font-semibold text-slate-400">参加者</h2>
            <p className="text-xs text-slate-500">参加者はいません</p>
          </div>
        </div>

        <div ref={mapAreaRef} className="relative min-w-0 flex-1 overflow-hidden bg-slate-700">
          {areaSize.width > 0 && (
            <div
              className="absolute left-0 top-0"
              style={{
                width: mapWidth,
                height: mapHeight,
                transform: `translate(${-cameraX}px, ${-cameraY}px)`,
                backgroundImage: `url('${backgroundImageUrl}')`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={AVATAR_FRONT_IMAGE}
                alt="アバターのプレビュー"
                className="absolute z-10 object-contain"
                style={{
                  left: avatarLeft,
                  top: avatarTop,
                  width: avatarSizePx,
                  height: avatarSizePx,
                }}
              />
              {/* 装飾オブジェクト(2026-09追加)。実際の空間(AvatarSpace.tsx)と
                  同じく、背景 < アバター(z-10) < オブジェクト(z-20)の
                  重なり順を明示的なz-indexで固定する。 */}
              {placedObjects.map((o) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={o.id}
                  src={o.imageUrl}
                  alt="配置したオブジェクトのプレビュー"
                  draggable={false}
                  className="pointer-events-none absolute z-20 select-none object-contain"
                  style={{
                    left: o.x,
                    top: o.y,
                    width: o.width,
                    height: o.height,
                    transform: `rotate(${o.rotation ?? 0}deg)`,
                    transformOrigin: "50% 50%",
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
