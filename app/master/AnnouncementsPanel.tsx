"use client";

import { useState, useTransition } from "react";
import type { Announcement, MaintenanceSettings } from "@/lib/types";
import {
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from "./announcementActions";
import MaintenancePanel from "./MaintenancePanel";

type ActionResult = { ok: true } | { ok: false; error: string };

// お知らせ・アップデート情報はどちらも「タイトル(またはバージョン)・本文・
// 日付」の3項目を持つCRUDリストという同じ構造のため、フィールドラベルと
// Server Actionを差し替えるだけの共通コンポーネント(EntryListSection)を
// 1つ用意し、下のAnnouncementsPanelで2回使い回す。
// レイアウトは管理画面の閲覧専用ビュー(app/admin/AnnouncementsView.tsx)に
// 合わせたタブ+左一覧/右詳細の2ペイン構成(2026-09)。マスターはここから
// 新規追加・編集・削除もできるため、右側は「選択中の項目の詳細(+編集・
// 削除ボタン)」または「新規追加・編集フォーム」のどちらかを表示する。
type Entry = {
  id: string;
  primary: string; // お知らせ: title / アップデート情報: version
  body: string;
  date: string; // ISO文字列
};

type Category = "announcements" | "maintenance";

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
  primaryLabel,
  bodyLabel,
  dateLabel,
  entries,
  onCreate,
  onUpdate,
  onDelete,
}: {
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
  const [selectedId, setSelectedId] = useState<string | null>(
    entries[0]?.id ?? null,
  );
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
      if (selectedId === id) setSelectedId(null);
    });
  };

  const formOpen = adding || editingId !== null;
  const selected = entries.find((e) => e.id === selectedId) ?? null;

  return (
    <div>
      <div className="mb-3 flex justify-end">
        {!formOpen && (
          <button
            onClick={startAdd}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          >
            + 新規追加
          </button>
        )}
      </div>

      {/* 2026-09報告: 一覧(左)と本文(右)は横並びflexの兄弟のため、
          高さ指定が無いと一覧の項目数によって行全体の高さが決まり、
          本文エリアもそれに引きずられて伸び縮みしていた。両方を画面の
          高さいっぱい(75vh)にし、それぞれの内側だけでスクロールする
          ようにする(2026-09報告により、当初の「5項目分」目安の固定高さ
          h-80から拡大)。 */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="h-[75vh] w-full shrink-0 space-y-2 overflow-y-auto sm:w-56">
          {entries.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-400">
              まだ登録されていません
            </p>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setSelectedId(entry.id);
                  resetForm();
                }}
                className={`block w-full rounded-lg border p-3 text-left transition-colors ${
                  selectedId === entry.id && !formOpen
                    ? "border-red-300 bg-red-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span className="block truncate text-sm font-semibold text-slate-800">
                  {entry.primary}
                </span>
                <span className="block text-[11px] text-slate-400">
                  {formatDate(entry.date)}
                </span>
              </button>
            ))
          )}
        </div>

        <div
          className={`min-w-0 flex-1 rounded-lg border border-slate-200 bg-white p-4 ${
            // 表示・編集どちらも画面の高さいっぱい(75vh)まで広げる。
            // フォーム表示時はtextareaを可変(flex-1)にするためflex-col、
            // 閲覧時は単純にbox全体をスクロールさせる。
            formOpen ? "flex h-[75vh] flex-col" : "h-[75vh] overflow-y-auto"
          }`}
        >
          {formOpen ? (
            <div className="flex h-full min-h-0 flex-col gap-2">
              <div className="shrink-0">
                <label className="mb-1 block text-[11px] font-semibold text-slate-500">
                  {primaryLabel}
                </label>
                <input
                  value={primaryInput}
                  onChange={(e) => setPrimaryInput(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500"
                />
              </div>
              <div className="shrink-0">
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
              <div className="flex min-h-0 flex-1 flex-col">
                <label className="mb-1 block shrink-0 text-[11px] font-semibold text-slate-500">
                  {bodyLabel}
                </label>
                <textarea
                  value={bodyInput}
                  onChange={(e) => setBodyInput(e.target.value)}
                  className="w-full flex-1 resize-none rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500"
                />
              </div>
              {error && (
                <p className="shrink-0 rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">
                  {error}
                </p>
              )}
              <div className="flex shrink-0 gap-2">
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
          ) : selected ? (
            <>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400">
                  {formatDate(selected.date)}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => startEdit(selected)}
                    className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    編集
                  </button>
                  <button
                    onClick={() => setDeleteTargetId(selected.id)}
                    className="rounded border border-red-300 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50"
                  >
                    削除
                  </button>
                </div>
              </div>
              {error && (
                <p className="mb-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">
                  {error}
                </p>
              )}
              <p className="whitespace-pre-wrap text-sm text-slate-600">
                {selected.body}
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-400">
              左の一覧から選択、または新規追加してください
            </p>
          )}
        </div>
      </div>

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
  maintenance,
}: {
  announcements: Announcement[];
  maintenance: MaintenanceSettings;
}) {
  const [category, setCategory] = useState<Category>("announcements");

  const tabs: { id: Category; label: string }[] = [
    { id: "announcements", label: "お知らせ" },
    { id: "maintenance", label: "メンテナンス" },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex gap-2 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setCategory(t.id)}
            className={`border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
              category === t.id
                ? "border-red-600 text-red-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {category === "announcements" ? (
        <EntryListSection
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
      ) : (
        <MaintenancePanel maintenance={maintenance} />
      )}
    </div>
  );
}
