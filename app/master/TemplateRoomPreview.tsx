"use client";

import MicButton from "@/components/MicButton";
import ScreenShareButton from "@/components/ScreenShareButton";
import VideoCallButton from "@/components/VideoCallButton";
import LeaveRoomButton from "@/components/LeaveRoomButton";

const PREVIEW_VIEWPORT_WIDTH = 900;
const PREVIEW_VIEWPORT_HEIGHT = 520;
const AVATAR_FRONT_IMAGE = "/avatar/goo/front.png";

// 実際に入室した際にどう見えるか(ヘッダー・サイドバー込み)を確認する
// ための静止画プレビュー。カメラはAvatarSpace.tsxと同じく「自分を中心に、
// マップ端では止める」ロジックで、マップ中央にスポーンした想定の見え方を
// 再現する(実際の入室位置は障害物を避けて多少ずれるが、静止画の目安表示
// としてはマップ中央で十分)。
export default function TemplateRoomPreview({
  mapWidth,
  mapHeight,
  backgroundImageUrl,
  avatarSizePx,
  onClose,
}: {
  mapWidth: number;
  mapHeight: number;
  backgroundImageUrl: string;
  avatarSizePx: number;
  onClose: () => void;
}) {
  const viewportWidth = Math.min(PREVIEW_VIEWPORT_WIDTH, mapWidth);
  const viewportHeight = Math.min(PREVIEW_VIEWPORT_HEIGHT, mapHeight);
  const spawnX = mapWidth / 2;
  const spawnY = mapHeight / 2;
  const maxCameraX = Math.max(mapWidth - viewportWidth, 0);
  const maxCameraY = Math.max(mapHeight - viewportHeight, 0);
  const cameraX = Math.min(
    Math.max(spawnX - viewportWidth / 2, 0),
    maxCameraX,
  );
  const cameraY = Math.min(
    Math.max(spawnY - viewportHeight / 2, 0),
    maxCameraY,
  );
  const avatarLeft = spawnX - cameraX - avatarSizePx / 2;
  const avatarTop = spawnY - cameraY - avatarSizePx;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-slate-900 shadow-2xl">
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
            <LeaveRoomButton onClick={onClose} />
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

          <div className="min-w-0 flex-1 overflow-auto bg-slate-950 p-4">
            <div
              className="relative mx-auto overflow-hidden rounded-lg border border-slate-700 bg-slate-700"
              style={{ width: viewportWidth, height: viewportHeight }}
            >
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
                  className="absolute"
                  style={{
                    left: avatarLeft,
                    top: avatarTop,
                    width: avatarSizePx,
                    height: avatarSizePx,
                  }}
                />
              </div>
            </div>
            <p className="mx-auto mt-3 max-w-2xl text-center text-xs text-slate-500">
              マップ中央にスポーンした場合の見え方のイメージです(実際の表示範囲はブラウザのウィンドウサイズにより変わります)。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
