"use client";

import { useLocale } from "@/lib/i18n/LocaleContext";

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
  const { t } = useLocale();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={
        disabled
          ? t("room.disabledInWorkArea")
          : enabled
            ? t("room.videoCall.activeTitle")
            : t("room.videoCall.startTitle")
      }
      aria-label={
        enabled ? t("room.videoCall.stopAria") : t("room.videoCall.startAria")
      }
      className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
        enabled ? "bg-emerald-600 text-white" : "bg-slate-700 text-slate-300"
      } hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:opacity-40`}
    >
      <CameraIcon enabled={enabled} />
    </button>
  );
}
