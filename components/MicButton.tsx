"use client";

type Props = {
  enabled: boolean;
  onClick: () => void;
};

function MicIcon({ enabled }: { enabled: boolean }) {
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
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
      {!enabled && (
        <line x1="2" y1="2" x2="22" y2="22" stroke="#f87171" strokeWidth="2.5" />
      )}
    </svg>
  );
}

export default function MicButton({ enabled, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      title={enabled ? "マイク: ON(クリックでミュート)" : "マイク: OFF(クリックで解除)"}
      aria-label={enabled ? "マイクをオフにする" : "マイクをオンにする"}
      className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
        enabled ? "bg-emerald-600 text-white" : "bg-slate-700 text-slate-300"
      } hover:opacity-80`}
    >
      <MicIcon enabled={enabled} />
    </button>
  );
}
