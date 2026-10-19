"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import type { Locale } from "@/lib/i18n/translations";

const OPTIONS: { value: Locale; labelKey: "lang.japanese" | "lang.english" }[] = [
  { value: "ja", labelKey: "lang.japanese" },
  { value: "en", labelKey: "lang.english" },
];

export default function LanguageSwitcher({
  className = "",
  variant = "light",
  onChange,
}: {
  className?: string;
  // ログイン画面(白背景)用のlight、設定パネル(暗背景)用のdark。
  variant?: "light" | "dark";
  // 選択時、コンテキストのsetLocaleに加えて呼ばれるコールバック
  // (ログイン後の設定パネルでは、アカウントへの保存(profiles.locale)
  // をここで行う)。
  onChange?: (locale: Locale) => void;
}) {
  const { locale, setLocale, t } = useLocale();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          variant === "dark"
            ? "rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-700"
            : "rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"
        }
      >
        {t("lang.buttonLabel")}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-28 rounded-md border border-slate-200 bg-white py-1 text-left text-xs shadow-lg">
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setLocale(opt.value);
                onChange?.(opt.value);
                setOpen(false);
              }}
              className={`block w-full px-3 py-1.5 text-left hover:bg-slate-50 ${
                locale === opt.value
                  ? "font-semibold text-slate-900"
                  : "text-slate-600"
              }`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
