"use client";

import dynamic from "next/dynamic";

// canvasやwindow/keyboardイベントを使うためSSRを無効化
const AvatarSpace = dynamic(() => import("@/components/AvatarSpace"), {
  ssr: false,
});

export default function Home() {
  return <AvatarSpace />;
}
