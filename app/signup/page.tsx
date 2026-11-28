import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { translateAuthError } from "@/lib/i18n/translations";
import { getServerLocale } from "@/lib/i18n/getServerLocale";
import LoginCard from "@/components/auth/LoginCard";

// 検索結果に出す必要が無いページのため、検索エンジンにはindexしないよう
// 伝える(2026-11-28、SEO設定)。
export const metadata: Metadata = {
  title: "新規登録",
  robots: { index: false },
};

// 新規登録専用の入口(2026-10末)。LPの「無料で始める」等のボタンから
// ここへ直接来る。app/login/page.tsxと同じ画面(LoginCard)を使うが、
// 最初から「新規登録」タブを開いた状態で表示する。
export default async function SignupPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  const errorMessage = translateAuthError(getServerLocale(), searchParams.error);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4">
      <LoginCard
        inviteToken={null}
        inviterName={null}
        errorMessage={errorMessage}
        initialMode="signup"
      />
    </div>
  );
}
