import { translate, type Locale } from "@/lib/i18n/translations";
import {
  formatLastAccessedDate,
  type RoomListCard,
  type RoomListResult,
} from "@/lib/roomListEntries";
import LogoutButton from "@/components/auth/LogoutButton";
import GlobyHeaderBar from "@/components/GlobyHeaderBar";

type Props = {
  result: RoomListResult;
  locale: Locale;
  initialRoomJoinError?: string | null;
  initialBillingNotice?: string | null;
};

// 入室の仕組みの作り替え 段階E-1+E-2(2026-11-24)。「/」で表示する
// カード一覧画面。自分のルーム→(移行期間中のみ)古いゲストの特例カード
// →メンバーのルーム(最終アクセスの新しい順)の順で表示する。
// 段階E-5-1(2026-11-24)以降、リンクできるカードが1枚もない場合
// (ルーム0件など、app/page.tsxのpickFirstLinkableRoomIdがnullを
// 返す場合)だけ、この画面が使われる(それ以外は/?room=へ移り、
// 左にカード一覧・右に入室パネルを出す統合画面〈components/
// AvatarSpace.tsx〉になる)。
export default function RoomListScreen({
  result,
  locale,
  initialRoomJoinError,
  initialBillingNotice,
}: Props) {
  const t = (key: string, params?: Record<string, string>) =>
    translate(locale, key, params);

  const memberCards =
    result.memberCards === "failed" ? [] : result.memberCards;
  const isEmpty =
    result.ownCard === "none" &&
    result.legacyGuestCard === "none" &&
    result.memberCards !== "failed" &&
    memberCards.length === 0;

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-900">
      {/* 段階E-5-1の見直し(2026-11-24・f)。入室前の統合画面(components/
          AvatarSpace.tsx)と同じヘッダーの帯とロゴ。 */}
      <GlobyHeaderBar />
      <div className="flex w-full flex-1 flex-col items-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        {/* ユーザー要望(2026-11-25)。入室前の画面(components/
            RoomListSidebar.tsx)の見出しと同じものを、ルーム0件の画面の
            白い箱の一番上にも出す。 */}
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {t("lobby.title")}
          </h2>
          <p className="text-sm text-slate-500">{t("lobby.subtitle")}</p>
        </div>
        {initialRoomJoinError && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            {initialRoomJoinError}
          </p>
        )}
        {initialBillingNotice && (
          <p className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
            {initialBillingNotice}
          </p>
        )}

        <div className="space-y-3">
          {result.ownCard === "failed" && (
            <FailedCard label={t("roomList.loadFailed")} />
          )}
          {result.ownCard !== "none" && result.ownCard !== "failed" && (
            <RoomCardView
              card={result.ownCard}
              badge={t("roomList.yourRoomBadge")}
              t={t}
            />
          )}

          {result.legacyGuestCard === "failed" && (
            <FailedCard label={t("roomList.loadFailed")} />
          )}
          {result.legacyGuestCard !== "none" &&
            result.legacyGuestCard !== "failed" && (
              <RoomCardView card={result.legacyGuestCard} t={t} />
            )}

          {result.memberCards === "failed" ? (
            <FailedCard label={t("roomList.loadFailed")} />
          ) : (
            memberCards.map((card) => (
              <RoomCardView key={card.accountId} card={card} t={t} />
            ))
          )}
        </div>

        {isEmpty && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {t("roomList.empty")}
          </p>
        )}

        {result.canCreateRoom && (
          <a
            href="/plan"
            className="mt-4 block w-full rounded-lg bg-slate-900 py-2 text-center text-sm font-semibold text-white hover:bg-slate-700"
          >
            {t("roomList.createRoomButton")}
          </a>
        )}

        <LogoutButton className="mt-4 block w-full rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50" />
      </div>
      </div>
    </div>
  );
}

function FailedCard({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
      {label}
    </div>
  );
}

function RoomCardView({
  card,
  badge,
  t,
}: {
  card: RoomListCard;
  badge?: string;
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
        <div className="aspect-video w-full rounded-t-lg bg-slate-100" />
      )}
      <div className="px-3 py-2">
        {badge && (
          <span className="mb-1 inline-block rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {badge}
          </span>
        )}
        {card.roomId ? (
          <>
            <p className="truncate text-sm font-semibold text-slate-800">
              {card.roomName}
            </p>
            {card.ownerDisplayName && (
              <p className="truncate text-[11px] text-slate-500">
                {card.ownerDisplayName}
              </p>
            )}
            {card.lastAccessedAt && (
              <p className="text-[10px] text-slate-400">
                {t("roomList.lastAccessed", {
                  date: formatLastAccessedDate(card.lastAccessedAt),
                })}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-amber-700">{t("lobby.noRoomYet")}</p>
        )}
      </div>
    </>
  );

  if (!card.roomId) {
    return (
      <div className="block overflow-hidden rounded-lg border border-slate-200 opacity-60">
        {content}
      </div>
    );
  }

  return (
    <a
      href={`/?room=${card.roomId}`}
      className="block overflow-hidden rounded-lg border border-slate-200 hover:border-slate-400"
    >
      {content}
    </a>
  );
}
