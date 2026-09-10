import type { Announcement, UpdateLog } from "@/lib/types";

// マスター画面「お知らせ」タブ(app/master/AnnouncementsPanel.tsx)で
// マスターが入力した内容を、管理者(role='admin')側では閲覧専用で表示する。
// 追加・編集・削除の操作は一切持たせない(ボタン自体を置かない)。
// クリック等のインタラクションが無いため、サーバーコンポーネントのまま
// ("use client"は付けない)。

type Entry = {
  id: string;
  primary: string; // お知らせ: title / アップデート情報: version
  body: string;
  date: string; // ISO文字列
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function ReadOnlyEntryList({
  sectionTitle,
  entries,
}: {
  sectionTitle: string;
  entries: Entry[];
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-2 text-xs font-semibold text-slate-500">{sectionTitle}</p>
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AnnouncementsView({
  announcements,
  updateLogs,
}: {
  announcements: Announcement[];
  updateLogs: UpdateLog[];
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <ReadOnlyEntryList
        sectionTitle="お知らせ"
        entries={announcements.map((a) => ({
          id: a.id,
          primary: a.title,
          body: a.body,
          date: a.publishedAt,
        }))}
      />

      <ReadOnlyEntryList
        sectionTitle="アップデート情報"
        entries={updateLogs.map((u) => ({
          id: u.id,
          primary: u.version,
          body: u.body,
          date: u.releasedAt,
        }))}
      />
    </div>
  );
}
