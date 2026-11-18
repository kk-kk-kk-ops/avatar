"use client";

import { useEffect, useState } from "react";
import type { Announcement } from "@/lib/types";
import { useLocale } from "@/lib/i18n/LocaleContext";
import {
  getAdminAnnouncements,
  markAnnouncementReadFromModal,
} from "@/app/admin/actions";

// 管理画面モーダル化 M-5(2026-11)。会議室画面から開く、お知らせ
// (announcements。マスター画面「お知らせ」タブで入力したもの)の一覧・
// 本文の表示・既読操作のみを載せる(作成・編集・削除はマスター画面の
// ままで、このモーダルには載せない)。app/admin/以下のファイル
// (AnnouncementsView.tsx等)は一切importせず、表示に必要な分はこの
// ファイル内で完結させる(/adminは将来削除するため)。
// 会議室内の音声ブロードキャスト機能「全体アナウンス」
// (components/AnnouncementButton.tsx・announcement.*の文言キー)とは
// 別物のため、名前・文言キーを混ぜない。
// このコンポーネント自身はSupabaseのRealtimeチャンネルを一切購読しない
// (読み取り・既読操作はすべてapp/admin/actions.tsのServer Action経由)。
// 表示内容・並び順・未読の判定は、app/admin/page.tsx・
// app/admin/AnnouncementsView.tsxと同じにする(予約投稿の扱いを含め、
// 今までと違う動きにしない)。

type Entry = {
  id: string;
  primary: string;
  body: string;
  date: string;
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

export default function AdminAnnouncementsModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const { t, locale } = useLocale();

  const [announcements, setAnnouncements] = useState<
    (Announcement & { unread: boolean })[]
  >([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 表示直後、先頭(最新)の項目を開いた状態にし既読化する
  // (app/admin/AnnouncementsView.tsxと同じ「メールクライアント的」な
  // 考え方)。データ取得が非同期のため、fetch完了後のthen内で行う。
  useEffect(() => {
    let cancelled = false;
    getAdminAnnouncements(locale).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      setAnnouncements(result.announcements);
      const first = result.announcements[0];
      setSelectedId(first?.id ?? null);
      if (first?.unread) {
        markAnnouncementReadFromModal(first.id, locale).then((readResult) => {
          if (cancelled || !readResult.ok) return;
          setAnnouncements((prev) =>
            prev.map((a) => (a.id === first.id ? { ...a, unread: false } : a)),
          );
        });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entries: Entry[] = announcements.map((a) => ({
    id: a.id,
    primary: (locale === "en" && a.titleEn) || a.title,
    body: (locale === "en" && a.bodyEn) || a.body,
    date: a.publishedAt,
    unread: a.unread,
  }));

  const handleSelect = (id: string) => {
    setSelectedId(id);
    const target = announcements.find((a) => a.id === id);
    if (target?.unread) {
      markAnnouncementReadFromModal(id, locale).then((result) => {
        if (!result.ok) return;
        setAnnouncements((prev) =>
          prev.map((a) => (a.id === id ? { ...a, unread: false } : a)),
        );
      });
    }
  };

  const selected = entries.find((e) => e.id === selectedId) ?? null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">
            {t("room.announcementsModalTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>

        {loadError && <p className="mb-2 text-xs text-red-600">{loadError}</p>}

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="h-[50vh] w-full shrink-0 space-y-2 overflow-y-auto sm:w-48">
            {entries.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-400">
                {t("admin.announcementsNone")}
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
                  {entry.unread && (
                    <UnreadBadge label={t("admin.announcementUnread")} />
                  )}
                </button>
              ))
            )}
          </div>

          <div className="h-[50vh] min-w-0 flex-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-4">
            {selected ? (
              <p className="whitespace-pre-wrap text-sm text-slate-600">
                {selected.body}
              </p>
            ) : (
              <p className="text-xs text-slate-400">
                {t("admin.announcementSelectPrompt")}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
