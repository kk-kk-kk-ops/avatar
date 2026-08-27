"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import LogoutButton from "@/components/auth/LogoutButton";

// マスターアカウントの2段階目の認証コード入力画面。/master/page.tsxが
// aal2(2段階認証済み)でないマスターアカウントをここへリダイレクトする。
export default function MfaChallengeForm() {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = (data?.totp ?? []).find((f) => f.status === "verified");
      setFactorId(verified?.id ?? null);
      setLoading(false);
    })();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId || !code.trim()) {
      setError("確認コードを入力してください。");
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setError("確認に失敗しました。時間をおいて再度お試しください。");
      setSubmitting(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    if (verifyError) {
      setError("コードが正しくありません。もう一度お試しください。");
      setSubmitting(false);
      return;
    }
    window.location.href = "/master";
  };

  return (
    <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl">
      <h1 className="mb-2 text-lg font-bold text-slate-800">2段階認証</h1>
      <p className="mb-6 text-xs text-slate-500">
        認証アプリに表示されている6桁のコードを入力してください。
      </p>

      {loading ? (
        <p className="text-sm text-slate-500">読み込み中...</p>
      ) : !factorId ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          2段階認証の設定が見つかりませんでした。時間をおいて再度お試しください。
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3 text-left">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="6桁のコード"
            inputMode="numeric"
            maxLength={6}
            autoFocus
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg tracking-[0.3em] outline-none focus:border-slate-500"
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
            {submitting ? "確認中..." : "確認する"}
          </button>
        </form>
      )}

      <LogoutButton className="mt-3 block w-full rounded-lg border border-slate-300 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50" />
    </div>
  );
}
