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
): Promise<RoomListResult> {
  const memberCardsPromise = fetchMemberCards(supabase);
  // 表示言語の判定(profiles.locale)と「ルームを作成する」ボタンの表示
  // 判定(profiles.role)は、どちらもprofilesの1行で済むため、1回だけ
  // 読み取る(2026-11-24指摘)。
  const profilePromise = supabase
    .from("profiles")
    .select("role, locale")
    .eq("user_id", userId)
    .maybeSingle();

  let ownCard: RoomListSection<RoomListCard> = "none";
  let legacyGuestCard: RoomListSection<RoomListCard> = "none";

  if (routeState.type === "admin") {
    ownCard = await fetchAccountRoomCard(supabase, routeState.accountId, "own");
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
      legacyGuestCard = await fetchAccountRoomCard(
        supabase,
        routeState.accountId,
        "legacyGuest",
      );
    }
  }

  const [memberCardsResult, { data: profileRow }] = await Promise.all([
    memberCardsPromise,
    profilePromise,
  ]);

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
  const canCreateRoom =
    routeState.type === "no-account" && profileRow?.role !== "guest";

  return {
    ownCard,
    legacyGuestCard,
    memberCards: memberCardsResult,
    canCreateRoom,
    profileLocale: profileRow?.locale ?? null,
  };
}
