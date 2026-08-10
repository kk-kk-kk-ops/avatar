"use client";

import { useEffect, useRef, useState } from "react";
import { getSharedAudioContext } from "@/lib/sharedAudioContext";

type Props = {
  stream: MediaStream;
};

type DebugState = {
  audioContextState: AudioContextState;
  trackMuted: boolean;
  trackReadyState: MediaStreamTrackState;
};

// 画面には何も表示せず、受け取った音声ストリームを再生するだけの役割。
//
// <audio>要素にsrcObjectを直接設定して再生する方式だと、モバイル
// (特にiOS Safari)ではマイクを同時に使っている間、出力先が受話口
// (耳に当てる小さいスピーカー)に自動で切り替わってしまい、本体
// スピーカーからは聞こえなくなる(PC→スマホ方向の音声が届かない
// 不具合の原因だった。<audio>要素は無音のままMediaStreamを流し続ける
// ためだけに残し(iOS Safariがトラックを止めてしまうのを防ぐ)、
// 実際に耳に聞こえる音はWeb Audio API(AudioContext.destination)
// 経由で再生する。この経路は受話口への切り替え対象にならない。
//
// AudioContextはページ内で1つを使い回す(getSharedAudioContext)。
// ブラウザの自動再生ポリシーによりAudioContextは初期状態が
// "suspended"のことがあるため、ユーザーの次の操作(タップ/クリック)で
// resume()を試みる。
export default function RemoteAudio({ stream }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [debug, setDebug] = useState<DebugState>({
    audioContextState: "suspended",
    trackMuted: false,
    trackReadyState: "live",
  });

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // iOS SafariがMediaStreamのトラックを止めてしまわないよう、
    // 音は鳴らさない(muted)状態でHTMLMediaElementに紐づけておく。
    audio.srcObject = stream;
    audio.muted = true;
    audio.play().catch(() => {
      // mutedなので自動再生ブロックの影響は受けにくいが、念のため無視する
    });

    const ctx = getSharedAudioContext();
    const source = ctx.createMediaStreamSource(stream);
    source.connect(ctx.destination);

    const track = stream.getAudioTracks()[0] as MediaStreamTrack | undefined;
    const updateDebug = () => {
      setDebug({
        audioContextState: ctx.state,
        trackMuted: track?.muted ?? false,
        trackReadyState: track?.readyState ?? "ended",
      });
    };
    updateDebug();
    track?.addEventListener("mute", updateDebug);
    track?.addEventListener("unmute", updateDebug);

    const resumeIfNeeded = () => {
      if (ctx.state === "suspended") {
        ctx.resume().then(updateDebug).catch(() => {});
      }
    };
    resumeIfNeeded();
    document.addEventListener("pointerdown", resumeIfNeeded);

    return () => {
      source.disconnect();
      document.removeEventListener("pointerdown", resumeIfNeeded);
      track?.removeEventListener("mute", updateDebug);
      track?.removeEventListener("unmute", updateDebug);
    };
  }, [stream]);

  return (
    <>
      <audio ref={audioRef} playsInline />
      {/* 調査用の一時表示。原因特定後に削除する */}
      <div className="fixed bottom-2 left-2 z-[9999] rounded bg-black/70 px-2 py-1 text-[10px] text-white">
        音声デバッグ: AudioContext={debug.audioContextState} / track.muted=
        {String(debug.trackMuted)} / {debug.trackReadyState}
      </div>
    </>
  );
}
