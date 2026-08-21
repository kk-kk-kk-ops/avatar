"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

// Googleログイン(/auth/callback)完了後、必ずここへ着地する。H-1対応:
// Supabaseのredirectto(クエリ文字列)がダッシュボード側の許可リスト設定
// 次第で落とされることがあり、招待URL(?invite=トークン)経由でログイン
// したのに管理者用ログイン画面(素の"/")に戻ってしまう不具合があった。
// ログイン開始前にGoogleLoginButton側でsessionStorageへ保存しておいた
// 招待トークンをここで読み出し、確実にその招待URLへ遷移させる
// (sessionStorageはブラウザ側で保持されるため、OAuthのリダイレクト経路
// に関わらず生き残る)。/auth/callback側のクエリに招待トークンが残って
// いた場合はそちらも保険として使う。
function AuthCompleteInner() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const stored = sessionStorage.getItem("pendingInviteToken");
    sessionStorage.removeItem("pendingInviteToken");
    const inviteToken = stored || searchParams.get("invite");
    // ページ全体を遷移させ、app/page.tsx(サーバーコンポーネント)に
    // 最新のCookie・URLで判定し直させる。
    window.location.replace(
      inviteToken ? `/?invite=${encodeURIComponent(inviteToken)}` : "/",
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
