"use client";

import { AVATAR_IMAGES, getAvatarThumbnail } from "@/lib/types";
import { useLocale } from "@/lib/i18n/LocaleContext";

type Props = {
  selected: string;
  onSelect: (image: string) => void;
  // 連打対策(2026-10追加)。trueの間は選択を一時的に受け付けない。
  disabled?: boolean;
};

// 1画面に収まる4列×2段(=8個)まではこれまで通りの行優先グリッド
// (左から右→次の段)。9個目以降は3段目を作らず、常に2段を維持したまま
// 列優先(grid-flow-col)で横に伸ばし、横スクロールで選べるようにする
// (9個目→5列目1段目、10個目→5列目2段目、11個目→6列目1段目…の順に
// なるのは、2段固定+列優先のグリッド配置そのものの挙動による)。
const USE_SCROLL_LAYOUT = AVATAR_IMAGES.length > 8;

export default function AvatarPicker({ selected, onSelect, disabled }: Props) {
  const { t } = useLocale();
  return (
    <div
      className={
        USE_SCROLL_LAYOUT
          // 段階E-5-1b見直し(2026-11-25)。overflow-x-autoのブラウザ標準の
          // 横スクロールバーが、暗い背景(左のサイドバー・設定パネル)の上で
          // 白く浮いて見える指摘への対応。app/globals.cssに既存の
          // no-scrollbarユーティリティ(横スクロール行でスクロールバーを
          // 隠す用、これまで未使用)を適用する。マウス操作でのドラッグ・
          // トラックパッド・スマホのスワイプでの横スクロール自体は変わらず
          // 使える。
          ? "no-scrollbar grid grid-flow-col grid-rows-2 gap-1.5 overflow-x-auto pb-1"
          : "grid grid-cols-4 gap-1.5"
      }
      style={USE_SCROLL_LAYOUT ? { gridAutoColumns: "3.75rem" } : undefined}
    >
      {AVATAR_IMAGES.map((image) => (
        <button
          key={image}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(image)}
          className={`flex aspect-square items-center justify-center rounded-lg bg-slate-100 p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            USE_SCROLL_LAYOUT ? "w-full shrink-0" : ""
          } ${
            selected === image
              ? "border-[3px] border-emerald-500"
              : "border-2 border-transparent hover:border-slate-300"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getAvatarThumbnail(image)}
            alt={t("room.avatarAlt")}
            className="h-full w-full object-contain"
          />
        </button>
      ))}
    </div>
  );
}
