// 最小限のi18n基盤(2026-10 導入)。今のところログイン画面・招待画面のみが
// 対象で、アプリ本体(AvatarSpace.tsx等)はまだ日本語固定のまま。対象範囲を
// 広げる際はここに辞書を追加していく。

export type Locale = "ja" | "en";

export const LOCALE_COOKIE_NAME = "globy_locale";

const ja: Record<string, string> = {
  "common.or": "または",
  "common.processing": "処理中...",
  "common.networkError":
    "ネットワークエラーが発生しました。通信環境をご確認ください。",

  "login.tabLogin": "ログイン",
  "login.tabSignup": "新規登録",
  "login.pleaseLogin": "ログインしてください",
  "login.invitedBy": "{name}さんからの招待",
  "login.joinAsGuest": "招待されたルームにゲストとして参加します",
  "login.codeSentTo":
    "{email} 宛に確認コードを送信しました。メールに記載の確認コードを入力してください。",
  "login.resetPasswordTitle": "パスワード再設定",
  "login.setNewPasswordTitle": "新しいパスワードを設定",
  "login.displayNamePlaceholder": "表示名(任意)",
  "login.emailPlaceholder": "メールアドレス",
  "login.passwordPlaceholder": "パスワード",
  "login.passwordConfirmPlaceholder": "パスワード(確認用)",
  "login.codePlaceholder": "確認コード",
  "login.newPasswordPlaceholder": "新しいパスワード",
  "login.newPasswordConfirmPlaceholder": "新しいパスワード(確認用)",
  "login.submitSignup": "登録する",
  "login.submitVerify": "確認する",
  "login.submitSend": "送信する",
  "login.submitUpdate": "更新する",
  "login.forgotPassword": "パスワードをお忘れですか?",
  "login.resendCode": "コードが届かない場合は再送信",
  "login.backToLogin": "ログインに戻る",
  "login.logoAlt": "ロゴ",

  "error.emailPasswordRequired": "メールアドレスとパスワードを入力してください。",
  "error.passwordTooShort": "パスワードは6文字以上で入力してください。",
  "error.passwordMismatch": "パスワードが一致しません。",
  "error.alreadyRegistered":
    "このメールアドレスは既に登録済みです。ログインをお試しいただくか、パスワードをお忘れの場合は再設定してください。",
  "error.signupFailed":
    "登録に失敗しました。入力内容をご確認のうえ、時間をおいて再度お試しください。",
  "error.codeRequired": "確認コードを入力してください。",
  "error.codeInvalid":
    "コードが正しくないか、有効期限が切れています。再送信してもう一度お試しください。",
  "error.resendFailed": "再送信に失敗しました。時間をおいて再度お試しください。",
  "success.codeResent": "確認コードを再送信しました。",
  "error.emailRequired": "メールアドレスを入力してください。",
  "error.sendFailed": "送信に失敗しました。時間をおいて再度お試しください。",
  "error.updateFailed": "更新に失敗しました。時間をおいて再度お試しください。",
  "success.passwordUpdated": "パスワードを更新しました。",
  "error.googleLoginFailed":
    "ログインの開始に失敗しました。時間をおいて再度お試しください。",
  "error.loginTooManyAttempts":
    "ログイン試行回数が多いため、しばらく時間をおいてから再度お試しください。",
  "error.loginInvalidCredentials": "メールアドレスまたはパスワードが正しくありません。",

  "google.connecting": "接続中...",
  "google.signIn": "Googleでログイン",

  "authError.cancelled": "ログインがキャンセルされました。",
  "authError.auth_failed": "ログインに失敗しました。もう一度お試しください。",
  "authError.session_expired":
    "セッションの有効期限が切れました。もう一度ログインしてください。",
  "authError.network":
    "ネットワークエラーが発生しました。通信環境をご確認のうえ、再度お試しください。",
  "authError.invalid_invite":
    "招待リンクが無効です。招待した管理者に再発行を依頼してください。",
  "authError.session_superseded":
    "別の場所でログインされたため、このセッションは終了しました。",

  "lang.buttonLabel": "言語/Language",
  "lang.japanese": "Japanese",
  "lang.english": "English",

  "lobby.noRoomYet": "まだルームがありません。管理画面からルームを作成してください。",
  "lobby.onlineCount": "{count}/{max}名",
  "lobby.selectAvatarPrompt":
    "アバターを選んで、表示する名前を入力してください(空欄の場合はゲスト表示になります)",
  "lobby.maintenanceNotice": "【メンテナンスのお知らせ】",
  "lobby.maintenancePeriod": "期間:",
  "lobby.namePlaceholder": "例:みく",
  "lobby.maintenanceInProgress": "メンテナンス中",
  "lobby.checking": "確認中...",
  "lobby.enterRoom": "入室",
  "lobby.goToAdmin": "管理画面へ",
};

