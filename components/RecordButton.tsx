"use client";

// 文字起こし専用ボタン(CaptionButton)を廃止し、画面録画(音声・文字起こし
// テキストも含めてローカル保存)の開始/停止ボタンに変更した(2026-10)。
// 会議室の施錠アイコンの真下に設置し、会議室内でのみ表示する。

export function RecordIcon({
  recording,
  size = 18,
}: {
  recording: boolean;
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
      <circle cx="12" cy="12" r="9" />
      {recording ? (
        <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" stroke="none" />
      ) : (
        <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
      )}
    </svg>
  );
}

export default function RecordButton({
  recording,
  onClick,
  disabled,
  disabledReason,
}: {
  recording: boolean;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={
        disabled
          ? (disabledReason ?? "現在この操作はできません")
          : recording
            ? "録画を停止する"
            : "画面録画を開始する"
      }
      aria-label={recording ? "録画を停止する" : "画面録画を開始する"}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
        recording
          ? "bg-red-600 text-white hover:bg-red-500"
          : "bg-black/60 text-white hover:bg-black/80"
      } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-black/60`}
    >
      <RecordIcon recording={recording} />
    </button>
  );
}
