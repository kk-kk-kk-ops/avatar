import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState } from "@/lib/authRouting";
import { joinAccountViaInvite } from "@/lib/joinAccountViaInvite";
import GoogleLoginButton from "@/components/auth/GoogleLoginButton";

const ERROR_MESSAGES: Record<string, string> = {
  cancelled: "ログインがキャンセルされました。",
  auth_failed: "ログインに失敗しました。もう一度お試しください。",
  session_expired:
    "セッションの有効期限が切れました。もう一度ログインしてください。",
  network:
    "ネットワークエラーが発生しました。通信環境をご確認のうえ、再度お試しください。",
  invalid_invite:
    "招待リンクが無効です。招待した管理者に再発行を依頼してください。",
};

// TOPページ(公開)。ログイン済みならプラン選択/管理画面/ルーム選択の
// いずれかへ自動的に進む(何度再訪してもここが入り口になる)。
export default async function Home({
  searchParams,
}: {
  searchParams: { error?: string; invite?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // 既にログイン済みのブラウザで他人の招待URL(?invite=トークン)を
    // 開いた場合もゲストとして参加させる(Googleログインの
    // /auth/callbackはセッションが無い初回ログイン時にしか通らないため、
    // ここでも同じ処理をしないと、既に自分のアカウントを持つ管理者が
    // 招待URLを踏んでも自分の管理画面に戻ってしまっていた)。
    const inviteToken = searchParams.invite;
    if (inviteToken) {
      const result = await joinAccountViaInvite(supabase, user.id, inviteToken);
      if (!result.ok) {
        redirect(
          `/?error=${result.error === "invalid_invite" ? "invalid_invite" : "auth_failed"}`,
        );
      }
    }

    const state = await resolveUserRouteState(supabase, user.id);
    if (state.isMaster) redirect("/master");
    if (state.type === "no-account") redirect("/plan");
    if (state.type === "admin") redirect("/admin");
    redirect("/rooms");
  }

  const errorMessage = searchParams.error
    ? ERROR_MESSAGES[searchParams.error]
    : null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-8 text-center shadow-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="ロゴ"
          className="mx-auto mb-4 h-14 w-14 object-contain"
        />
        <h1 className="mb-8 text-lg font-bold text-slate-800">
          Grovina Office
        </h1>

        {errorMessage && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            {errorMessage}
          </p>
        )}

        <GoogleLoginButton />
      </div>
    </div>
  );
}
