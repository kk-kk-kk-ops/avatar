"use client";

type Props = {
  enabled: boolean;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
};

// MicIcon(components/MicButton.tsx)と同じ考え方でexportする
// (sizeは省略可能。未指定時はコントロールバーの既存サイズ18のまま)。
export function CaptionIcon({
  enabled,
  size = 18,
}: {
  enabled: boolean;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M7 10.5c-.6-.6-1.4-1-2.2-1-1.5 0-2.3 1.1-2.3 2.5s.8 2.5 2.3 2.5c.8 0 1.6-.4 2.2-1" />
      <path d="M15.5 10.5c-.6-.6-1.4-1-2.2-1-1.5 0-2.3 1.1-2.3 2.5s.8 2.5 2.3 2.5c.8 0 1.6-.4 2.2-1" />
      {!enabled && (
        <line x1="2" y1="2" x2="22" y2="22" stroke="#f87171" strokeWidth="2.5" />
      )}
    </svg>
  );
}

export default function CaptionButton({
  enabled,
  onClick,
  disabled,
  disabledReason,
}: Props) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={
        disabled
          ? (disabledReason ?? "この端末・ブラウザでは利用できません")
          : enabled
            ? "文字起こし: ON(クリックでOFF、終了時に文字起こし結果をダウンロード)"
            : "文字起こし: OFF(クリックでON)"
      }
      aria-label={enabled ? "文字起こしをオフにする" : "文字起こしをオンにする"}
      className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
        enabled ? "bg-emerald-600 text-white" : "bg-slate-700 text-slate-300"
      } hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:opacity-40`}
    >
      <CaptionIcon enabled={enabled} />
    </button>
  );
}
