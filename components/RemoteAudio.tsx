"use client";

import { useEffect, useRef } from "react";

type Props = {
  stream: MediaStream;
};

// 画面には何も表示せず、受け取った音声ストリームを再生するだけの役割。
// モバイルブラウザ(特にiOS Safari)は、ユーザー操作に紐づかない
// <audio>の自動再生をブロックすることがあり、その場合autoPlay属性
// だけではエラーも出ないまま無音で止まったままになる。そのため明示的に
// play()を呼び、失敗した場合は次のユーザー操作(タップ/クリック/
// キー操作)をきっかけに再生を再試行する。
//
// 2026-09報告: 「相手が先にマイクをONにしても聞こえないが、自分も
// マイクをONにした瞬間に聞こえるようになる」不具合の原因はこれだった。
// 以前はpointerdown(タップ/クリック)しか再試行のきっかけにしておらず、
// 矢印キー等キーボードだけで移動して一度もクリックしていないユーザーは、
// マイクボタンを押す等の何らかのクリック操作をするまで再生がブロック
// されたままになっていた。keydownも再試行のきっかけに加えることで、
// 通常の移動操作だけでも早期に回復するようにする。再接続・再購読の
// たびに新しいMediaStreamとしてstreamが渡され直すため、この再生ブロック
// は入室中いつでも再発しうる(①-2「1分後に音声が届かなくなる」も
// 同じ原因の可能性がある)。
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

    const registerRetry = () => {
      document.addEventListener("pointerdown", retryOnNextInteraction, {
        once: true,
      });
      document.addEventListener("keydown", retryOnNextInteraction, {
        once: true,
      });
    };
    const unregisterRetry = () => {
      document.removeEventListener("pointerdown", retryOnNextInteraction);
      document.removeEventListener("keydown", retryOnNextInteraction);
    };

    audio.play().catch(() => {
      registerRetry();
    });

    return () => {
      unregisterRetry();
    };
  }, [stream]);

  return <audio ref={audioRef} autoPlay playsInline />;
}
