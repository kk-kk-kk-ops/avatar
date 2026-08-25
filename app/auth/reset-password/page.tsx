import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";

// パスワード再設定メールのリンク(?code=...)を踏んだ後に着地するページ。
// signUpの確認メール(/auth/callback経由)とは違い、ここではコード交換で
// 終わらせず「新しいパスワードを入力してもらう」ステップが必要なため、
// 専用のページとして分けている。
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { code?: string };
}) {
  const supabase = createClient();

  if (searchParams.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(
      searchParams.code,
    );
    if (error) {
      redirect("/?error=session_expired");
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // codeが無い/無効だった場合は、再設定リンクを開き直してもらうしかない。
    redirect("/?error=auth_failed");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4">
      <ResetPasswordForm />
    </div>
  );
}
