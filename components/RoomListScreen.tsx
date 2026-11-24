import { translate, type Locale } from "@/lib/i18n/translations";
import type { RoomListCard, RoomListResult } from "@/lib/roomListEntries";
import LogoutButton from "@/components/auth/LogoutButton";

type Props = {
  result: RoomListResult;
  locale: Locale;
  initialRoomJoinError?: string | null;
  initialBillingNotice?: string | null;
};

// 入室の仕組みの作り替え 段階E-1+E-2(2026-11-24)。「/」で表示する
// カード一覧画面。自分のルーム→メンバーのルーム(最終アクセスの新しい
// 順)→(移行期間中のみ)古いゲストの特例カードの順で表示する。カードを
// 押すと/?room=ルームIDへ遷移する(持ち主・メンバー・古いゲストの
// いずれでも、app/page.tsxのrenderMemberRoomJoinが本人の所属先かどうか
// を判定する)。「一覧から外す」操作は段階E-3で実装する(今回はカードの
// 表示のみ)。
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
    <div className="flex min-h-screen w-full flex-col items-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
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
  );
}

function FailedCard({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
      {label}
    </div>
  );
}

// 日本標準時(Asia/Tokyo)は夏時間が無く常にUTC+9固定のため、Intl API等を
// 使わずシンプルな固定オフセット計算で求める(lib/dailyUsage.tsの
// getJstDayKeyと同じ考え方)。サーバーのローカルタイムゾーン(Vercelの
// 既定はUTCの見込み、未検証)に依存させないため、オフセットを足した後は
// UTC表記のメソッド(getUTCMonth/getUTCDate)を使う(2026-11-24修正。
// 以前はgetMonth/getDateを使っており、日本時間0〜9時だと前日の日付に
// なっていた)。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function formatLastAccessedDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const jst = new Date(d.getTime() + JST_OFFSET_MS);
    return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
  } catch {
    return iso;
  }
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
