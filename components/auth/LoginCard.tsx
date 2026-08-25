"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import GoogleLoginButton from "./GoogleLoginButton";

type Props = {
  inviteToken: string | null;
  inviterName: string | null;
  errorMessage: string | null;
};

// 新規登録・パスワード再設定は、いずれも「メールで届いた確認コードを
// 画面に入力する」方式にしている(2026-08-24)。以前はリンクをクリックする
// 方式だったが、メールアプリやセキュリティ製品がリンクを自動で開いて
// しまい、実際にユーザーが押す前にリンクが失効してしまう不具合があった
// ため、リンクを介さないOTP方式へ切り替えた。
type Mode =
  | "login"
  | "signup"
  | "signup-code"
  | "forgot"
  | "forgot-code"
  | "forgot-new-password";

export default function LoginCard({
  inviteToken,
  inviterName,
  errorMessage,
}: Props) {
  const searchParams = useSearchParams();
  // props のinviteTokenは初回描画時点のものなので、フォーム操作中に
  // URLが変わることは無い前提だが念のためsearchParamsからも取れるように
  // しておく(GoogleLoginButtonと同じ取得元)。
  const currentInviteToken = searchParams.get("invite") ?? inviteToken;

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const resetFormState = (nextMode: Mode) => {
    setMode(nextMode);
    setFormError(null);
    setSuccessMessage(null);
    setPassword("");
    setConfirmPassword("");
    setOtpCode("");
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

  // 招待トークンをsessionStorageに保存する(OAuthと同じH-1対応の考え方。
  // OTPコード確認後に/auth/callbackへ遷移する際、URLクエリだけに頼らず
  // 確実に引き継ぐため)。
  const stashInviteToken = () => {
    if (currentInviteToken) {
      sessionStorage.setItem("pendingInviteToken", currentInviteToken);
    } else {
      sessionStorage.removeItem("pendingInviteToken");
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
      stashInviteToken();
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: displayName.trim() ? { full_name: displayName.trim() } : undefined,
        },
      });
      if (error) {
        setFormError(
          "登録に失敗しました。入力内容をご確認のうえ、時間をおいて再度お試しください。",
        );
        setSubmitting(false);
        return;
      }
      // 既に登録済みのメールアドレスの場合、Supabaseはアカウントの有無を
      // 外部から探られないよう、エラーを返さず「確認コードを送信しました」
      // 風の応答のみを返す(実際にはメール送信しない)。ただし
      // data.user.identitiesが空配列になる点で、本当に新規作成できたか
      // どうかをクライアント側でも判別できる(Supabase公式に案内されている
      // 方法)。これを見て、既存アカウントの場合ははっきり「登録済み」と
      // 案内する。
      if (data.user && data.user.identities?.length === 0) {
        setFormError(
          "このメールアドレスは既に登録済みです。ログインをお試しいただくか、パスワードをお忘れの場合は再設定してください。",
        );
        setSubmitting(false);
        return;
      }
      setOtpCode("");
      setMode("signup-code");
      setSubmitting(false);
    } catch {
      setFormError("ネットワークエラーが発生しました。通信環境をご確認ください。");
      setSubmitting(false);
    }
  };

  const handleVerifySignupCode = async () => {
    if (!otpCode.trim()) {
      setFormError("確認コードを入力してください。");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otpCode.trim(),
        type: "signup",
      });
      if (error) {
        setFormError(
          "コードが正しくないか、有効期限が切れています。再送信してもう一度お試しください。",
        );
        setSubmitting(false);
        return;
      }
      // 確認成功。この時点でセッションCookieが確立済みなので、
      // /auth/callbackへ遷移してプロフィール作成・招待URLの解決などの
      // 共通処理(Googleログインと共用)を行わせる。
      window.location.href = "/auth/callback";
    } catch {
      setFormError("ネットワークエラーが発生しました。通信環境をご確認ください。");
      setSubmitting(false);
    }
  };

  const handleResendSignupCode = async () => {
    if (!email.trim()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      stashInviteToken();
      const supabase = createClient();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
      });
      if (error) {
        setFormError("再送信に失敗しました。時間をおいて再度お試しください。");
        setSubmitting(false);
        return;
      }
      setFormError(null);
      setSuccessMessage("確認コードを再送信しました。");
      setSubmitting(false);
    } catch {
      setFormError("ネットワークエラーが発生しました。通信環境をご確認ください。");
      setSubmitting(false);
    }
  };

  const handleRequestPasswordReset = async () => {
    if (!email.trim()) {
      setFormError("メールアドレスを入力してください。");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
      );
      // 登録の有無に関わらず同じ案内・同じ次の画面で統一する
      // (アカウントの有無を外部から探られないようにするため)。
      if (error) {
        setFormError(
          "送信に失敗しました。時間をおいて再度お試しください。",
        );
        setSubmitting(false);
        return;
      }
      setOtpCode("");
      setMode("forgot-code");
      setSubmitting(false);
    } catch {
      setFormError("ネットワークエラーが発生しました。通信環境をご確認ください。");
      setSubmitting(false);
    }
  };

  const handleVerifyResetCode = async () => {
    if (!otpCode.trim()) {
      setFormError("確認コードを入力してください。");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otpCode.trim(),
        type: "recovery",
      });
      if (error) {
        setFormError(
          "コードが正しくないか、有効期限が切れています。再送信してもう一度お試しください。",
        );
        setSubmitting(false);
        return;
      }
      // 確認成功。セッションが確立された状態のまま、続けて新しい
      // パスワードを入力してもらう(別ページへの遷移は不要)。
      setPassword("");
      setConfirmPassword("");
      setMode("forgot-new-password");
      setSubmitting(false);
    } catch {
      setFormError("ネットワークエラーが発生しました。通信環境をご確認ください。");
      setSubmitting(false);
    }
  };

  const handleResendResetCode = async () => {
    if (!email.trim()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
      );
      if (error) {
        setFormError("再送信に失敗しました。時間をおいて再度お試しください。");
        setSubmitting(false);
        return;
      }
      setFormError(null);
      setSuccessMessage("確認コードを再送信しました。");
      setSubmitting(false);
    } catch {
      setFormError("ネットワークエラーが発生しました。通信環境をご確認ください。");
      setSubmitting(false);
    }
  };

  const handleSetNewPassword = async () => {
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
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setFormError("更新に失敗しました。時間をおいて再度お試しください。");
        setSubmitting(false);
        return;
      }
      setSuccessMessage("パスワードを更新しました。");
      setSubmitting(false);
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      setFormError("ネットワークエラーが発生しました。通信環境をご確認ください。");
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    switch (mode) {
      case "login":
        return handleLogin();
      case "signup":
        return handleSignup();
      case "signup-code":
        return handleVerifySignupCode();
      case "forgot":
        return handleRequestPasswordReset();
      case "forgot-code":
        return handleVerifyResetCode();
      case "forgot-new-password":
        return handleSetNewPassword();
    }
  };

  const showTabs = mode === "login" || mode === "signup";

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

      {showTabs && (
        <>
          <GoogleLoginButton />
          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] text-slate-400">または</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
        </>
      )}

      {showTabs && (
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

      {mode === "signup-code" && (
        <p className="mb-3 text-left text-xs text-slate-600">
          <span className="font-semibold">{email}</span>{" "}
          宛に確認コードを送信しました。メールに記載の確認コードを入力してください。
        </p>
      )}
      {mode === "forgot" && (
        <p className="mb-3 text-left text-xs font-semibold text-slate-600">
          パスワード再設定
        </p>
      )}
      {mode === "forgot-code" && (
        <p className="mb-3 text-left text-xs text-slate-600">
          <span className="font-semibold">{email}</span>{" "}
          宛に確認コードを送信しました。メールに記載の確認コードを入力してください。
        </p>
      )}
      {mode === "forgot-new-password" && (
        <p className="mb-3 text-left text-xs font-semibold text-slate-600">
          新しいパスワードを設定
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-3 text-left">
        {mode === "signup" && (
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="表示名(任意)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        )}

        {(mode === "login" || mode === "signup" || mode === "forgot") && (
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="メールアドレス"
            autoComplete="email"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        )}

        {(mode === "login" || mode === "signup") && (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="パスワード"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
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

        {(mode === "signup-code" || mode === "forgot-code") && (
          <input
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="確認コード"
            inputMode="numeric"
            // Supabase側のOTP桁数設定(プロジェクトの作成時期により6桁/
            // 8桁いずれかがデフォルトになる)にコード側が依存しすぎない
            // よう、実際の桁数より余裕を持たせている(桁数を厳密に
            // 固定すると、ダッシュボード側の設定変更だけで正しいコードが
            // 入力できなくなる不具合が起きるため)。
            maxLength={10}
            autoFocus
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg tracking-[0.3em] outline-none focus:border-slate-500"
          />
        )}

        {mode === "forgot-new-password" && (
          <>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="新しいパスワード"
              autoComplete="new-password"
              autoFocus
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="新しいパスワード(確認用)"
              autoComplete="new-password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </>
        )}

        {successMessage && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {successMessage}
          </p>
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
                : mode === "signup-code" || mode === "forgot-code"
                  ? "確認する"
                  : mode === "forgot"
                    ? "送信する"
                    : "更新する"}
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
        {mode === "signup-code" && (
          <button
            type="button"
            onClick={handleResendSignupCode}
            disabled={submitting}
            className="block w-full text-center text-xs text-slate-400 hover:text-slate-600"
          >
            コードが届かない場合は再送信
          </button>
        )}
        {mode === "forgot-code" && (
          <button
            type="button"
            onClick={handleResendResetCode}
            disabled={submitting}
            className="block w-full text-center text-xs text-slate-400 hover:text-slate-600"
          >
            コードが届かない場合は再送信
          </button>
        )}
        {(mode === "forgot" ||
          mode === "signup-code" ||
          mode === "forgot-code") && (
          <button
            type="button"
            onClick={() => resetFormState("login")}
            className="block w-full text-center text-xs text-slate-400 hover:text-slate-600"
          >
            ログインに戻る
          </button>
        )}
      </form>
    </div>
  );
}
