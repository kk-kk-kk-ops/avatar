"use client";

// 文字起こしテロップ(字幕)の表示/非表示切り替えボタン(2026-10追加)。
// デザイン・ホバー挙動はMicButton/VideoCallButtonと統一する
// (2026-10報告: 独自のhover:bg-black/80だと、スマホでタップ後に
// :hoverが残り続ける端末でON時の緑色がhoverの黒に上書きされて見え、
// 「押しても緑にならない」という挙動差が生じていた。opacity方式の
// hoverに揃えることでPCと同じ見た目になる)。

type Props = {
  enabled: boolean;
  onClick: () => void;
  disabled?: boolean;
};

function TelopIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="5" width="20" height="14" rx="2" ry="2" />
      <line x1="6" y1="10" x2="18" y2="10" />
      <line x1="6" y1="14" x2="13" y2="14" />
      {!enabled && (
        <line x1="2" y1="2" x2="22" y2="22" stroke="#f87171" strokeWidth="2.5" />
      )}
    </svg>
  );
}

export default function TelopButton({ enabled, onClick, disabled }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={
        enabled
          ? "文字起こしテロップを非表示にする"
          : "文字起こしテロップを表示する"
      }
      aria-label={
        enabled
          ? "文字起こしテロップを非表示にする"
          : "文字起こしテロップを表示する"
      }
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
        enabled ? "bg-emerald-600 text-white" : "bg-black/60 text-white"
      } hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:opacity-40`}
    >
      <TelopIcon enabled={enabled} />
    </button>
  );
}
