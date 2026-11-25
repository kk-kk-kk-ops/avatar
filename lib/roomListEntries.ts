import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRouteState } from "./authRouting";

// 入室の仕組みの作り替え 段階E-1+E-2。入室画面を「/」のカード一覧に
// 切り替えるためのデータ取得をまとめる。招待トークンなど秘密の値は
// 一切含めない(カード一覧の画面に渡すのはサムネイル・ルーム名・
// 管理者名・最終アクセス日・カードの種類だけ)。

export type RoomListCardKind = "own" | "member";

export type RoomListCard = {
  kind: RoomListCardKind;
  accountId: string;
  // 自分のアカウントはあるがrooms行が無い場合(lib/accountProvisioning.ts
  // のprovisionAccountForUserが途中〈rooms作成〉で失敗した場合など、
  // 2026-11-24確認)はnullになる。その場合はリンクしない
  // 「まだルームがありません」カードとして表示する。
  roomId: string | null;
  // 段階E-5-1c(2026-11-25)。app/page.tsxのrenderRoomJoinが入室前の
  // ルーム情報(Room型)を組み立てる際に使う(マップのデザインを決める
  // テンプレートID)。memberカードには対応する使い道が無いが、型を
  // 共通にするため同じ列を持たせる。
  templateId: string | null;
  roomName: string | null;
  previewImage: string | null;
  // 管理者名はmemberカード(list_my_room_memberships()が返す
  // owner_display_name)のみ。ownカードは自分自身のため常にnull。
  ownerDisplayName: string | null;
  // 最終アクセス日はmemberカード(account_members.last_accessed_at)
  // のみ。ownカードには対応する列が無いため常にnull。
  lastAccessedAt: string | null;
};

// 取得できた(T)・該当カード自体が無い("none")・取得に失敗した
// ("failed")の3状態。片方の取得が失敗しても他のカードは表示する
// (2026-11-24決定)ため、カードの種類ごとに独立して状態を持つ。
export type RoomListSection<T> = T | "none" | "failed";

export type RoomListResult = {
  ownCard: RoomListSection<RoomListCard>;
  memberCards: RoomListCard[] | "failed";
  // 「ルームを作成する」ボタンを出すかどうか。自分のルームが無い
  // (state.type === "no-account")人にだけ出す。
  canCreateRoom: boolean;
  // profiles.locale(無ければnull)。カード一覧画面の表示言語の決定
  // (profiles.localeが"en"ならそれを優先し、それ以外はgetServerLocale()
  // の値を使う。既存のロビー画面〈components/AvatarSpace.tsx:846-858〉の
  // 非対称なルールと合わせるため、2026-11-24追加)に使う。
  profileLocale: string | null;
};

async function fetchTemplateOverride(
  supabase: SupabaseClient,
  templateId: string | null,
): Promise<{ name?: string; previewImage?: string }> {
  if (!templateId) return {};
  const { data: template } = await supabase
    .from("templates")
    .select("name, background_image_url, thumbnail_image_url")
    .eq("id", templateId)
    .maybeSingle();
  if (!template) return {};
  return {
    name: template.name ?? undefined,
    previewImage:
      template.thumbnail_image_url ?? template.background_image_url ?? undefined,
  };
}

// 持ち主(own)の「自分の所属先アカウントのルームを1件取得する」処理
// (resolveUserRouteStateで既にaccountIdが分かっている)。管理者名は
// 自分自身のため設定しない。app/page.tsxのrenderMemberRoomJoin(段階
// E-1、持ち主が/?room=を開いた時の本人確認)からも、選び方(並び順・
// 件数)をそろえるために同じ関数を呼ぶ(2026-11-24)。
export async function fetchAccountRoomCard(
  supabase: SupabaseClient,
  accountId: string,
  kind: "own",
): Promise<RoomListCard | "failed"> {
  const { data: roomRows, error } = await supabase
    .from("rooms")
    .select("id, template_id, name, preview_image")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) return "failed";

  const room = roomRows?.[0];
  if (!room) {
    // 自分のアカウントはあるがrooms行が無い(2026-11-24確認、下記参照)。
    return {
      kind,
      accountId,
      roomId: null,
      templateId: null,
      roomName: null,
      previewImage: null,
      ownerDisplayName: null,
      lastAccessedAt: null,
    };
  }

  const override = await fetchTemplateOverride(supabase, room.template_id);
  return {
    kind,
    accountId,
    roomId: room.id,
    templateId: room.template_id,
    roomName: override.name ?? room.name,
    previewImage: override.previewImage ?? room.preview_image,
    ownerDisplayName: null,
    lastAccessedAt: null,
  };
}

