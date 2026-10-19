"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LOCALE_COOKIE_NAME, translate, type Locale } from "./translations";

function writeCookieLocale(locale: Locale) {
  if (typeof document === "undefined") return;
  // 1年保持。ログイン前の言語選択をブラウザ単位で覚えておくためのもの
  // (ログイン前は紐付けるアカウントが無いため、アカウント単位の保存は
  // 設定パネルの言語ボタン(ログイン後)側で別途行う)。
  document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=31536000; samesite=lax`;
}

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale: (next) => {
        setLocaleState(next);
        writeCookieLocale(next);
      },
      t: (key, params) => translate(locale, key, params),
    }),
    [locale],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
