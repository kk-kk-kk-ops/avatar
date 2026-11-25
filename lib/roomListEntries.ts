import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRouteState } from "./authRouting";

// 入室の仕組みの作り替え 段階E-1+E-2。入室画面を「/」のカード一覧に
// 切り替えるためのデータ取得をまとめる。招待トークンなど秘密の値は
// 一切含めない(カード一覧の画面に渡すのはサムネイル・ルーム名・
// 管理者名・最終アクセス日・カードの種類だけ)。

export type RoomListCardKind = "own" | "member" | "legacyGuest";

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
  // owner_display_name)のみ。own/legacyGuestカードは、自分自身
  // (own)または自分にはRLSで読み取れない相手(legacyGuest)のため
  // 常にnull(2026-11-24確認。新しいSQLは追加しない方針のため)。
  ownerDisplayName: string | null;
  // 最終アクセス日はmemberカード(account_members.last_accessed_at)
  // のみ。own/legacyGuestカードには対応する列が無いため常にnull。
  lastAccessedAt: string | null;
};

// 取得できた(T)・該当カード自体が無い("none")・取得に失敗した
// ("failed")の3状態。片方の取得が失敗しても他のカードは表示する
// (2026-11-24決定)ため、カードの種類ごとに独立して状態を持つ。
export type RoomListSection<T> = T | "none" | "failed";

