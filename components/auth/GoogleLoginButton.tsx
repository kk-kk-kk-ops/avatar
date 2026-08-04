"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function GoogleLoginButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // TOPページに招待リンク(?invite=トークン)経由で来た場合、OAuthの
  // リダイレクト先にも引き継いでおく。Googleの認証画面を経由しても
  // クエリはそのまま保持されるため、/auth/callback側で招待トークンを
  // 受け取ってゲストとしてアカウントに紐付けられる。
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const callbackUrl = new URL(
        "/auth/callback",
        window.location.origin,
      );
      if (inviteToken) callbackUrl.searchParams.set("invite", inviteToken);
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callbackUrl.toString(),
        },
      });
      if (signInError) {
        setError("ログインの開始に失敗しました。時間をおいて再度お試しください。");
        setLoading(false);
      }
      // 成功時はGoogleの認証画面へリダイレクトされるため、ここでは何もしない
    } catch {
      setError("ネットワークエラーが発生しました。通信環境をご確認ください。");
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <button
        onClick={handleLogin}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-700 transition-opacity hover:bg-slate-50 disabled:opacity-60"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path
            fill="#FFC107"
            d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
          />
          <path
            fill="#FF3D00"
            d="M6.3 14.7l6.6 4.8C14.6 15.9 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4c-7.5 0-14 4.2-17.7 10.7z"
          />
          <path
            fill="#4CAF50"
            d="M24 44c5.5 0 10.4-2.1 14.1-5.6l-6.5-5.5C29.6 34.7 27 35.7 24 35.7c-5.3 0-9.7-3.4-11.3-8.1l-6.6 5.1C9.9 39.6 16.4 44 24 44z"
          />
          <path
            fill="#1976D2"
            d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.5l6.5 5.5C41.5 35.9 44 30.5 44 24c0-1.3-.1-2.7-.4-3.5z"
          />
        </svg>
        {loading ? "接続中..." : "Googleでログイン"}
      </button>
      {error && <p className="mt-2 text-center text-xs text-red-600">{error}</p>}
    </div>
  );
}
