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
  isAccountAdmin: boolean;
  isMaster: boolean;
  guestInviteToken?: string | null;
  avatarSizePx?: number;
};

export default function AvatarSpaceLoader({
  initialName,
  rooms,
  maxPeoplePerRoom,
  isAccountAdmin,
  isMaster,
  guestInviteToken,
  avatarSizePx,
}: Props) {
  return (
    // バーチャル空間は「画面ぴったりに固定し、スクロールで動かさない」
    // 表示にする(以前はhtml/body全体にこのスタイルを付けていたが、
    // 他のページ(管理画面など)までスクロールできなくなっていたため
    // ここに閉じ込めた)。
    <div
      className="w-full overflow-hidden"
      style={{ height: "100dvh", overscrollBehavior: "none", touchAction: "pan-x pan-y" }}
    >
      <AvatarSpace
        initialName={initialName}
        rooms={rooms}
        maxPeoplePerRoom={maxPeoplePerRoom}
        isAccountAdmin={isAccountAdmin}
        isMaster={isMaster}
        guestInviteToken={guestInviteToken}
        avatarSizePx={avatarSizePx}
      />
    </div>
  );
}
