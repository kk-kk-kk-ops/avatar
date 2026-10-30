import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { translateAuthError } from "@/lib/i18n/translations";
import { getServerLocale } from "@/lib/i18n/getServerLocale";
import LoginCard from "@/components/auth/LoginCard";

// ログイン専用の入口(2026-10末)。TOPページ(/)は未ログイン時にLP(/lp)へ
// 転送するようになったため、LPの「ログイン」リンク等はこちらへ向ける。
// 招待URル(?invite=トークン)はこれまでと同じく"/"側だけで扱うため、
// ここでは扱わない(招待リンクは"/"のまま変更していない)。
export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // ログイン済みなら、招待URL・プラン・管理画面等への振り分けを"/"に委ねる。
  if (user) redirect("/");

  const errorMessage = translateAuthError(getServerLocale(), searchParams.error);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4">
      <LoginCard
        inviteToken={null}
        inviterName={null}
        errorMessage={errorMessage}
        initialMode="login"
      />
    </div>
  );
}
