"use client";

import { useEffect, useState } from "react";
import { BUG_REPORT_STATUSES, type BugReport, type BugReportStatus } from "@/lib/types";

// マスター画面「不具合報告」タブ。設定(歯車)メニューからユーザーが
// 送信した不具合報告を一覧(左、カテゴリをタイトルとして新しい順)+
// 詳細(右)で表示する。app/admin/AnnouncementsView.tsxと同じ
// メールクライアント的レイアウト。既読管理は項目を開いた時点で行う
// (announcement_readsと違い、マスターは1系統しかいない想定のため
// bug_reports.is_readの単純なフラグで十分)。

type Entry = BugReport & { unread: boolean };

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

// ステータスごとのタイトル背景色(薄い色で3種を見分ける)。
const STATUS_STYLES: Record<BugReportStatus, string> = {
  未対応: "bg-orange-50",
  完了: "bg-green-50",
  対応不可: "bg-slate-200",
};

function UnreadBadge({ label }: { label: string }) {
  return (
    <span
      aria-label={label}
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold leading-none text-white"
    >
      !
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-400">{label}</p>
      <p className="whitespace-pre-wrap text-sm text-slate-700">{value || "-"}</p>
    </div>
  );
}

export default function BugReportsPanel({
  bugReports,
  onReadBugReport,
  onStatusChange,
}: {
  bugReports: Entry[];
  onReadBugReport: (id: string) => void;
  onStatusChange: (id: string, status: BugReportStatus) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    bugReports[0]?.id ?? null,
  );

  // お知らせと同じく、表示直後に先頭(最新)の項目を既読にする。
  useEffect(() => {
    const first = bugReports[0];
    if (first?.unread) onReadBugReport(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    if (bugReports.find((e) => e.id === id)?.unread) {
      onReadBugReport(id);
    }
  };

  const selected = bugReports.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="h-[90vh] w-full shrink-0 space-y-2 overflow-y-auto sm:w-56">
        {bugReports.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-400">
            まだ報告はありません
          </p>
        ) : (
          bugReports.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => handleSelect(entry.id)}
              className={`flex w-full items-start justify-between gap-2 rounded-lg border p-3 text-left transition-colors ${
                STATUS_STYLES[entry.status]
              } ${
                selectedId === entry.id
                  ? "border-red-400"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-800">
                  {entry.category}
                </span>
                <span className="block text-[11px] text-slate-400">
                  {formatDateTime(entry.createdAt)}
                </span>
              </span>
              {entry.unread && <UnreadBadge label="未読" />}
            </button>
          ))
        )}
      </div>

      <div className="h-[90vh] min-w-0 flex-1 space-y-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-4">
        {selected ? (
          <>
            <div>
              <p className="text-[11px] font-semibold text-slate-400">対応状況</p>
              <select
                value={selected.status}
                onChange={(e) =>
                  onStatusChange(selected.id, e.target.value as BugReportStatus)
                }
                className="mt-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-slate-500"
              >
                {BUG_REPORT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <DetailRow label="どの機能でおきましたか？" value={selected.category} />
            <DetailRow label="何が起きましたか？" value={selected.issueType} />
            <DetailRow label="詳しい内容" value={selected.description} />
            <DetailRow
              label="いつ起きた？"
              value={formatDateTime(selected.occurredAt)}
            />
            <DetailRow label="再現する？" value={selected.reproducibility} />
            <DetailRow label="どうすれば起きますか？" value={selected.reproSteps} />
            <DetailRow
              label="報告者"
              value={selected.reporterName || "(不明)"}
            />
            <DetailRow
              label="受信日時"
              value={formatDateTime(selected.createdAt)}
            />
          </>
        ) : (
          <p className="text-xs text-slate-400">左の一覧から選択してください</p>
        )}
      </div>
    </div>
  );
}
