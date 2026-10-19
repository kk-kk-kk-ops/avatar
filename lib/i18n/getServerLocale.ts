import { cookies } from "next/headers";
import { LOCALE_COOKIE_NAME, type Locale } from "./translations";

// サーバーコンポーネントで初期表示言語を決めるためのヘルパー。
// クッキーが無い(初回訪問)場合は日本語をデフォルトにする。
export function getServerLocale(): Locale {
  const value = cookies().get(LOCALE_COOKIE_NAME)?.value;
  return value === "en" ? "en" : "ja";
}
