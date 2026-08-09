"use client";

type Props = {
  onClick: () => void;
};

function ExitIcon() {
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
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export default function LeaveRoomButton({ onClick }: Props) {
  return (
    <button
      onClick={onClick}
      title="ルームから退出する"
      aria-label="ルームから退出する"
      className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:opacity-80"
    >
      <ExitIcon />
    </button>
  );
}
