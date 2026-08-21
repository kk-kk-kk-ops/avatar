"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

// Googleログイン(/auth/callback)完了後、成功・失敗どちらの場合も必ず
// ここへ着地する。H-1対応: Supabaseのredirectto(クエリ文字列)が
// ダッシュボード側の許可リスト設定次第で落とされることがあり、招待URL
// (?invite=トークン)経由でログインしたのに管理者用ログイン画面
// (素の"/")に戻ってしまう不具合があった。ログイン開始前にGoogleLoginButton
// 側でsessionStorageへ保存しておいた招待トークンをここで読み出し、
// 確実にその招待URLへ遷移させる(sessionStorageはブラウザ側で保持
// されるため、OAuthのリダイレクト経路に関わらず生き残る)。
// /auth/callback側のクエリに招待トークンが残っていた場合はそちらも
// 保険として使う。
//
// H-3: ログイン失敗時(?error=...)も同じ経路を通すことで、招待URLへ
// 戻したうえでエラー内容を表示できるようにしている
// (app/page.tsxが?errorを見て失敗メッセージを表示する)。
function AuthCompleteInner() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const stored = sessionStorage.getItem("pendingInviteToken");
    sessionStorage.removeItem("pendingInviteToken");
    const inviteToken = stored || searchParams.get("invite");
    const errorCode = searchParams.get("error");

    const destination = new URL("/", window.location.origin);
    if (inviteToken) destination.searchParams.set("invite", inviteToken);
    if (errorCode) destination.searchParams.set("error", errorCode);
    // ページ全体を遷移させ、app/page.tsx(サーバーコンポーネント)に
    // 最新のCookie・URLで判定し直させる。
    window.location.replace(
      `${destination.pathname}${destination.search}`,
    );
  }, [searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900">
      <p className="text-sm text-slate-400">ログイン処理中...</p>
    </div>
  );
}

export default function AuthCompletePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-900">
          <p className="text-sm text-slate-400">ログイン処理中...</p>
        </div>
      }
    >
      <AuthCompleteInner />
    </Suspense>
  );
}
