import GoogleLoginButton from "@/components/auth/GoogleLoginButton";

const ERROR_MESSAGES: Record<string, string> = {
  cancelled: "ログインがキャンセルされました。",
  auth_failed: "ログインに失敗しました。もう一度お試しください。",
  session_expired: "セッションの有効期限が切れました。もう一度ログインしてください。",
  network: "ネットワークエラーが発生しました。通信環境をご確認のうえ、再度お試しください。",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const errorMessage = searchParams.error ? ERROR_MESSAGES[searchParams.error] : null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-8 text-center shadow-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="ロゴ" className="mx-auto mb-4 h-14 w-14 object-contain" />
        <h1 className="mb-8 text-lg font-bold text-slate-800">AI受付システム</h1>

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
