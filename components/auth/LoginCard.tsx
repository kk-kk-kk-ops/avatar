"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loginWithPassword } from "./actions";
import GoogleLoginButton from "./GoogleLoginButton";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLocale } from "@/lib/i18n/LocaleContext";
import TurnstileWidget, {
  type TurnstileWidgetHandle,
} from "@/components/TurnstileWidget";

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
  const { t, locale } = useLocale();
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

  // Cloudflare Turnstile(ボット判定)。ログイン・新規登録・パスワード
  // 再設定(および確認コードの再送信)の各送信時にトークンを一緒に送る。
  // トークンは1回使うと失効するため、送信のたびにウィジェットをリセットし
  // 次の送信に備える(resetCaptcha参照)。
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [captchaLoadError, setCaptchaLoadError] = useState(false);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);
  const resetCaptcha = () => {
    turnstileRef.current?.reset();
    setTurnstileToken(null);
  };

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
      setFormError(t("error.emailPasswordRequired"));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      // ログイン失敗回数によるロック(components/auth/actions.ts)を
      // 効かせるため、ブラウザから直接signInWithPasswordを呼ばず
      // Server Action経由にする。
      const result = await loginWithPassword(
        email.trim(),
        password,
        locale,
        turnstileToken ?? undefined,
      );
      resetCaptcha();
      if (!result.ok) {
        setFormError(result.error);
        setSubmitting(false);
        return;
      }
      // ログイン成功。セッションCookieが設定された状態で現在のURL
      // (招待URLならそのクエリを含む)へ丸ごと再読み込みし、TOPページ
      // (サーバーコンポーネント)に最新のログイン状態で振り分け直させる。
      window.location.reload();
    } catch {
      resetCaptcha();
      setFormError(t("common.networkError"));
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
      setFormError(t("error.emailPasswordRequired"));
      return;
    }
    if (password.length < 6) {
      setFormError(t("error.passwordTooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setFormError(t("error.passwordMismatch"));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      // メール/パスワードで既に登録済みかどうかをサーバー側(profiles.provider)
      // で先に判定する。Googleで登録済みの場合はここではfalseが返り、
      // 未登録の場合と区別しない(メールアドレス列挙攻撃対策)。そのまま
      // signUp()に進ませることで、Googleアカウントとの重複時は従来通り
      // 「確認コードを送信しました」という曖昧な案内のみを表示する
      // (実際には送信されない)。
      const checkRes = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const checkJson = await checkRes.json().catch(() => ({}));
      if (checkJson.registeredWithPassword) {
        setFormError(t("error.alreadyRegistered"));
        setSubmitting(false);
        return;
      }

      stashInviteToken();
      const supabase = createClient();
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: displayName.trim() ? { full_name: displayName.trim() } : undefined,
          captchaToken: turnstileToken ?? undefined,
        },
      });
      resetCaptcha();
      if (error) {
        setFormError(t("error.signupFailed"));
        setSubmitting(false);
        return;
      }
      setOtpCode("");
      setMode("signup-code");
      setSubmitting(false);
    } catch {
      resetCaptcha();
      setFormError(t("common.networkError"));
      setSubmitting(false);
    }
  };

  const handleVerifySignupCode = async () => {
    if (!otpCode.trim()) {
      setFormError(t("error.codeRequired"));
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
        setFormError(t("error.codeInvalid"));
        setSubmitting(false);
        return;
      }
      // 確認成功。この時点でセッションCookieが確立済みなので、
      // /auth/callbackへ遷移してプロフィール作成・招待URLの解決などの
      // 共通処理(Googleログインと共用)を行わせる。
      window.location.href = "/auth/callback";
    } catch {
      setFormError(t("common.networkError"));
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
        options: { captchaToken: turnstileToken ?? undefined },
      });
      resetCaptcha();
      if (error) {
        setFormError(t("error.resendFailed"));
        setSubmitting(false);
        return;
      }
      setFormError(null);
      setSuccessMessage(t("success.codeResent"));
      setSubmitting(false);
    } catch {
      resetCaptcha();
      setFormError(t("common.networkError"));
      setSubmitting(false);
    }
  };

  const handleRequestPasswordReset = async () => {
    if (!email.trim()) {
      setFormError(t("error.emailRequired"));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { captchaToken: turnstileToken ?? undefined },
      );
      resetCaptcha();
      // 登録の有無に関わらず同じ案内・同じ次の画面で統一する
      // (アカウントの有無を外部から探られないようにするため)。
      if (error) {
        setFormError(t("error.sendFailed"));
        setSubmitting(false);
        return;
      }
      setOtpCode("");
      setMode("forgot-code");
      setSubmitting(false);
    } catch {
      resetCaptcha();
      setFormError(t("common.networkError"));
      setSubmitting(false);
    }
  };

  const handleVerifyResetCode = async () => {
    if (!otpCode.trim()) {
      setFormError(t("error.codeRequired"));
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
        setFormError(t("error.codeInvalid"));
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
      setFormError(t("common.networkError"));
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
        { captchaToken: turnstileToken ?? undefined },
      );
      resetCaptcha();
      if (error) {
        setFormError(t("error.resendFailed"));
        setSubmitting(false);
        return;
      }
      setFormError(null);
      setSuccessMessage(t("success.codeResent"));
      setSubmitting(false);
    } catch {
      resetCaptcha();
      setFormError(t("common.networkError"));
      setSubmitting(false);
    }
  };

  const handleSetNewPassword = async () => {
    if (password.length < 6) {
      setFormError(t("error.passwordTooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setFormError(t("error.passwordMismatch"));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setFormError(t("error.updateFailed"));
        setSubmitting(false);
        return;
      }
      setSuccessMessage(t("success.passwordUpdated"));
      setSubmitting(false);
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      setFormError(t("common.networkError"));
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
  // ウィジェット自体は、送信ボタンかこの画面の「再送信」ボタンのいずれかが
  // captchaTokenを必要とする画面でだけ表示する。signup-code/forgot-code
  // 画面の主ボタン(コード確認)はcaptcha不要だが、再送信ボタンは必要。
  const showCaptcha =
    mode === "login" ||
    mode === "signup" ||
    mode === "forgot" ||
    mode === "signup-code" ||
    mode === "forgot-code";
  const submitNeedsCaptcha =
    mode === "login" || mode === "signup" || mode === "forgot";

  return (
    <div className="relative w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt={t("login.logoAlt")}
        className="mx-auto mb-4 h-14 w-14 object-contain"
      />
      <h1 className="mb-2 text-lg font-bold text-slate-800">Globy</h1>
      <p className="mb-6 text-xs text-slate-500">
        {currentInviteToken
          ? inviterName
            ? t("login.invitedBy", { name: inviterName })
            : t("login.joinAsGuest")
          : t("login.pleaseLogin")}
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
            <span className="text-[11px] text-slate-400">{t("common.or")}</span>
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
            {t("login.tabLogin")}
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
            {t("login.tabSignup")}
          </button>
        </div>
      )}

      {mode === "signup-code" && (
        <p className="mb-3 text-left text-xs text-slate-600">
          {t("login.codeSentTo", { email })}
        </p>
      )}
      {mode === "forgot" && (
        <p className="mb-3 text-left text-xs font-semibold text-slate-600">
          {t("login.resetPasswordTitle")}
        </p>
      )}
      {mode === "forgot-code" && (
        <p className="mb-3 text-left text-xs text-slate-600">
          {t("login.codeSentTo", { email })}
        </p>
      )}
      {mode === "forgot-new-password" && (
        <p className="mb-3 text-left text-xs font-semibold text-slate-600">
          {t("login.setNewPasswordTitle")}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-3 text-left">
        {mode === "signup" && (
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t("login.displayNamePlaceholder")}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        )}

        {(mode === "login" || mode === "signup" || mode === "forgot") && (
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("login.emailPlaceholder")}
            autoComplete="email"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        )}

        {(mode === "login" || mode === "signup") && (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("login.passwordPlaceholder")}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        )}
        {mode === "signup" && (
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t("login.passwordConfirmPlaceholder")}
            autoComplete="new-password"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        )}

        {(mode === "signup-code" || mode === "forgot-code") && (
          <input
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder={t("login.codePlaceholder")}
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
              placeholder={t("login.newPasswordPlaceholder")}
              autoComplete="new-password"
              autoFocus
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t("login.newPasswordConfirmPlaceholder")}
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

        {showCaptcha && (
          <>
            <TurnstileWidget
              ref={turnstileRef}
              onVerify={(token) => {
                setTurnstileToken(token);
                if (token) setCaptchaLoadError(false);
              }}
              onError={() => setCaptchaLoadError(true)}
            />
            {captchaLoadError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                {t("error.captchaLoadFailed")}
              </p>
            )}
          </>
        )}

        <button
          type="submit"
          disabled={submitting || (submitNeedsCaptcha && !turnstileToken)}
          className="w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {submitting
            ? t("common.processing")
            : mode === "login"
              ? t("login.tabLogin")
              : mode === "signup"
                ? t("login.submitSignup")
                : mode === "signup-code" || mode === "forgot-code"
                  ? t("login.submitVerify")
                  : mode === "forgot"
                    ? t("login.submitSend")
                    : t("login.submitUpdate")}
        </button>

        {mode === "login" && (
          <button
            type="button"
            onClick={() => resetFormState("forgot")}
            className="block w-full text-center text-xs text-slate-400 hover:text-slate-600"
          >
            {t("login.forgotPassword")}
          </button>
        )}
        {mode === "signup-code" && (
          <button
            type="button"
            onClick={handleResendSignupCode}
            disabled={submitting || !turnstileToken}
            className="block w-full text-center text-xs text-slate-400 hover:text-slate-600"
          >
            {t("login.resendCode")}
          </button>
        )}
        {mode === "forgot-code" && (
          <button
            type="button"
            onClick={handleResendResetCode}
            disabled={submitting || !turnstileToken}
            className="block w-full text-center text-xs text-slate-400 hover:text-slate-600"
          >
            {t("login.resendCode")}
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
            {t("login.backToLogin")}
          </button>
        )}
      </form>
    </div>
  );
}
