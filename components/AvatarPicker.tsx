"use client";

import { AVATAR_IMAGES, getAvatarThumbnail } from "@/lib/types";

type Props = {
  selected: string;
  onSelect: (image: string) => void;
};

// 1画面に収まる4列×2段(=8個)まではこれまで通りの行優先グリッド
// (左から右→次の段)。9個目以降は3段目を作らず、常に2段を維持したまま
// 列優先(grid-flow-col)で横に伸ばし、横スクロールで選べるようにする
// (9個目→5列目1段目、10個目→5列目2段目、11個目→6列目1段目…の順に
// なるのは、2段固定+列優先のグリッド配置そのものの挙動による)。
const USE_SCROLL_LAYOUT = AVATAR_IMAGES.length > 8;

export default function AvatarPicker({ selected, onSelect }: Props) {
  return (
    <div
      className={
        USE_SCROLL_LAYOUT
          ? "grid grid-flow-col grid-rows-2 gap-1.5 overflow-x-auto pb-1"
          : "grid grid-cols-4 gap-1.5"
      }
      style={USE_SCROLL_LAYOUT ? { gridAutoColumns: "3.75rem" } : undefined}
    >
      {AVATAR_IMAGES.map((image) => (
        <button
          key={image}
          type="button"
          onClick={() => onSelect(image)}
          className={`flex aspect-square items-center justify-center rounded-lg border-2 bg-slate-100 p-1 transition-colors ${
            USE_SCROLL_LAYOUT ? "w-full shrink-0" : ""
          } ${
            selected === image
              ? "border-slate-900"
              : "border-transparent hover:border-slate-300"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getAvatarThumbnail(image)}
            alt="アバター"
            className="h-full w-full object-contain"
          />
        </button>
      ))}
    </div>
  );
}
