// ログイン画面(TOPページ・管理者ログインページ)で共通して使う
// エラーメッセージ。両方の画面が同じ/auth/callbackを経由するため、
// 表示文言もここで一元管理する。
export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  cancelled: "ログインがキャンセルされました。",
  auth_failed: "ログインに失敗しました。もう一度お試しください。",
  session_expired:
    "セッションの有効期限が切れました。もう一度ログインしてください。",
  network:
    "ネットワークエラーが発生しました。通信環境をご確認のうえ、再度お試しください。",
  invalid_invite:
    "招待リンクが無効です。招待した管理者に再発行を依頼してください。",
};
