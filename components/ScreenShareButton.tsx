"use client";

import { useLocale } from "@/lib/i18n/LocaleContext";

type Props = {
  enabled: boolean;
  onClick: () => void;
  disabled?: boolean;
};

function ScreenIcon({ enabled }: { enabled: boolean }) {
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
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <line x1="8" y1="22" x2="16" y2="22" />
      <line x1="12" y1="18" x2="12" y2="22" />
      {enabled && <path d="M8 12l2.5 2.5L16 9" />}
    </svg>
  );
}

export default function ScreenShareButton({
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
            ? t("room.screenShare.activeTitle")
            : t("room.screenShare.startTitle")
      }
      aria-label={
        enabled ? t("room.screenShare.stopAria") : t("room.screenShare.startAria")
      }
      className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
        enabled ? "bg-emerald-600 text-white" : "bg-slate-700 text-slate-300"
      } hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:opacity-40`}
    >
      <ScreenIcon enabled={enabled} />
    </button>
  );
}
