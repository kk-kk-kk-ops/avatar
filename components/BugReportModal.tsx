"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  BUG_REPORT_CATEGORIES,
  BUG_REPORT_ISSUE_TYPES,
  BUG_REPORT_REPRODUCIBILITY,
} from "@/lib/types";
import { useLocale } from "@/lib/i18n/LocaleContext";

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
  const { t } = useLocale();
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
      setError(t("bugReport.errorSelectAll"));
      return;
    }
    if (!description.trim()) {
      setError(t("bugReport.errorDescriptionRequired"));
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
      setError(t("bugReport.errorSubmitFailed"));
      return;
    }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-xl">
          <p className="text-sm font-semibold text-slate-800">
            {t("bugReport.thanksLine1")}
            <br />
            {t("bugReport.thanksLine2")}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-5 w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            {t("bugReport.close")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 text-left shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <p className="text-sm font-bold text-slate-800">{t("bugReport.title")}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("bugReport.close")}
            className="shrink-0 text-lg text-slate-400 hover:text-slate-600"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">
              {t("bugReport.fieldCategory")}
            </span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-slate-500"
            >
              <option value="">{t("bugReport.selectPlaceholder")}</option>
              {BUG_REPORT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">
              {t("bugReport.fieldIssueType")}
            </span>
            <select
              value={issueType}
              onChange={(e) => setIssueType(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-slate-500"
            >
              <option value="">{t("bugReport.selectPlaceholder")}</option>
              {BUG_REPORT_ISSUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">
              {t("bugReport.fieldDescription")}
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("bugReport.descriptionPlaceholder")}
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-slate-500"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">
              {t("bugReport.fieldOccurredAt")}
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
              {t("bugReport.fieldReproducibility")}
            </span>
            <select
              value={reproducibility}
              onChange={(e) => setReproducibility(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-slate-500"
            >
              <option value="">{t("bugReport.selectPlaceholder")}</option>
              {BUG_REPORT_REPRODUCIBILITY.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">
              {t("bugReport.fieldReproSteps")}
            </span>
            <textarea
              value={reproSteps}
              onChange={(e) => setReproSteps(e.target.value)}
              placeholder={t("bugReport.reproStepsPlaceholder")}
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
            {t("bugReport.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {submitting ? t("bugReport.submitting") : t("bugReport.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
