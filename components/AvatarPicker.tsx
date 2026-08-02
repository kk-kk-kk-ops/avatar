"use client";

import { AVATAR_IMAGES } from "@/lib/types";

type Props = {
  selected: string;
  onSelect: (image: string) => void;
};

export default function AvatarPicker({ selected, onSelect }: Props) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {AVATAR_IMAGES.map((image) => (
        <button
          key={image}
          type="button"
          onClick={() => onSelect(image)}
          className={`flex aspect-square items-center justify-center rounded-lg border-2 bg-slate-100 p-1 transition-colors ${
            selected === image
              ? "border-slate-900"
              : "border-transparent hover:border-slate-300"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt="アバター"
            className="h-full w-full object-contain"
          />
        </button>
      ))}
    </div>
  );
}
