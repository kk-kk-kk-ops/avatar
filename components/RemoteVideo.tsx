"use client";

import { useEffect, useRef } from "react";

type Props = {
  stream: MediaStream;
  className?: string;
  onClick?: () => void;
};

export default function RemoteVideo({ stream, className, onClick }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      onClick={onClick}
      className={className}
    />
  );
}
