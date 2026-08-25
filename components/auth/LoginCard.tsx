"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import GoogleLoginButton from "./GoogleLoginButton";

type Props = {
  inviteToken: string | null;
  inviterName: string | null;
  errorMessage: string | null;
  errorCode: string | null;
};

type Mode = "login" | "signup" | "forgot" | "resend";

// メール/パスワードでのログイン・新規登録・パスワード再設定をまとめた
// カード。Googleログイン(GoogleLoginButton)と同じ白いカード内に収め、
// 招待URL経由の場合の案内文・エラー表示はTOPページ(サーバー
// コンポーネント側)から props で受け取る。
export default function LoginCard({
  inviteToken,
  inviterName,
  errorMessage,
  errorCode,
}: Props) {
  const searchParams = useSearchParams();
  // props のinviteTokenは初回描画時点のものなので、フォーム操作中に
  // URLが変わることは無い前提だが念のためsearchParamsからも取れるように
  // しておく(GoogleLoginButtonと同じ取得元)。
  const currentInviteToken = searchParams.get("invite") ?? inviteToken;

  // 確認メールのリンクが期限切れ/使用済みだった場合は、最初から
  // 「確認メールを再送信」の入力欄を出しておく(パスワード再入力を
  // 求めずに再送できるようにするため)。
  const [mode, setMode] = useState<Mode>(
    errorCode === "link_expired" ? "resend" : "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const resetFormState = (nextMode: Mode) => {
    setMode(nextMode);
    setFormError(null);
    setSuccessMessage(null);
    setPassword("");
    setConfirmPassword("");
  };

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setFormError("メールアドレスとパスワードを入力してください。");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setFormError("メールアドレスまたはパスワードが正しくありません。");
        setSubmitting(false);
        return;
      }
      // ログイン成功。セッションCookieが設定された状態で現在のURL
      // (招待URLならそのクエリを含む)へ丸ごと再読み込みし、TOPページ
      // (サーバーコンポーネント)に最新のログイン状態で振り分け直させる。
      window.location.reload();
    } catch {
      setFormError("ネットワークエラーが発生しました。通信環境をご確認ください。");
      setSubmitting(false);
    }
  };

  const handleSignup = async () => {
    if (!email.trim() || !password) {
      setFormError("メールアドレスとパスワードを入力してください。");
      return;
    }
    if (password.length < 6) {
      setFormError("パスワードは6文字以上で入力してください。");
      return;
    }
    if (password !== confirmPassword) {
      setFormError("パスワードが一致しません。");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      // OAuth(GoogleLoginButton)と同じ理由で、招待トークンはURLの
      // クエリだけに頼らずsessionStorageにも保存しておく(H-1対応と
      // 同じ考え方。確認メールのリンク経由での遷移でも失われない)。
      if (currentInviteToken) {
        sessionStorage.setItem("pendingInviteToken", currentInviteToken);
      } else {
        sessionStorage.removeItem("pendingInviteToken");
      }
      const supabase = createClient();
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      if (currentInviteToken) {
        callbackUrl.searchParams.set("invite", currentInviteToken);
      }
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: callbackUrl.toString(),
          data: displayName.trim() ? { full_name: displayName.trim() } : undefined,
        },
      });
      // 既に登録済みのメールアドレスの場合、Supabase側はアカウントの
      // 有無を外部から探られないよう、エラーを返さず「確認メールを
      // 送信しました」風の応答のみを返す(実際にはメール送信しない)。
      // そのため成功・重複いずれの場合も同じ案内で統一する。
      if (error) {
        setFormError(
          "登録に失敗しました。入力内容をご確認のうえ、時間をおいて再度お試しください。",
        );
        setSubmitting(false);
        return;
      }
      setSuccessMessage(
        "確認メールを送信しました。メール内のリンクから登録を完了してください。",
      );
      setSubmitting(false);
    } catch {
      setFormError("ネットワークエラーが発生しました。通信環境をご確認ください。");
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setFormError("メールアドレスを入力してください。");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const supabase = createClient();
      const redirectUrl = new URL(
        "/auth/reset-password",
        window.location.origin,
      );
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: redirectUrl.toString() },
      );
      if (error) {
        setFormError(
          "送信に失敗しました。時間をおいて再度お試しください。",
        );
        setSubmitting(false);
        return;
      }
      // こちらも同様に、登録の有無に関わらず同じ案内で統一する。
      setSuccessMessage("パスワード再設定用のメールを送信しました。");
      setSubmitting(false);
    } catch {
      setFormError("ネットワークエラーが発生しました。通信環境をご確認ください。");
      setSubmitting(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (!email.trim()) {
      setFormError("メールアドレスを入力してください。");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      if (currentInviteToken) {
        sessionStorage.setItem("pendingInviteToken", currentInviteToken);
      } else {
        sessionStorage.removeItem("pendingInviteToken");
      }
      const supabase = createClient();
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      if (currentInviteToken) {
        callbackUrl.searchParams.set("invite", currentInviteToken);
      }
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: callbackUrl.toString() },
      });
      if (error) {
        setFormError(
          "送信に失敗しました。時間をおいて再度お試しください。",
        );
        setSubmitting(false);
        return;
      }
      setSuccessMessage("確認メールを再送信しました。");
      setSubmitting(false);
    } catch {
      setFormError("ネットワークエラーが発生しました。通信環境をご確認ください。");
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (mode === "login") handleLogin();
    else if (mode === "signup") handleSignup();
    else if (mode === "forgot") handleForgotPassword();
    else handleResendConfirmation();
  };

  return (
    <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt="ロゴ"
        className="mx-auto mb-4 h-14 w-14 object-contain"
      />
      <h1 className="mb-2 text-lg font-bold text-slate-800">Globy</h1>
      <p className="mb-6 text-xs text-slate-500">
        {currentInviteToken
          ? inviterName
            ? `${inviterName}さんからの招待`
            : "招待されたルームにゲストとして参加します"
          : "ログインしてください"}
      </p>

      {errorMessage && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {errorMessage}
        </p>
      )}

      <GoogleLoginButton />

      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-[11px] text-slate-400">または</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      {mode !== "forgot" && mode !== "resend" && (
        <div className="mb-4 flex rounded-lg bg-slate-100 p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => resetFormState("login")}
            className={`flex-1 rounded-md py-1.5 transition-colors ${
              mode === "login"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500"
            }`}
          >
            ログイン
          </button>
          <button
            type="button"
            onClick={() => resetFormState("signup")}
            className={`flex-1 rounded-md py-1.5 transition-colors ${
              mode === "signup"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500"
            }`}
          >
            新規登録
          </button>
        </div>
      )}

      {mode === "forgot" && (
        <p className="mb-3 text-left text-xs font-semibold text-slate-600">
          パスワード再設定
        </p>
      )}
      {mode === "resend" && (
        <p className="mb-3 text-left text-xs font-semibold text-slate-600">
          確認メールの再送信
        </p>
      )}

      {successMessage ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {successMessage}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3 text-left">
          {mode === "signup" && (
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="表示名(任意)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="メールアドレス"
            autoComplete="email"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          {mode !== "forgot" && mode !== "resend" && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="パスワード"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          )}
          {mode === "signup" && (
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="パスワード(確認用)"
              autoComplete="new-password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          )}

          {formError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
          >
            {submitting
              ? "処理中..."
              : mode === "login"
                ? "ログイン"
                : mode === "signup"
                  ? "登録する"
                  : mode === "resend"
                    ? "確認メールを再送信する"
                    : "送信する"}
          </button>

          {mode === "login" && (
            <button
              type="button"
              onClick={() => resetFormState("forgot")}
              className="block w-full text-center text-xs text-slate-400 hover:text-slate-600"
            >
              パスワードをお忘れですか?
            </button>
          )}
          {(mode === "forgot" || mode === "resend") && (
            <button
              type="button"
              onClick={() => resetFormState("login")}
              className="block w-full text-center text-xs text-slate-400 hover:text-slate-600"
            >
              ログインに戻る
            </button>
          )}
        </form>
      )}
    </div>
  );
}
