"use client";

import dynamic from "next/dynamic";

// canvasやwindow/keyboardイベントを使うためSSRを無効化
const AvatarSpace = dynamic(() => import("@/components/AvatarSpace"), {
  ssr: false,
});

type Props = {
  initialName?: string;
};

export default function AvatarSpaceLoader({ initialName }: Props) {
  return <AvatarSpace initialName={initialName} />;
}
