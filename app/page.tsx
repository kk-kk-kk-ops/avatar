import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState } from "@/lib/authRouting";
import { joinAccountViaInvite } from "@/lib/joinAccountViaInvite";
import { AUTH_ERROR_MESSAGES } from "@/lib/authErrorMessages";
import GoogleLoginButton from "@/components/auth/GoogleLoginButton";

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

  const inviteToken = searchParams.invite;

  if (user) {
    // 既にログイン済みのブラウザで他人の招待URL(?invite=トークン)を
    // 開いた場合もゲストとして参加させる(Googleログインの
    // /auth/callbackはセッションが無い初回ログイン時にしか通らないため、
    // ここでも同じ処理をしないと、既に自分のアカウントを持つ管理者が
    // 招待URLを踏んでも自分の管理画面に戻ってしまっていた)。
    if (inviteToken) {
      const result = await joinAccountViaInvite(supabase, user.id, inviteToken);
      if (!result.ok) {
        if (result.error === "join_failed") {
          // eslint-disable-next-line no-console
          console.error("招待経由の参加に失敗しました", result.detail);
        }
        redirect(
          `/?error=${result.error === "invalid_invite" ? "invalid_invite" : "auth_failed"}`,
        );
      }
      if (result.viewOnly) {
        redirect(`/rooms?invite=${encodeURIComponent(inviteToken)}`);
      }
      // 他人の招待URL経由でゲスト参加した場合は、isMaster/管理者であっても
      // 必ずルーム選択画面へ進む(自分の管理画面/マスター画面には戻さない)。
      if (!result.isOwnAccount) {
        redirect("/rooms");
      }
    }

    const state = await resolveUserRouteState(supabase, user.id);
    if (state.isMaster) redirect("/master");
    if (state.type === "no-account") redirect("/plan");
    if (state.type === "admin") redirect("/admin");
    redirect("/rooms");
  }

  const errorMessage = searchParams.error
    ? AUTH_ERROR_MESSAGES[searchParams.error]
    : null;

  // 未ログインで招待URL経由の場合、ログイン画面に「〇〇〇さんからの招待」
  // と表示するため、招待者名だけ先に取得しておく(実際にゲストとして
  // 参加させる処理はログイン後のjoinAccountViaInviteで行う)。
  let inviterName: string | null = null;
  if (inviteToken) {
    const { data: accountRows } = await supabase.rpc(
      "lookup_account_by_invite_token",
      { token: inviteToken },
    );
    inviterName = accountRows?.[0]?.invite_inviter_name ?? null;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-8 text-center shadow-xl">
        <span
          className={`mb-4 inline-block rounded-full px-3 py-1 text-xs font-semibold ${
            inviteToken
              ? "bg-emerald-50 text-emerald-700"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {inviteToken ? "ゲスト用ログイン" : "管理者用ログイン"}
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="ロゴ"
          className="mx-auto mb-4 h-14 w-14 object-contain"
        />
        <h1 className="mb-2 text-lg font-bold text-slate-800">
          Globy
        </h1>
        <p className="mb-6 text-xs text-slate-500">
          {inviteToken
            ? inviterName
              ? `${inviterName}さんからの招待`
              : "招待されたルームにゲストとして参加します"
            : "管理者・マスター権限をお持ちの方はこちらからログインしてください"}
        </p>

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
