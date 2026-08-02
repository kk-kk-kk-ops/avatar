"use client";

import { useEffect, useRef } from "react";

type Props = {
  stream: MediaStream;
};

// 画面には何も表示せず、受け取った音声ストリームを再生するだけの役割
export default function RemoteAudio({ stream }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
    }
  }, [stream]);

  return <audio ref={audioRef} autoPlay playsInline />;
}
