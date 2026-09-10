"use client";

import { useState, useTransition } from "react";
import type { Announcement, UpdateLog } from "@/lib/types";
import {
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  createUpdateLog,
  updateUpdateLog,
  deleteUpdateLog,
} from "./announcementActions";

type ActionResult = { ok: true } | { ok: false; error: string };

// お知らせ・アップデート情報はどちらも「タイトル(またはバージョン)・本文・
// 日付」の3項目を持つCRUDリストという同じ構造のため、フィールドラベルと
// Server Actionを差し替えるだけの共通コンポーネント(EntryListSection)を
// 1つ用意し、下のAnnouncementsPanelで2回使い回す。
type Entry = {
  id: string;
  primary: string; // お知らせ: title / アップデート情報: version
  body: string;
  date: string; // ISO文字列
};

function toDateInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function todayInputValue(): string {
  return toDateInputValue(new Date().toISOString());
}

function EntryListSection({
  sectionTitle,
  primaryLabel,
  bodyLabel,
  dateLabel,
  entries,
  onCreate,
  onUpdate,
  onDelete,
}: {
  sectionTitle: string;
  primaryLabel: string;
  bodyLabel: string;
  dateLabel: string;
  entries: Entry[];
  onCreate: (primary: string, body: string, date: string) => Promise<ActionResult>;
  onUpdate: (
    id: string,
    primary: string,
    body: string,
    date: string,
  ) => Promise<ActionResult>;
  onDelete: (id: string) => Promise<ActionResult>;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [primaryInput, setPrimaryInput] = useState("");
  const [bodyInput, setBodyInput] = useState("");
  const [dateInput, setDateInput] = useState(todayInputValue());
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const resetForm = () => {
    setAdding(false);
    setEditingId(null);
    setPrimaryInput("");
    setBodyInput("");
    setDateInput(todayInputValue());
    setError(null);
  };

  const startAdd = () => {
    resetForm();
    setAdding(true);
  };

  const startEdit = (entry: Entry) => {
    setAdding(false);
    setEditingId(entry.id);
    setPrimaryInput(entry.primary);
    setBodyInput(entry.body);
    setDateInput(toDateInputValue(entry.date));
    setError(null);
  };

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      const result = editingId
        ? await onUpdate(editingId, primaryInput, bodyInput, dateInput)
        : await onCreate(primaryInput, bodyInput, dateInput);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      resetForm();
    });
  };

  const handleDelete = (id: string) => {
    setError(null);
    startTransition(async () => {
      const result = await onDelete(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDeleteTargetId(null);
    });
  };

  const formOpen = adding || editingId !== null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500">{sectionTitle}</p>
        {!formOpen && (
          <button
            onClick={startAdd}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          >
            + 新規追加
          </button>
        )}
      </div>

      {formOpen && (
        <div className="mb-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">
              {primaryLabel}
            </label>
            <input
              value={primaryInput}
              onChange={(e) => setPrimaryInput(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">
              {dateLabel}
            </label>
            <input
              type="date"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">
              {bodyLabel}
            </label>
            <textarea
              value={bodyInput}
              onChange={(e) => setBodyInput(e.target.value)}
              rows={4}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500"
            />
          </div>
          {error && (
            <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={pending}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {pending ? "保存中..." : editingId ? "更新する" : "登録する"}
            </button>
            <button
              onClick={resetForm}
              disabled={pending}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-400">
          まだ登録されていません
        </p>
      ) : (
        <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-lg border border-slate-200 bg-white p-3"
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">
                  {entry.primary}
                </p>
                <span className="shrink-0 text-[11px] text-slate-400">
                  {formatDate(entry.date)}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-xs text-slate-600">
                {entry.body}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => startEdit(entry)}
                  className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                >
                  編集
                </button>
                <button
                  onClick={() => setDeleteTargetId(entry.id)}
                  className="rounded border border-red-300 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {deleteTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <p className="text-sm font-bold text-slate-800">削除しますか?</p>
            <p className="mt-2 text-sm text-slate-600">
              この操作は取り消せません。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => handleDelete(deleteTargetId)}
                disabled={pending}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-60"
              >
                {pending ? "削除中..." : "削除"}
              </button>
              <button
                onClick={() => setDeleteTargetId(null)}
                disabled={pending}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AnnouncementsPanel({
  announcements,
  updateLogs,
}: {
  announcements: Announcement[];
  updateLogs: UpdateLog[];
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <EntryListSection
        sectionTitle="お知らせ"
        primaryLabel="タイトル"
        bodyLabel="本文"
        dateLabel="公開日"
        entries={announcements.map((a) => ({
          id: a.id,
          primary: a.title,
          body: a.body,
          date: a.publishedAt,
        }))}
        onCreate={createAnnouncement}
        onUpdate={updateAnnouncement}
        onDelete={deleteAnnouncement}
      />

      <EntryListSection
        sectionTitle="アップデート情報"
        primaryLabel="バージョン番号(例: v2.3.1)"
        bodyLabel="変更内容"
        dateLabel="リリース日"
        entries={updateLogs.map((u) => ({
          id: u.id,
          primary: u.version,
          body: u.body,
          date: u.releasedAt,
        }))}
        onCreate={createUpdateLog}
        onUpdate={updateUpdateLog}
        onDelete={deleteUpdateLog}
      />
    </div>
  );
}