export type RoomListResult = {
  ownCard: RoomListSection<RoomListCard>;
  legacyGuestCard: RoomListSection<RoomListCard>;
  memberCards: RoomListCard[] | "failed";
  // 「ルームを作成する」ボタンを出すかどうか。自分のルームが無く
  // (state.type === "no-account")、かつprofiles.roleがguestではない
  // 人にだけ出す(2026-11-24決定。古いゲストは/planで追い返されて
  // 一覧に戻るだけになるため、段階Fで移し替えが終わるまで出さない)。
  canCreateRoom: boolean;
  // profiles.locale(無ければnull)。カード一覧画面の表示言語の決定
  // (profiles.localeが"en"ならそれを優先し、それ以外はgetServerLocale()
  // の値を使う。既存のロビー画面〈components/AvatarSpace.tsx:846-858〉の
  // 非対称なルールと合わせるため、2026-11-24追加)に使う。
  profileLocale: string | null;
  // 段階E-5-2(2026-11-25)。「一覧から外す」メニューをメンバーのカードに
  // 出す時、閲覧者自身の所属アカウントID(admin/guest型のみ。no-account
  // 型はnull)と同じaccountIdのメンバーカードには出さない判定に使う
  // (古いゲストが自分の所属ルームのメンバーにもなっている場合、外すと
  // legacyGuestCardがまた出てきてしまうため)。招待トークン等の秘密の
  // 値ではないので、クライアント(components/RoomListSidebar.tsx)へ
  // そのまま渡してよい。
  ownAccountId: string | null;
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

// 持ち主(own)・移行前の古いゲスト(legacyGuest)は、どちらも
// 「自分の所属先アカウントのルームを1件取得する」という処理が同じ
// (resolveUserRouteStateで既にaccountIdが分かっている)。管理者名は、
// 自分自身(own)または自分には読み取り権限が無い相手(legacyGuest)の
// ため、どちらも設定しない。app/page.tsxのrenderMemberRoomJoin(段階
// E-1、持ち主・移行前の古いゲストが/?room=を開いた時の本人確認)からも、
// 選び方(並び順・件数)をそろえるために同じ関数を呼ぶ(2026-11-24)。
export async function fetchAccountRoomCard(
  supabase: SupabaseClient,
  accountId: string,
  kind: "own" | "legacyGuest",
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
    // 対象外(own/legacyGuestカードのみ使う)のため、list_my_room_memberships
    // が返さないtemplateIdは常にnull。
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
  // 問い合わせ)をもう一度取得しない。guest型(古いゲスト)の場合も、
  // BAN確認(get_own_account_guest_info)自体は今までどおり行い、確認が
  // 通った場合だけこの引数を使う(BAN中にlegacyGuestCardを出さない挙動は
  // 変えない)。未指定の時は今までどおり自分で取得する。
  knownAccountRoomCard?: RoomListCard | "failed",
): Promise<RoomListResult> {
  const memberCardsPromise = fetchMemberCards(supabase);

  let ownCard: RoomListSection<RoomListCard> = "none";
  let legacyGuestCard: RoomListSection<RoomListCard> = "none";

  if (routeState.type === "admin") {
    ownCard =
      knownAccountRoomCard ??
      (await fetchAccountRoomCard(supabase, routeState.accountId, "own"));
  } else if (routeState.type === "guest") {
    // 移行前の古いゲストの特例カード(段階Eの移行期間中のみ。段階Fで
    // account_membersへの移し替えが終わったら削除する)。BAN確認は
    // 既存のget_own_account_guest_info()に委ねる(BAN中・無効なら0行に
    // なるため特例カード自体を出さない。新しいSQLは追加しない方針)。
    const { data: guestInfoRows, error: guestInfoError } = await supabase.rpc(
      "get_own_account_guest_info",
    );
    if (guestInfoError) {
      legacyGuestCard = "failed";
    } else if (guestInfoRows && guestInfoRows.length > 0) {
      legacyGuestCard =
        knownAccountRoomCard ??
        (await fetchAccountRoomCard(
          supabase,
          routeState.accountId,
          "legacyGuest",
        ));
    }
  }

  const memberCardsResult = await memberCardsPromise;

  if (
    legacyGuestCard !== "none" &&
    legacyGuestCard !== "failed" &&
    memberCardsResult !== "failed"
  ) {
    // 段階E-3以降、古いゲストが自分の所属ルームの招待URLを再度開くと
    // account_membersにも行ができ、特例カードと重複する(2026-11-23
    // 調査)。重複する場合は特例カードを出さない(通常のmemberカードの
    // 方で表示される)。
    const memberAccountIds = new Set(
      memberCardsResult.map((card) => card.accountId),
    );
    if (memberAccountIds.has(legacyGuestCard.accountId)) {
      legacyGuestCard = "none";
    }
  }

  // "no-account"の場合だけ「ルームを作成する」ボタンの対象になりうる。
  // profiles.roleがguestのまま残っている場合(通常は起きないはずだが、
  // 安全のため明示的に確認する。2026-11-24指摘)は出さない。
  // 段階E-5-1c(2026-11-25)。profiles.role/localeはresolveUserRouteStateが
  // 既に読んでいるため、ここでは別途読み取らずrouteState.profileを使う。
  const canCreateRoom =
    routeState.type === "no-account" && routeState.profile.role !== "guest";

  return {
    ownCard,
    legacyGuestCard,
    memberCards: memberCardsResult,
    canCreateRoom,
    profileLocale: routeState.profile.locale,
    ownAccountId: routeState.type === "no-account" ? null : routeState.accountId,
  };
}

// カード一覧を「自分のルーム→移行前の古いゲストの特例カード→メンバーの
// ルーム(最終アクセスの新しい順)」の順にフラットな配列にする
// (components/RoomListScreen.tsxの表示順と同じ)。段階E-5-1(2026-11-24)で、
// 左のカード一覧(components/RoomListSidebar.tsx)と、「/」での先頭カード
// 選び(pickFirstLinkableRoomId)の両方から使う共通の並び順。
export function collectRoomListCards(result: RoomListResult): RoomListCard[] {
  const cards: RoomListCard[] = [];
  if (result.ownCard !== "none" && result.ownCard !== "failed") {
    cards.push(result.ownCard);
  }
  if (result.legacyGuestCard !== "none" && result.legacyGuestCard !== "failed") {
    cards.push(result.legacyGuestCard);
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
