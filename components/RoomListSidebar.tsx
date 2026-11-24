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
  // 段階E-5-1の見直し(2026-11-24・①A案)。押した直後、まだ移動が
  // 完了していない間だけ入る、押したカードのID(無ければnull)。
  // selectedRoomIdより優先してこちらを強調表示する。
  pendingRoomId: string | null;
  // 全カードの在室人数(components/AvatarSpace.tsxの観測専用チャンネル
  // 購読で取得。.track()は呼ばないため、見ている本人が相手に「在室中」
  // として見えることはない。2026-11-24確認)。キーはroomId。
  onlineCounts: Record<string, number>;
  // 段階E-5-1の見直し(2026-11-24・①A案)。カードを押した時に呼ぶ
  // (components/AvatarSpace.tsx側でrouter.replaceを行う)。通常の
  // 左クリックの時だけ呼び、Ctrl/Cmd/Shiftクリックや中クリックなど
  // (新しいタブで開く操作)はhrefのまま素通りさせる。
  onSelectRoom: (roomId: string) => void;
  t: (key: string, params?: Record<string, string>) => string;
};

// 入室の仕組みの作り替え 段階E-5-1(2026-11-24)。入室前の画面の左側
// (スマホでは上側)に出す、ルームの一覧。カードを押すと/?room=ルームIDへ
// 移る。段階E-5-1の見直し(2026-11-24・①A案)で、ページ全体の読み込み
// 直しではなくNext.jsの画面内の移動(router.replace、履歴を増やさない)に
// 変更した(実際の移動処理はprops.onSelectRoom経由でcomponents/
// AvatarSpace.tsx側が行う。AvatarSpace自体はkeyで確実に作り直される
// ため、LiveKit等の後片付けが必要になる入室後の画面には影響しない)。
// 事前読み込みは行わない(2026-11-24決定。人ごとに中身が違うページの
// ため、ブラウザが先読みしたものを実際の遷移で使わない可能性が高く、
// マウスを乗せるたびにサーバーの処理だけが増える恐れがあるため)。
export default function RoomListSidebar({
  result,
  selectedRoomId,
  pendingRoomId,
  onlineCounts,
  onSelectRoom,
  t,
}: Props) {
  const cards = collectRoomListCards(result);
  const highlightedRoomId = pendingRoomId ?? selectedRoomId;

  return (
    <div
      // 段階E-5-1b(2026-11-25)。入力パネル(新設のRoomJoinSidebar)が左の
      // 固定サイドバーになったため、この一覧が右の広い場所の主役になる。
      // 1440px中央寄せはこの一覧だけにかける(左のサイドバーは画面端に
      // 固定、親要素側にはmax-wを付けない)。スマホでは上(横1列)・PCでは
      // 左サイドバーより先(order-1)に表示する。
      className="order-1 flex shrink-0 gap-2 overflow-x-auto bg-slate-900 px-3 py-3 md:order-2 md:mx-auto md:w-auto md:min-h-0 md:max-w-[1440px] md:flex-1 md:flex-wrap md:content-start md:gap-3 md:overflow-x-visible md:overflow-y-auto md:p-4"
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
          selected={!!card.roomId && card.roomId === highlightedRoomId}
          onlineCount={card.roomId ? onlineCounts[card.roomId] : undefined}
          onSelectRoom={onSelectRoom}
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
  onSelectRoom,
  t,
}: {
  card: RoomListCard;
  badge?: string;
  selected: boolean;
  onlineCount?: number;
  onSelectRoom: (roomId: string) => void;
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

  const roomId = card.roomId;
  return (
    <a
      href={`/?room=${roomId}`}
      onClick={(e) => {
        // 新しいタブで開く操作(Ctrl/Cmd/Shiftクリック・中クリック等)は
        // ブラウザ標準の動作に任せ、通常の左クリックの時だけ画面内の
        // 移動に差し替える(2026-11-24・①A案)。
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        ) {
          return;
        }
        e.preventDefault();
        onSelectRoom(roomId);
      }}
      className={`block ${baseClassName} ${borderClassName}`}
    >
      {content}
    </a>
  );
}
