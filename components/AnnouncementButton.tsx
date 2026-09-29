"use client";

type Props = {
  enabled: boolean;
  onClick: () => void;
  disabled?: boolean;
};

// MicIcon(components/MicButton.tsx)と同じ考え方でexportする
// (sizeは省略可能。未指定時はコントロールバーの既存サイズ18のまま)。
export function AnnouncementIcon({
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
      <path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z" />
      <path d="M16 8a4 4 0 0 1 0 8" />
      <path d="M19 5a8 8 0 0 1 0 14" />
      {!enabled && (
        <line x1="2" y1="2" x2="22" y2="22" stroke="#f87171" strokeWidth="2.5" />
      )}
    </svg>
  );
}

export default function AnnouncementButton({ enabled, onClick, disabled }: Props) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={
        disabled
          ? "作業エリア内では利用できません"
          : enabled
            ? "全体アナウンス: ON(クリックでOFF)"
            : "全体アナウンス: OFF(クリックでON)"
      }
      aria-label={enabled ? "全体アナウンスをオフにする" : "全体アナウンスをオンにする"}
      className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
        enabled ? "bg-emerald-600 text-white" : "bg-slate-700 text-slate-300"
      } hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:opacity-40`}
    >
      <AnnouncementIcon enabled={enabled} />
    </button>
  );
}
