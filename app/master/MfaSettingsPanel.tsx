"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ConfirmModal from "@/components/ConfirmModal";

// マスターアカウント向けの2段階認証(TOTP)設定パネル。任意設定
// (未設定でもログインは可能。/master/mfa-challengeでの二段階目の
// チャレンジは、検証済みのTOTPファクターを持つアカウントにのみ発生する)。
export default function MfaSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [pendingFactorId, setPendingFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showUnenrollConfirm, setShowUnenrollConfirm] = useState(false);

  const loadFactors = async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      setError("MFAの設定状況の取得に失敗しました。");
      setLoading(false);
      return;
    }
    const verified = (data?.totp ?? []).find((f) => f.status === "verified");
    setVerifiedFactorId(verified?.id ?? null);
    setLoading(false);
  };

  useEffect(() => {
    loadFactors();
  }, []);

  const startEnroll = async () => {
    setError(null);
    setSuccessMessage(null);
    setSubmitting(true);
    const supabase = createClient();

    // 前回の設定が確認コード入力前に中断された場合、未検証のファクターが
    // 残っていることがあるため、新規登録前に片付けておく
    // (Supabase側の登録上限に達するのを防ぐため)。
    const { data: existing } = await supabase.auth.mfa.listFactors();
    const unverified = (existing?.totp ?? []).filter((f) => f.status !== "verified");
    for (const factor of unverified) {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
    });
    if (enrollError || !data) {
      setError("MFAの設定を開始できませんでした。時間をおいて再度お試しください。");
      setSubmitting(false);
      return;
    }
    setPendingFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    setEnrolling(true);
    setSubmitting(false);
  };

  const cancelEnroll = async () => {
    if (pendingFactorId) {
      const supabase = createClient();
      await supabase.auth.mfa.unenroll({ factorId: pendingFactorId });
    }
    setEnrolling(false);
    setPendingFactorId(null);
    setQrCode(null);
    setSecret(null);
    setVerifyCode("");
    setError(null);
  };

  const verifyEnroll = async () => {
    if (!pendingFactorId || !verifyCode.trim()) {
      setError("確認コードを入力してください。");
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId: pendingFactorId });
    if (challengeError || !challenge) {
      setError("確認コードの検証に失敗しました。時間をおいて再度お試しください。");
      setSubmitting(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: pendingFactorId,
      challengeId: challenge.id,
      code: verifyCode.trim(),
    });
    if (verifyError) {
      setError("コードが正しくありません。もう一度お試しください。");
      setSubmitting(false);
      return;
    }
    setEnrolling(false);
    setPendingFactorId(null);
    setQrCode(null);
    setSecret(null);
    setVerifyCode("");
    setSubmitting(false);
    setSuccessMessage("2段階認証を設定しました。次回ログインから確認コードの入力が必要になります。");
    await loadFactors();
  };

  const handleUnenroll = async () => {
    if (!verifiedFactorId) return;
    setSubmitting(true);
    const supabase = createClient();
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({
      factorId: verifiedFactorId,
    });
    setSubmitting(false);
    setShowUnenrollConfirm(false);
    if (unenrollError) {
      setError("解除に失敗しました。時間をおいて再度お試しください。");
      return;
    }
    setSuccessMessage("2段階認証を解除しました。");
    await loadFactors();
  };

  if (loading) {
    return <p className="text-sm text-slate-500">読み込み中...</p>;
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <p className="mb-1 text-sm font-bold text-slate-800">2段階認証(MFA)</p>
        <p className="mb-4 text-xs text-slate-500">
          マスターアカウントのログインに、認証アプリ(Google
          Authenticator・Authy等)による確認コードを追加できます。任意設定
          ですが、強く推奨します。
        </p>

        {successMessage && (
          <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {successMessage}
          </p>
        )}
        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </p>
        )}

        {!enrolling && verifiedFactorId && (
          <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-3">
            <p className="text-xs font-semibold text-emerald-700">
              ✅ 設定済みです
            </p>
            <button
              onClick={() => setShowUnenrollConfirm(true)}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              解除する
            </button>
          </div>
        )}

        {!enrolling && !verifiedFactorId && (
          <button
            onClick={startEnroll}
            disabled={submitting}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
          >
            {submitting ? "準備中..." : "設定する"}
          </button>
        )}

        {enrolling && qrCode && (
          <div className="space-y-3">
            <p className="text-xs text-slate-600">
              認証アプリでこのQRコードを読み取ってください。読み取れない場合は下のキーを手動で入力してください。
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrCode}
              alt="MFA設定用QRコード"
              className="mx-auto h-40 w-40"
            />
            {secret && (
              <p className="break-all rounded-lg bg-slate-50 px-3 py-2 text-center text-xs text-slate-600">
                {secret}
              </p>
            )}
            <input
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="認証アプリの6桁コード"
              inputMode="numeric"
              maxLength={6}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg tracking-[0.3em] outline-none focus:border-slate-500"
            />
            <div className="flex gap-2">
              <button
                onClick={cancelEnroll}
                disabled={submitting}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                キャンセル
              </button>
              <button
                onClick={verifyEnroll}
                disabled={submitting}
                className="flex-1 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
              >
                {submitting ? "確認中..." : "確認する"}
              </button>
            </div>
          </div>
        )}
      </div>

      {showUnenrollConfirm && (
        <ConfirmModal
          title="2段階認証を解除しますか?"
          message="解除すると、次回以降のログインで確認コードが不要になります。"
          confirmLabel="解除する"
          pending={submitting}
          onConfirm={handleUnenroll}
          onCancel={() => setShowUnenrollConfirm(false)}
        />
      )}
    </div>
  );
}
