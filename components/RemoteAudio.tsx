"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  stream: MediaStream;
};

type DebugState = {
  playState: "確認中" | "playing" | "blocked";
  trackMuted: boolean;
  trackReadyState: MediaStreamTrackState;
};

// 画面には何も表示せず、受け取った音声ストリームを再生するだけの役割。
// モバイルブラウザ(特にiOS Safari)は、ユーザー操作に紐づかない
// <audio>の自動再生をブロックすることがあり、その場合autoPlay属性
// だけではエラーも出ないまま無音で止まったままになる。そのため明示的に
// play()を呼び、失敗した場合は次のユーザー操作(タップ/クリック)を
// きっかけに再生を再試行する。
//
// 調査用(一時): PC→スマホ方向の音声が届かない不具合の切り分けのため、
// 「再生自体がブロックされているのか」「トラック自体に音声データが
// 来ていないのか(track.muted)」を画面下部に小さく表示する。
// 原因特定後、この診断表示は削除する(investigate/pc-to-mobile-mic-audio限定)。
export default function RemoteAudio({ stream }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [debug, setDebug] = useState<DebugState>({
    playState: "確認中",
    trackMuted: false,
    trackReadyState: "live",
  });

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.srcObject = stream;

    const track = stream.getAudioTracks()[0] as MediaStreamTrack | undefined;
    const updateTrackDebug = () => {
      if (!track) return;
      setDebug((prev) => ({
        ...prev,
        trackMuted: track.muted,
        trackReadyState: track.readyState,
      }));
    };
    updateTrackDebug();
    track?.addEventListener("mute", updateTrackDebug);
    track?.addEventListener("unmute", updateTrackDebug);

    const retryOnNextInteraction = () => {
      audio
        .play()
        .then(() => setDebug((prev) => ({ ...prev, playState: "playing" })))
        .catch(() => {
          // それでも失敗する場合は静かに諦める(次の操作でまた試行される)
        });
    };

    audio
      .play()
      .then(() => setDebug((prev) => ({ ...prev, playState: "playing" })))
      .catch(() => {
        setDebug((prev) => ({ ...prev, playState: "blocked" }));
        document.addEventListener("pointerdown", retryOnNextInteraction, {
          once: true,
        });
      });

    return () => {
      document.removeEventListener("pointerdown", retryOnNextInteraction);
      track?.removeEventListener("mute", updateTrackDebug);
      track?.removeEventListener("unmute", updateTrackDebug);
    };
  }, [stream]);

  return (
    <>
      <audio ref={audioRef} autoPlay playsInline />
      <div className="fixed bottom-2 left-2 z-[9999] rounded bg-black/70 px-2 py-1 text-[10px] text-white">
        音声デバッグ: 再生={debug.playState} / track.muted=
        {String(debug.trackMuted)} / {debug.trackReadyState}
      </div>
    </>
  );
}
