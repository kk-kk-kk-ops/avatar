"use client";

import {
  collectRoomListCards,
  formatLastAccessedDate,
  type RoomListCard,
  type RoomListResult,
} from "@/lib/roomListEntries";

type Props = {
  result: RoomListResult;
  // 現在/?room=で選んでいるルームのID(無ければnull。「まだルームが
  // ありません」カードなど、roomIdを持たないカードは選べない)。
  selectedRoomId: string | null;
  // 全カードの在室人数(components/AvatarSpace.tsxの観測専用チャンネル
  // 購読で取得。.track()は呼ばないため、見ている本人が相手に「在室中」
  // として見えることはない。2026-11-24確認)。キーはroomId。
  onlineCounts: Record<string, number>;
  t: (key: string, params?: Record<string, string>) => string;
};

// 入室の仕組みの作り替え 段階E-5-1(2026-11-24)。入室前の画面の左側
// (スマホでは上側)に出す、ルームの一覧。カードを押すと/?room=ルームID
// への通常のページ移動(ページ全体の読み込み直し)になる(AvatarSpaceの
// 確実な再マウント・LiveKit等の後片付けのため、Next.jsのクライアント側
// ルーターへの切り替えはしない。components/auth/LogoutButton.tsx等の
// 既存のwindow.location遷移と同じ考え方)。事前読み込みは行わない
// (2026-11-24決定。人ごとに中身が違うページのため、ブラウザが先読みした
// ものを実際の遷移で使わない可能性が高く、マウスを乗せるたびにサーバーの
// 処理だけが増える恐れがあるため。待ち時間が気になれば本番確認の後で
// 改めて検討する)。
export default function RoomListSidebar({
  result,
  selectedRoomId,
  onlineCounts,
  t,
}: Props) {
  const cards = collectRoomListCards(result);

  return (
    <div
      className="flex shrink-0 gap-2 overflow-x-auto bg-slate-900 px-3 py-3 md:w-auto md:min-h-0 md:flex-1 md:flex-wrap md:content-start md:gap-3 md:overflow-x-visible md:overflow-y-auto md:p-4"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      {result.ownCard === "failed" && (
        <FailedCard label={t("roomList.loadFailed")} />
      )}
      {result.legacyGuestCard === "failed" && (
        <FailedCard label={t("roomList.loadFailed")} />
      )}
      {result.memberCards === "failed" && (
        <FailedCard label={t("roomList.loadFailed")} />
      )}
      {cards.map((card) => (
        <RoomCardTile
          key={`${card.kind}-${card.accountId}`}
          card={card}
          badge={card.kind === "own" ? t("roomList.yourRoomBadge") : undefined}
          selected={!!card.roomId && card.roomId === selectedRoomId}
          onlineCount={card.roomId ? onlineCounts[card.roomId] : undefined}
          t={t}
        />
      ))}
    </div>
  );
}

function FailedCard({ label }: { label: string }) {
  return (
    <div className="w-40 shrink-0 rounded-lg border border-dashed border-slate-600 bg-slate-800 px-2 py-3 text-center text-[10px] text-slate-400 md:w-56">
      {label}
    </div>
  );
}

function RoomCardTile({
  card,
  badge,
  selected,
  onlineCount,
  t,
}: {
  card: RoomListCard;
  badge?: string;
  selected: boolean;
  onlineCount?: number;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const content = (
    <>
      {card.roomId && card.previewImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={card.previewImage}
          alt={card.roomName ?? ""}
          className="aspect-video w-full rounded-t-lg object-cover"
        />
      ) : (
        <div className="aspect-video w-full rounded-t-lg bg-slate-700" />
      )}
      <div className="px-2 py-1.5">
        {badge && (
          <span className="mb-1 inline-block rounded bg-white px-1.5 py-0.5 text-[9px] font-semibold text-slate-900">
            {badge}
          </span>
        )}
        {card.roomId ? (
          <>
            <div className="flex items-center justify-between gap-1">
              <p className="truncate text-xs font-semibold text-white">
                {card.roomName}
              </p>
              {onlineCount !== undefined && (
                <span className="shrink-0 text-[9px] font-semibold text-slate-400">
                  {onlineCount}
                </span>
              )}
            </div>
            {card.ownerDisplayName && (
              <p className="truncate text-[10px] text-slate-300">
                {card.ownerDisplayName}
              </p>
            )}
            {card.lastAccessedAt && (
              <p className="text-[9px] text-slate-500">
                {t("roomList.lastAccessed", {
                  date: formatLastAccessedDate(card.lastAccessedAt),
                })}
              </p>
            )}
          </>
        ) : (
          <p className="text-[10px] text-amber-400">{t("lobby.noRoomYet")}</p>
        )}
      </div>
    </>
  );

  const baseClassName =
    "w-40 shrink-0 overflow-hidden rounded-lg border bg-slate-800 md:w-56";
  const borderClassName = selected
    ? "border-white shadow-[0_0_0_2px_rgba(255,255,255,0.5)]"
    : "border-slate-700 hover:border-slate-400";

  if (!card.roomId) {
    return (
      <div className={`${baseClassName} ${borderClassName} opacity-60`}>
        {content}
      </div>
    );
  }

  return (
    <a
      href={`/?room=${card.roomId}`}
      className={`block ${baseClassName} ${borderClassName}`}
    >
      {content}
    </a>
  );
}
