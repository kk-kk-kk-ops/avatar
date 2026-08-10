"use client";

import { useEffect, useRef } from "react";

type Props = {
  stream: MediaStream;
};

// 画面には何も表示せず、受け取った音声ストリームを再生するだけの役割。
// モバイルブラウザ(特にiOS Safari)は、ユーザー操作に紐づかない
// <audio>の自動再生をブロックすることがあり、その場合autoPlay属性
// だけではエラーも出ないまま無音で止まったままになる。そのため明示的に
// play()を呼び、失敗した場合は次のユーザー操作(タップ/クリック)を
// きっかけに再生を再試行する。
export default function RemoteAudio({ stream }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.srcObject = stream;

    const retryOnNextInteraction = () => {
      audio.play().catch(() => {
        // それでも失敗する場合は静かに諦める(次の操作でまた試行される)
      });
    };

    audio.play().catch(() => {
      document.addEventListener("pointerdown", retryOnNextInteraction, {
        once: true,
      });
    });

    return () => {
      document.removeEventListener("pointerdown", retryOnNextInteraction);
    };
  }, [stream]);

  return <audio ref={audioRef} autoPlay playsInline />;
}