async function fetchMemberCards(
  supabase: SupabaseClient,
): Promise<RoomListCard[] | "failed"> {
  const { data, error } = await supabase.rpc("list_my_room_memberships");
  if (error) return "failed";
  return (
    (data as
      | Array<{
          account_id: string;
          room_id: string;
          room_name: string;
          preview_image: string;
          owner_display_name: string;
          last_accessed_at: string;
        }>
      | null) ?? []
  ).map((row) => ({
    kind: "member" as const,
    accountId: row.account_id,
    roomId: row.room_id,
    // 段階E-5-1c(2026-11-25)。memberカードはrenderRoomJoinでの使い回しの
    // 対象外(ownカードのみ使う)のため、list_my_room_membershipsが
    // 返さないtemplateIdは常にnull。
    templateId: null,
    roomName: row.room_name,
    previewImage: row.preview_image,
    ownerDisplayName: row.owner_display_name,
    lastAccessedAt: row.last_accessed_at,
  }));
}

export async function getRoomListEntries(
  supabase: SupabaseClient,
  userId: string,
  routeState: UserRouteState,
  // 段階E-5-1c(2026-11-25)。呼び出し元(app/page.tsxのrenderMemberRoomJoin
  // の!entryブロック)が本人確認のために既にfetchAccountRoomCardを呼んで
  // いる場合、その結果をここに渡せば、同じカード(rooms・templatesへの
  // 問い合わせ)をもう一度取得しない。未指定の時は今までどおり自分で
  // 取得する。
  knownAccountRoomCard?: RoomListCard | "failed",
): Promise<RoomListResult> {
  const memberCardsPromise = fetchMemberCards(supabase);

  let ownCard: RoomListSection<RoomListCard> = "none";

  if (routeState.type === "admin") {
    ownCard =
      knownAccountRoomCard ??
      (await fetchAccountRoomCard(supabase, routeState.accountId, "own"));
  }

  const memberCardsResult = await memberCardsPromise;

  // "no-account"の場合だけ「ルームを作成する」ボタンの対象になりうる。
  // 段階E-5-1c(2026-11-25)。profiles.localeはresolveUserRouteStateが
  // 既に読んでいるため、ここでは別途読み取らずrouteState.profileを使う。
  const canCreateRoom = routeState.type === "no-account";

  return {
    ownCard,
    memberCards: memberCardsResult,
    canCreateRoom,
    profileLocale: routeState.profile.locale,
  };
}

// カード一覧を「自分のルーム→メンバーのルーム(最終アクセスの新しい
// 順)」の順にフラットな配列にする(components/RoomListScreen.tsxの
// 表示順と同じ)。段階E-5-1(2026-11-24)で、左のカード一覧(components/
// RoomListSidebar.tsx)と、「/」での先頭カード選び
// (pickFirstLinkableRoomId)の両方から使う共通の並び順。
export function collectRoomListCards(result: RoomListResult): RoomListCard[] {
  const cards: RoomListCard[] = [];
  if (result.ownCard !== "none" && result.ownCard !== "failed") {
    cards.push(result.ownCard);
  }
  if (result.memberCards !== "failed") {
    cards.push(...result.memberCards);
  }
  return cards;
}

// 段階E-5-1(2026-11-24)。「/」(招待・?room=のいずれも無い通常アクセス)
// で最初に選ぶ(=/?room=へ移す)カードのroomIdを決める。リンクできる
// (roomIdがある)カードが1枚も無い場合はnullを返す(呼び出し元は
// redirectせず、その場でカード一覧を出す)。
export function pickFirstLinkableRoomId(result: RoomListResult): string | null {
  const card = collectRoomListCards(result).find((c) => c.roomId);
  return card?.roomId ?? null;
}

// 日本標準時(Asia/Tokyo)は夏時間が無く常にUTC+9固定のため、Intl API等を
// 使わずシンプルな固定オフセット計算で求める(lib/dailyUsage.tsの
// getJstDayKeyと同じ考え方)。サーバーのローカルタイムゾーン(Vercelの
// 既定はUTCの見込み、未検証)に依存させないため、オフセットを足した後は
// UTC表記のメソッド(getUTCMonth/getUTCDate)を使う。段階E-5-1
// (2026-11-24)でcomponents/RoomListScreen.tsxから移動し、新設の
// components/RoomListSidebar.tsxとも共有できるようにした。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function formatLastAccessedDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const jst = new Date(d.getTime() + JST_OFFSET_MS);
    return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
  } catch {
    return iso;
  }
}
