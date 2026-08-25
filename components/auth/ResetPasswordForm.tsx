"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// パスワード再設定リンク経由で来た場合の「新しいパスワードを入力する」
// フォーム。呼び出し元(app/auth/reset-password/page.tsx)が、この時点で
// 既にコード交換済み(=ログインセッションが確立済み)であることを保証する。
export default function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (password.length < 6) {
      setError("パスワードは6文字以上で入力してください。");
      return;
    }
    if (password !== confirmPassword) {
      setError("パスワードが一致しません。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) {
        setError("更新に失敗しました。時間をおいて再度お試しください。");
        setSubmitting(false);
        return;
      }
      setDone(true);
      setTimeout(() => {
        window.location.href = "/";
      }, 1500);
    } catch {
      setError("ネットワークエラーが発生しました。通信環境をご確認ください。");
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl">
      <h1 className="mb-2 text-lg font-bold text-slate-800">
        新しいパスワードを設定
      </h1>

      {done ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          パスワードを更新しました。まもなくトップページへ移動します。
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3 text-left">
          <p className="mb-2 text-xs text-slate-500">
            新しいパスワードを入力してください。
          </p>
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

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
          >
            {submitting ? "更新中..." : "更新する"}
          </button>
        </form>
      )}
    </div>
  );
}
