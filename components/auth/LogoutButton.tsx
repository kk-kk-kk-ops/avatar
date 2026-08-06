"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  className?: string;
  // ログアウト後の遷移先。省略時はTOPページ(管理者用ログイン画面)。
  // 他人の招待URL経由で参加しているゲストの場合は、呼び出し元から
  // "/?invite=トークン"を渡すことで、ログアウト後も同じ招待URLの
  // ゲスト用ログイン画面に戻れるようにする。
  redirectTo?: string;
};

export default function LogoutButton({ className, redirectTo }: Props) {
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    // ページ全体を再読み込みしてCookie・middlewareの状態を確実にリセットする
    window.location.href = redirectTo ?? "/";
  };

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className={
        className ??
        "rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-60"
      }
    >
      {loading ? "ログアウト中..." : "ログアウト"}
    </button>
  );
}
