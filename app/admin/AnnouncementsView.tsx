"use client";

import { useEffect, useState } from "react";
import type { Announcement } from "@/lib/types";

// マスター画面「お知らせ」タブ(app/master/AnnouncementsPanel.tsx)で
// マスターが入力した内容を、管理者(role='admin')側では閲覧専用で表示する。
// 追加・編集・削除の操作は一切持たせない(ボタン自体を置かない)。
// タブは持たず、タイトル一覧(左)・本文(右)のみのメールクライアント的な
// レイアウト(2026-09、アップデート情報タブ廃止に伴いシンプル化)。
// 既読/未読は項目ごとに管理しタイトルにバッジを出す。実際の既読記録
// (永続化)は呼び出し元のAdminDashboardが持つonReadAnnouncement経由で行う。

type Entry = {
  id: string;
  primary: string; // タイトル
  body: string;
  date: string; // ISO文字列
  unread: boolean;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

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

export default function AnnouncementsView({
  announcements,
  onReadAnnouncement,
}: {
  announcements: (Announcement & { unread: boolean })[];
  onReadAnnouncement: (id: string) => void;
}) {
  const entries: Entry[] = announcements.map((a) => ({
    id: a.id,
    primary: a.title,
    body: a.body,
    date: a.publishedAt,
    unread: a.unread,
  }));

  const [selectedId, setSelectedId] = useState<string | null>(
    entries[0]?.id ?? null,
  );

  // 表示直後、先頭(最新)の項目を開いた状態にする(メールクライアント的に
  // 「最新の1件は表示された時点で既読」という考え方)。マウント時の
  // 1回だけでよいので依存配列は空のまま。
  useEffect(() => {
    const first = entries[0];
    if (first?.unread) onReadAnnouncement(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    if (entries.find((e) => e.id === id)?.unread) {
      onReadAnnouncement(id);
    }
  };

  const selected = entries.find((e) => e.id === selectedId) ?? null;

  return (
    // 2026-09報告: 一覧(左)と本文(右)は横並びflexの兄弟のため、高さ指定が
    // 無いと一覧の項目数によって行全体の高さが決まり、本文エリアもそれに
    // 引きずられて伸び縮みしていた。両方を画面の高さいっぱい(75vh)にし、
    // それぞれの内側だけでスクロールするようにする。
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
              onClick={() => handleSelect(entry.id)}
              className={`flex w-full items-start justify-between gap-2 rounded-lg border p-3 text-left transition-colors ${
                selectedId === entry.id
                  ? "border-red-300 bg-red-50"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-800">
                  {entry.primary}
                </span>
                <span className="block text-[11px] text-slate-400">
                  {formatDate(entry.date)}
                </span>
              </span>
              {entry.unread && <UnreadBadge label="未読" />}
            </button>
          ))
        )}
      </div>

      <div className="h-[75vh] min-w-0 flex-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-4">
        {selected ? (
          <p className="whitespace-pre-wrap text-sm text-slate-600">
            {selected.body}
          </p>
        ) : (
          <p className="text-xs text-slate-400">左の一覧から選択してください</p>
        )}
      </div>
    </div>
  );
}
