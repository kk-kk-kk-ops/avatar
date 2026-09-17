"use client";

import { useEffect, useState } from "react";
import type { Announcement, UpdateLog } from "@/lib/types";

// マスター画面「お知らせ」タブ(app/master/AnnouncementsPanel.tsx)で
// マスターが入力した内容を、管理者(role='admin')側では閲覧専用で表示する。
// 追加・編集・削除の操作は一切持たせない(ボタン自体を置かない)。
// 「告知」「アップデート」の2タブ+タイトル一覧(左)・本文(右)のメール
// クライアント的なレイアウト(2026-09)。既読/未読は項目ごとに管理し、
// タブ・タイトルそれぞれにバッジを出す。実際の既読記録(永続化)は
// 呼び出し元のAdminDashboardが持つonRead*コールバック経由で行う。

type Entry = {
  id: string;
  primary: string; // お知らせ: title / アップデート情報: version
  body: string;
  date: string; // ISO文字列
  unread: boolean;
};

type Category = "announcements" | "updates";

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

function EntryPane({
  entries,
  selectedId,
  onSelect,
}: {
  entries: Entry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const selected = entries.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="w-full shrink-0 space-y-2 overflow-y-auto sm:w-56">
        {entries.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-400">
            まだ登録されていません
          </p>
        ) : (
          entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelect(entry.id)}
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

      <div className="min-h-[16rem] min-w-0 flex-1 rounded-lg border border-slate-200 bg-white p-4">
        {selected ? (
          <>
            <p className="mb-2 text-right text-xs text-slate-400">
              {formatDate(selected.date)}
            </p>
            <p className="whitespace-pre-wrap text-sm text-slate-600">
              {selected.body}
            </p>
          </>
        ) : (
          <p className="text-xs text-slate-400">左の一覧から選択してください</p>
        )}
      </div>
    </div>
  );
}

export default function AnnouncementsView({
  announcements,
  updateLogs,
  onReadAnnouncement,
  onReadUpdateLog,
}: {
  announcements: (Announcement & { unread: boolean })[];
  updateLogs: (UpdateLog & { unread: boolean })[];
  onReadAnnouncement: (id: string) => void;
  onReadUpdateLog: (id: string) => void;
}) {
  const [category, setCategory] = useState<Category>("announcements");

  const announcementEntries: Entry[] = announcements.map((a) => ({
    id: a.id,
    primary: a.title,
    body: a.body,
    date: a.publishedAt,
    unread: a.unread,
  }));
  const updateEntries: Entry[] = updateLogs.map((u) => ({
    id: u.id,
    primary: u.version,
    body: u.body,
    date: u.releasedAt,
    unread: u.unread,
  }));

  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState<
    string | null
  >(announcementEntries[0]?.id ?? null);
  const [selectedUpdateId, setSelectedUpdateId] = useState<string | null>(
    updateEntries[0]?.id ?? null,
  );

  // 表示直後、先頭(最新)の項目を開いた状態にする(メールクライアント的に
  // 「最新の1件は表示された時点で既読」という考え方)。マウント時の
  // 1回だけでよいので依存配列は空のまま。
  useEffect(() => {
    const firstAnnouncement = announcementEntries[0];
    if (firstAnnouncement?.unread) onReadAnnouncement(firstAnnouncement.id);
    const firstUpdate = updateEntries[0];
    if (firstUpdate?.unread) onReadUpdateLog(firstUpdate.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasUnreadAnnouncements = announcementEntries.some((e) => e.unread);
  const hasUnreadUpdates = updateEntries.some((e) => e.unread);

  const handleSelectAnnouncement = (id: string) => {
    setSelectedAnnouncementId(id);
    if (announcementEntries.find((e) => e.id === id)?.unread) {
      onReadAnnouncement(id);
    }
  };
  const handleSelectUpdate = (id: string) => {
    setSelectedUpdateId(id);
    if (updateEntries.find((e) => e.id === id)?.unread) {
      onReadUpdateLog(id);
    }
  };

  const tabs: { id: Category; label: string; hasUnread: boolean }[] = [
    { id: "announcements", label: "告知", hasUnread: hasUnreadAnnouncements },
    { id: "updates", label: "アップデート", hasUnread: hasUnreadUpdates },
  ];

  return (
    <div>
      <div className="mb-4 flex gap-2 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setCategory(t.id)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
              category === t.id
                ? "border-red-600 text-red-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
            {t.hasUnread && <UnreadBadge label={`未読の${t.label}があります`} />}
          </button>
        ))}
      </div>

      {category === "announcements" ? (
        <EntryPane
          entries={announcementEntries}
          selectedId={selectedAnnouncementId}
          onSelect={handleSelectAnnouncement}
        />
      ) : (
        <EntryPane
          entries={updateEntries}
          selectedId={selectedUpdateId}
          onSelect={handleSelectUpdate}
        />
      )}
    </div>
  );
}
