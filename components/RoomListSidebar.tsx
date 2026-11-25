"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
  const router = useRouter();
  // 段階E-5-2(2026-11-25)。「一覧から外す」(leave_account_membership)
  // 専用のSupabaseクライアント。認証済みセッションを持つブラウザ側の
  // クライアント(components/AvatarSpace.tsxと同じ生成関数)。このRPCは
  // security definerでauth.uid()を見るだけのため、ここで直接呼んでよい。
  const [supabase] = useState(() => createClient());
  const cards = collectRoomListCards(result);
  const highlightedRoomId = pendingRoomId ?? selectedRoomId;

  // 「…」メニューが開いているカード(accountIdで識別。1枚だけ開ける)。
  const [openMenuAccountId, setOpenMenuAccountId] = useState<string | null>(
    null,
  );
  // 「一覧から外す」の確認ダイアログの対象カード(無ければダイアログ非表示)。
  const [removeTarget, setRemoveTarget] = useState<RoomListCard | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const handleRequestRemove = useCallback((card: RoomListCard) => {
    setOpenMenuAccountId(null);
    setRemoveError(null);
    setRemoveTarget(card);
  }, []);

  const handleCancelRemove = useCallback(() => {
    if (removing) return;
    setRemoveTarget(null);
    setRemoveError(null);
  }, [removing]);

  const handleConfirmRemove = useCallback(async () => {
    if (!removeTarget) return;
    setRemoving(true);
    setRemoveError(null);
    const { error } = await supabase.rpc("leave_account_membership", {
      p_account_id: removeTarget.accountId,
    });
    setRemoving(false);
    if (error) {
      setRemoveError(t("roomList.removeFailed"));
      return;
    }
    const wasSelected = removeTarget.roomId === highlightedRoomId;
    setRemoveTarget(null);
    if (wasSelected) {
      // 今選んでいるルームを外した場合は"/"へ移す(残りの先頭のカードが
      // 選ばれる、既存のpickFirstLinkableRoomIdの仕組みに任せる)。
      router.replace("/");
    } else {
      // ほかのカードを外した場合は、一覧だけを読み直してそのカードを消す。
      router.refresh();
    }
  }, [removeTarget, supabase, router, highlightedRoomId, t]);

  return (
    <div
      // 段階E-5-1b(2026-11-25)。入力パネル(新設のRoomJoinSidebar)が左の
      // 固定サイドバーになったため、この一覧が右の広い場所の主役になる。
      // 1440px中央寄せはこの一覧だけにかける(左のサイドバーは画面端に
      // 固定、親要素側にはmax-wを付けない)。スマホでは上(横1列)・PCでは
      // 左サイドバーより先(order-1)に表示する。段階E-5-1b見直し
      // (2026-11-25)。左のサイドバー(暗い)と見た目をそろえず、ここは
      // 白い背景・明るいカードにする(ヘッダー・左サイドバーは暗いまま)。
      // ユーザー要望(2026-11-25)。見出し「ロビー」・説明をこのdivの
      // 直下(=カードの横スクロールの外)に置くため、縦のflex-colにし、
      // 横スクロール(overflow-x-auto)・カードのflex-wrapは下の内側のdiv
      // に移した。PC版の縦スクロール(md:overflow-y-auto)はこの外側の
      // divにかけ、見出し・カードが一緒に流れるようにする(固定しない)。
      className="order-1 flex shrink-0 flex-col bg-white md:order-2 md:mx-auto md:w-auto md:min-h-0 md:max-w-[1440px] md:flex-1 md:overflow-y-auto"
    >
      {/* ユーザー要望(2026-11-25)。右の白い場所の一番上の見出し・説明。
          左端をこの下のカードの左端にそろえるため、左右のpaddingを
          カード側(px-3/md:p-4)と同じ値にする。スマホでは余白を小さめに
          (pb-2)し、高さを取りすぎないようにする。 */}
      <div className="shrink-0 px-3 pt-3 pb-2 md:px-4 md:pt-4 md:pb-3">
        <h2 className="text-lg font-semibold text-slate-900">
          {t("lobby.title")}
        </h2>
        <p className="text-sm text-slate-500">{t("lobby.subtitle")}</p>
      </div>
      <div
        className="flex shrink-0 gap-2 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-wrap md:content-start md:gap-3 md:overflow-x-visible md:px-4 md:pb-4"
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
            badge={
              card.kind === "own" ? t("roomList.yourRoomBadge") : undefined
            }
            selected={!!card.roomId && card.roomId === highlightedRoomId}
            onlineCount={card.roomId ? onlineCounts[card.roomId] : undefined}
            onSelectRoom={onSelectRoom}
            // 段階E-5-2(2026-11-25)。「一覧から外す」はメンバーのカード
            // (kind === "member")だけに出す。自分のルーム(own)・古い
            // ゲストの特例カード(legacyGuest)には出さない。さらに、古い
            // ゲストが自分の所属ルーム(result.ownAccountId)のメンバーにも
            // なっている場合は、そのメンバーカードにも出さない(外すと
            // 特例カードがまた出てきてしまうため、段階Fまでの措置)。
            canRemove={
              card.kind === "member" && card.accountId !== result.ownAccountId
            }
            menuOpen={openMenuAccountId === card.accountId}
            onToggleMenu={() =>
              setOpenMenuAccountId((current) =>
                current === card.accountId ? null : card.accountId,
              )
            }
            onCloseMenu={() => setOpenMenuAccountId(null)}
            onRequestRemove={() => handleRequestRemove(card)}
            t={t}
          />
        ))}
      </div>

      {/* 段階E-5-2(2026-11-25)。「一覧から外す」の確認ダイアログ。見た目は
          components/AvatarSpace.tsxの既存のダイアログ(アイコン削除の確認
          など)に合わせる。 */}
      {removeTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-xs rounded-xl bg-white p-5 shadow-xl">
            <p className="mb-2 text-left text-sm font-semibold text-slate-800">
              {t("roomList.removeConfirmTitle")}
            </p>
            <p className="mb-4 text-left text-xs text-slate-500">
              {t("roomList.removeConfirmBody")}
            </p>
            {removeError && (
              <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                {removeError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCancelRemove}
                disabled={removing}
                className="flex-1 rounded-lg bg-slate-200 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmRemove}
                disabled={removing}
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {removing ? t("lobby.checking") : t("roomList.removeButton")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FailedCard({ label }: { label: string }) {
  return (
    <div className="w-40 shrink-0 rounded-lg border border-dashed border-slate-300 bg-white px-2 py-3 text-center text-[10px] text-slate-500 md:w-56">
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
  canRemove,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onRequestRemove,
  t,
}: {
  card: RoomListCard;
  badge?: string;
  selected: boolean;
  onlineCount?: number;
  onSelectRoom: (roomId: string) => void;
  canRemove: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onRequestRemove: () => void;
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
        <div className="aspect-video w-full rounded-t-lg bg-slate-200" />
      )}
      <div className="px-2 py-1.5">
        {badge && (
          <span className="mb-1 inline-block rounded bg-slate-900 px-1.5 py-0.5 text-[9px] font-semibold text-white">
            {badge}
          </span>
        )}
        {card.roomId ? (
          <>
            <div className="flex items-center justify-between gap-1">
              <p className="truncate text-xs font-semibold text-slate-900">
                {card.roomName}
              </p>
              {onlineCount !== undefined && (
                <span className="shrink-0 text-[9px] font-semibold text-slate-500">
                  {onlineCount}
                </span>
              )}
            </div>
            {card.ownerDisplayName && (
              <p className="truncate text-[10px] text-slate-500">
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
          <p className="text-[10px] text-amber-600">{t("lobby.noRoomYet")}</p>
        )}
      </div>
    </>
  );

  // 段階E-5-1b見直し(2026-11-25)。右のカード一覧は白い背景・明るい
  // カードにそろえる(左の暗いサイドバーとは別の配色にする決定事項)。
  const baseClassName =
    "w-40 shrink-0 overflow-hidden rounded-lg bg-white md:w-56";

  if (!card.roomId) {
    // 「まだルームがありません」のカード(選べない)は今までの見た目の
    // まま(2026-11-25指摘、変更対象外)。
    return (
      <div
        className={`${baseClassName} border border-slate-200 opacity-60`}
      >
        {content}
      </div>
    );
  }

  // 2026-11-25指摘・再調整。ふだんの枠は薄い灰色、選んでいる時は緑の枠
  // (border)に加えてカードの外側に緑の縁取り(ring、box-shadowで描かれ
  // カードの大きさ・位置はずれない)を足して太く見せる。選択中はホバー
  // しても見た目を変えない。
  const borderClassName = selected
    ? "border-2 border-emerald-500 ring-2 ring-emerald-500"
    : "border-2 border-slate-300 hover:border-slate-500";

  const roomId = card.roomId;
  return (
    // 段階E-5-2(2026-11-25)。「…」ボタン・メニューは<a>の中には置かない
    // (リンクの中にボタンを入れるのはHTMLの決まりに反し、押すとカードの
    // 切り替え〈onSelectRoom〉が起きてしまう恐れがあるため)。この
    // relativeな外枠の上にabsoluteで重ねる、<a>とは別の要素にする。
    <div className="relative shrink-0">
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
      {canRemove && (
        <>
          <button
            type="button"
            aria-label={t("roomList.moreOptionsAria")}
            onClick={(e) => {
              // <a>の外にあるため本来bubbleしないが、将来の構造変更に
              // 備えて明示的に止めておく(押してもカードの切り替えが
              // 起きないことを保証する)。
              e.preventDefault();
              e.stopPropagation();
              onToggleMenu();
            }}
            className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-base font-bold leading-none text-white hover:bg-black/60"
          >
            ⋯
          </button>
          {menuOpen && (
            <>
              {/* メニュー外側をクリックしたら閉じる、ただ透明な全画面の
                  クリック受け皿(2026-11-25)。 */}
              <div className="fixed inset-0 z-40" onClick={onCloseMenu} />
              <div className="absolute right-1 top-10 z-50 w-36 overflow-hidden rounded-lg bg-white text-xs text-slate-700 shadow-lg ring-1 ring-slate-200">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRequestRemove();
                  }}
                  className="block w-full px-3 py-2 text-left hover:bg-slate-100"
                >
                  {t("roomList.remove")}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
