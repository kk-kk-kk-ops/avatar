"use client";

import dynamic from "next/dynamic";
import type { Room } from "@/lib/types";

// canvasやwindow/keyboardイベントを使うためSSRを無効化
const AvatarSpace = dynamic(() => import("@/components/AvatarSpace"), {
  ssr: false,
});

type Props = {
  initialName?: string;
  rooms: Room[];
  maxPeoplePerRoom: number;
};

export default function AvatarSpaceLoader({
  initialName,
  rooms,
  maxPeoplePerRoom,
}: Props) {
  return (
    <AvatarSpace
      initialName={initialName}
      rooms={rooms}
      maxPeoplePerRoom={maxPeoplePerRoom}
    />
  );
}
