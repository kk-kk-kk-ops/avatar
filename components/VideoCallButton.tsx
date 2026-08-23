"use client";

type Props = {
  enabled: boolean;
  onClick: () => void;
  disabled?: boolean;
};

function CameraIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      {!enabled && (
        <line
          x1="2"
          y1="2"
          x2="22"
          y2="22"
          stroke="#f87171"
          strokeWidth="2.5"
        />
      )}
    </svg>
  );
}

export default function VideoCallButton({
  enabled,
  onClick,
  disabled,
}: Props) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={
        disabled
          ? "作業エリア内では利用できません"
          : enabled
            ? "ビデオ通話: 中(クリックで終了)"
            : "ビデオ通話を開始する"
      }
      aria-label={enabled ? "ビデオ通話を終了する" : "ビデオ通話を開始する"}
      className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
        enabled ? "bg-emerald-600 text-white" : "bg-slate-700 text-slate-300"
      } hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:opacity-40`}
    >
      <CameraIcon enabled={enabled} />
    </button>
  );
}
