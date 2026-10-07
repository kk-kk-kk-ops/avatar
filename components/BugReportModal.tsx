"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  BUG_REPORT_CATEGORIES,
  BUG_REPORT_ISSUE_TYPES,
  BUG_REPORT_REPRODUCIBILITY,
} from "@/lib/types";

// 設定(歯車)メニューの「不具合報告」ボタンから開くモーダル。
// ログイン中の全ユーザー(管理者・ゲスト問わず)が送信できる。
// スクリーンショット等の添付は持たない(2026-10、ユーザー判断)。

function nowForDatetimeLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function BugReportModal({
  reporterUserId,
  reporterName,
  onClose,
}: {
  reporterUserId: string | null;
  reporterName: string;
  onClose: () => void;
}) {
  const [category, setCategory] = useState("");
  const [issueType, setIssueType] = useState("");
  const [description, setDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState(nowForDatetimeLocal);
  const [reproducibility, setReproducibility] = useState("");
  const [reproSteps, setReproSteps] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!category || !issueType || !reproducibility) {
      setError("選択式の項目をすべて選んでください");
      return;
    }
    if (!description.trim()) {
      setError("詳しい内容を入力してください");
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const occurredAtIso = (() => {
      const d = new Date(occurredAt);
      return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    })();
    const { error: insertError } = await supabase.from("bug_reports").insert({
      user_id: reporterUserId,
      reporter_name: reporterName || null,
      category,
      issue_type: issueType,
      description: description.trim(),
      occurred_at: occurredAtIso,
      reproducibility,
      repro_steps: reproSteps.trim(),
    });
    setSubmitting(false);
    if (insertError) {
      setError("送信に失敗しました。時間をおいて再度お試しください。");
      return;
    }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-xl">
          <p className="text-sm font-semibold text-slate-800">
            ご報告ありがとうございます。
            <br />
            いただいた内容は開発チームで確認し、改善に役立てます。
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-5 w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            閉じる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 text-left shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <p className="text-sm font-bold text-slate-800">不具合報告</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="shrink-0 text-lg text-slate-400 hover:text-slate-600"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">
              どの機能でおきましたか？
            </span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-slate-500"
            >
              <option value="">選択してください</option>
              {BUG_REPORT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">
              何が起きましたか？
            </span>
            <select
              value={issueType}
              onChange={(e) => setIssueType(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-slate-500"
            >
              <option value="">選択してください</option>
              {BUG_REPORT_ISSUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">
              詳しい内容
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例:「ミュート解除直後に話すと、最初の言葉が抜ける」"
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-slate-500"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">
              いつ起きた？
            </span>
            <input
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-slate-500"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">
              再現する？
            </span>
            <select
              value={reproducibility}
              onChange={(e) => setReproducibility(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-slate-500"
            >
              <option value="">選択してください</option>
              {BUG_REPORT_REPRODUCIBILITY.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">
              どうすれば起きますか？
            </span>
            <textarea
              value={reproSteps}
              onChange={(e) => setReproSteps(e.target.value)}
              placeholder="再現手順(わかる範囲で構いません)"
              rows={2}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-slate-500"
            />
          </label>
        </div>

        {error && <p className="mt-3 text-xs font-semibold text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300 disabled:opacity-60"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {submitting ? "送信中..." : "送信"}
          </button>
        </div>
      </div>
    </div>
  );
}