const en: Record<string, string> = {
  "common.or": "or",
  "common.processing": "Processing...",
  "common.networkError":
    "A network error occurred. Please check your connection.",

  "login.tabLogin": "Log in",
  "login.tabSignup": "Sign up",
  "login.pleaseLogin": "Please log in",
  "login.invitedBy": "Invited by {name}",
  "login.joinAsGuest": "You'll join the invited room as a guest",
  "login.codeSentTo":
    "We sent a verification code to {email}. Please enter the code from the email.",
  "login.resetPasswordTitle": "Reset password",
  "login.setNewPasswordTitle": "Set a new password",
  "login.displayNamePlaceholder": "Display name (optional)",
  "login.emailPlaceholder": "Email address",
  "login.passwordPlaceholder": "Password",
  "login.passwordConfirmPlaceholder": "Confirm password",
  "login.codePlaceholder": "Verification code",
  "login.newPasswordPlaceholder": "New password",
  "login.newPasswordConfirmPlaceholder": "Confirm new password",
  "login.submitSignup": "Sign up",
  "login.submitVerify": "Verify",
  "login.submitSend": "Send",
  "login.submitUpdate": "Update",
  "login.forgotPassword": "Forgot your password?",
  "login.resendCode": "Didn't get the code? Resend",
  "login.backToLogin": "Back to login",
  "login.logoAlt": "Logo",

  "error.emailPasswordRequired": "Please enter your email address and password.",
  "error.passwordTooShort": "Password must be at least 6 characters.",
  "error.passwordMismatch": "Passwords do not match.",
  "error.alreadyRegistered":
    "This email address is already registered. Please log in, or reset your password if you've forgotten it.",
  "error.signupFailed":
    "Sign-up failed. Please check your details and try again later.",
  "error.codeRequired": "Please enter the verification code.",
  "error.codeInvalid":
    "The code is incorrect or has expired. Please resend and try again.",
  "error.resendFailed": "Failed to resend. Please try again later.",
  "success.codeResent": "The verification code has been resent.",
  "error.emailRequired": "Please enter your email address.",
  "error.sendFailed": "Failed to send. Please try again later.",
  "error.updateFailed": "Failed to update. Please try again later.",
  "success.passwordUpdated": "Your password has been updated.",
  "error.googleLoginFailed": "Failed to start login. Please try again later.",
  "error.loginTooManyAttempts":
    "Too many login attempts. Please wait a while and try again.",
  "error.loginInvalidCredentials": "Incorrect email address or password.",

  "google.connecting": "Connecting...",
  "google.signIn": "Sign in with Google",

  "authError.cancelled": "Login was cancelled.",
  "authError.auth_failed": "Login failed. Please try again.",
  "authError.session_expired": "Your session has expired. Please log in again.",
  "authError.network":
    "A network error occurred. Please check your connection and try again.",
  "authError.invalid_invite":
    "This invite link is invalid. Please ask the admin who invited you to send a new one.",
  "authError.session_superseded":
    "This session has ended because you logged in elsewhere.",

  "lang.buttonLabel": "言語/Language",
  "lang.japanese": "Japanese",
  "lang.english": "English",

  "lobby.noRoomYet": "There's no room yet. Please create one from the admin screen.",
  "lobby.onlineCount": "{count}/{max}",
  "lobby.selectAvatarPrompt":
    "Choose an avatar and enter the name to display (leave it blank to join as a guest).",
  "lobby.maintenanceNotice": "[Maintenance Notice]",
  "lobby.maintenancePeriod": "Period:",
  "lobby.namePlaceholder": "e.g. Mike",
  "lobby.maintenanceInProgress": "Under maintenance",
  "lobby.checking": "Checking...",
  "lobby.enterRoom": "Enter",
  "lobby.goToAdmin": "Go to admin screen",
};

export const translations: Record<Locale, Record<string, string>> = { ja, en };

export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string>,
): string {
  let str = translations[locale]?.[key] ?? translations.ja[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${name}\\}`, "g"), value);
    }
  }
  return str;
}

// searchParams.errorの値(未知のコードを含みうる)をそのまま鍵にすると
// 未対応コード時に"authError.xxx"のような生の鍵が表示されてしまうため、
// 辞書に存在する場合だけ文言を返す専用ヘルパーにしている。
export function translateAuthError(
  locale: Locale,
  code: string | undefined,
): string | null {
  if (!code) return null;
  const key = `authError.${code}`;
  if (key in translations[locale]) return translations[locale][key];
  if (key in translations.ja) return translations.ja[key];
  return null;
}
