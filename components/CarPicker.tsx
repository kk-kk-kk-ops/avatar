"use client";

import { CAR_IMAGES, getCarThumbnail } from "@/lib/types";

type Props = {
  selected: string;
  onSelect: (image: string) => void;
};

// AvatarPickerと同じグリッドレイアウト(現状は車種が1つのみのため
// 折り返しは起きないが、今後増えても同じ挙動になるよう揃えておく)。
const USE_SCROLL_LAYOUT = CAR_IMAGES.length > 8;

export default function CarPicker({ selected, onSelect }: Props) {
  return (
    <div
      className={
        USE_SCROLL_LAYOUT
          ? "grid grid-flow-col grid-rows-2 gap-1.5 overflow-x-auto pb-1"
          : "grid grid-cols-4 gap-1.5"
      }
      style={USE_SCROLL_LAYOUT ? { gridAutoColumns: "3.75rem" } : undefined}
    >
      {CAR_IMAGES.map((image) => (
        <button
          key={image}
          type="button"
          onClick={() => onSelect(image)}
          className={`flex aspect-square items-center justify-center rounded-lg bg-slate-100 p-1 transition-colors ${
            USE_SCROLL_LAYOUT ? "w-full shrink-0" : ""
          } ${
            selected === image
              ? "border-[3px] border-emerald-500"
              : "border-2 border-transparent hover:border-slate-300"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getCarThumbnail(image)}
            alt="車"
            className="h-full w-full object-contain"
          />
        </button>
      ))}
    </div>
  );
}
