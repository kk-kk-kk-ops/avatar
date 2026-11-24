import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState, type UserRouteState } from "@/lib/authRouting";
import { joinAccountViaInvite } from "@/lib/joinAccountViaInvite";
import { getRoomListEntries, fetchAccountRoomCard } from "@/lib/roomListEntries";
import { translate, translateAuthError, type Locale } from "@/lib/i18n/translations";
import { getServerLocale } from "@/lib/i18n/getServerLocale";
import { PLANS, type AvatarMode, type PlanId, type Room } from "@/lib/types";
import LoginCard from "@/components/auth/LoginCard";
import AvatarSpaceLoader from "@/components/AvatarSpaceLoader";
import RoomListScreen from "@/components/RoomListScreen";
import LogoutButton from "@/components/auth/LogoutButton";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

// ロビー画面(入室前のプレビュー)に表示するルーム名・プレビュー画像は、
// ルーム自体のname/preview_image列(テンプレートをそのルームに紐付けた
// 時点のスナップショットの名残)ではなく、現在紐づいているルームデザイン
// (テンプレート)の最新のname/background_image_urlを表示する(2026-09報告:
// テンプレートを切り替えてもロビーの表示名だけが元のルーム名のまま
// 変わらなかったため。さらに
// 2026-09報告: テンプレート側の背景画像だけを差し替えた場合も、preview_image
// はテンプレート紐付け時点のスナップショットのままのため反映されなかった)。
// 対応するテンプレートが見つからない場合のみ、保存済みの値にフォールバック
// する。1アカウントにつきルームは常に0〜1件のため、先頭の1件だけを見れば
// 十分。
async function applyTemplateNameToRooms(
  supabase: SupabaseClient,
  rooms: Room[],
): Promise<Room[]> {
  const templateId = rooms[0]?.templateId;
  if (!templateId) return rooms;
  const { data: template } = await supabase
    .from("templates")
    .select("name, background_image_url, thumbnail_image_url")
    .eq("id", templateId)
    .maybeSingle();
  if (!template) return rooms;
  return rooms.map((r, i) =>
    i === 0
      ? {
          ...r,
          name: template.name ?? r.name,
          previewImage:
            template.thumbnail_image_url ??
            template.background_image_url ??
            r.previewImage,
        }
      : r,
  );
}

// 管理画面ダッシュボードの「強制退出」でBANされたユーザーに表示する画面。
// 管理者が解除するまで入室させない。
function BannedNotice({ logoutRedirectTo }: { logoutRedirectTo: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden bg-slate-900 px-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-8 text-center shadow-xl">
        <h1 className="mb-2 text-lg font-bold text-slate-800">
          入室できません
        </h1>
        <p className="mb-6 text-sm text-slate-500">
          管理者によってこのルームへの入室が制限されています。
          心当たりがない場合は、招待した管理者にお問い合わせください。
        </p>
        <LogoutButton
          className="w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          redirectTo={logoutRedirectTo}
        />
      </div>
    </div>
  );
}

// アカウント所有者(admin)またはゲスト(guest)として、自分の所属する
// アカウントのルームへのアバター選択・入室画面を描画する。通常のログイン後
// フロー(招待なし)、および招待URL経由(自分自身の招待URL・ゲスト参加の
// 両方)から共通で呼ばれる。
async function renderRoomJoin(
  supabase: SupabaseClient,
  user: User,
  state: UserRouteState & { type: "admin" | "guest" },
  initialRoomJoinError?: string | null,
  initialBillingNotice?: "checkout_success" | "portal_returned" | null,
) {
  const [
    { data: profile },
    { data: guestInfoRows },
    { data: roomRows },
    { data: appSettings },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, locale, avatar_mode, avatar_icon_url")
      .eq("user_id", user.id)
      .maybeSingle(),
    // accountsの直接SELECTではなく、自分のprofiles.account_idが指すアカウント
    // のplan/invite_tokenだけを返すSECURITY DEFINER関数を使う(2026-11-15、
    // 段階4)。owner_user_idに関わらず持ち主・ゲストどちらでも同じ関数で
    // 取得できる(state.accountIdもprofiles.account_idから導出されるため、
    // 結果は常に一致する)。BAN中のゲストの場合は0行になる(下のBAN確認
    // ブロックで別途BannedNoticeを返すため、この時点ではplan等が未解決でも
    // 問題ない。詳細はこの関数の直後のコメント参照)。
    supabase.rpc("get_own_account_guest_info"),
    supabase
      .from("rooms")
      .select("id, account_id, template_id, name, preview_image")
      .eq("account_id", state.accountId)
      .order("created_at", { ascending: true })
      // 全プラン共通でルーム数の上限は1つのため、常に1件のみ表示する
      // (過去のプラン仕様で複数ルームを持つアカウントが残っていても、
      // ここで1件に絞る)。
      .limit(1),
    supabase
      .from("app_settings")
      .select(
        "avatar_size_px, maintenance_enabled, maintenance_starts_at, maintenance_ends_at",
      )
      .eq("id", "default")
      .maybeSingle(),
  ]);

  const rooms: Room[] = await applyTemplateNameToRooms(
    supabase,
    (roomRows ?? []).map((r) => ({
      id: r.id,
      accountId: r.account_id,
      templateId: r.template_id,
      name: r.name,
      previewImage: r.preview_image,
    })),
  );

  const account = guestInfoRows?.[0] ?? null;
  const plan = (account?.plan as PlanId) ?? "free";

  // このルームの中では、今いるアカウントの管理者(admin)である場合だけ
  // 「管理画面へ」「マスター画面へ」を表示する。他人の招待URL経由で
  // ゲスト参加している場合、たとえ自分自身がマスター権限を持っていても
  // このルーム内では常にゲストとしてのみ振る舞う(自分の管理画面/
  // マスター画面には行けないようにする)。
  const isAccountAdmin = state.type === "admin";

  // ゲストの場合、ログアウト後は管理者用ログイン画面ではなく、この
  // アカウントの招待URL(ゲスト用ログイン画面)に戻れるようにする。
  const guestInviteToken =
    state.type === "guest" ? account?.invite_token ?? null : null;

  // 管理画面ダッシュボードから強制退出させられたゲストは、管理者が
  // 解除するまでこのアカウントのルームへ再入室できない。
  if (state.type === "guest") {
    const { data: banRow } = await supabase
      .from("banned_participants")
      .select("user_id")
      .eq("account_id", state.accountId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (banRow) {
      return (
        <BannedNotice
          logoutRedirectTo={
            guestInviteToken ? `/?invite=${guestInviteToken}` : "/login"
          }
        />
      );
    }
  }

  return (
    <AvatarSpaceLoader
      initialName={profile?.display_name ?? undefined}
      rooms={rooms}
      maxPeoplePerRoom={PLANS[plan].maxPeoplePerRoom}
      screenShareDailyMinutes={PLANS[plan].screenShareDailyMinutes}
      videoCallDailyMinutes={PLANS[plan].videoCallDailyMinutes}
      voiceCallDailyMinutes={PLANS[plan].voiceCallDailyMinutes}
      recordingEnabled={PLANS[plan].recordingEnabled}
      dailyImageBytesLimit={PLANS[plan].dailyImageBytesLimit}
      isAccountAdmin={isAccountAdmin}
      isMaster={isAccountAdmin && state.isMaster}
      guestInviteToken={guestInviteToken}
      avatarSizePx={appSettings?.avatar_size_px ?? undefined}
      maintenanceEnabled={appSettings?.maintenance_enabled ?? false}
      maintenanceStartsAt={appSettings?.maintenance_starts_at ?? null}
      maintenanceEndsAt={appSettings?.maintenance_ends_at ?? null}
      initialProfileLocale={(profile?.locale as Locale) ?? undefined}
      initialAvatarMode={(profile?.avatar_mode as AvatarMode) ?? undefined}
      initialAvatarIconUrl={profile?.avatar_icon_url ?? undefined}
      initialRoomJoinError={initialRoomJoinError ?? undefined}
      initialBillingNotice={initialBillingNotice ?? undefined}
    />
  );
}

// 既に自分自身の別アカウントを持っている人(admin/masterなど)が、他人の
// 招待URLを一時的に閲覧しているケース(viewOnly)。プロフィールは一切
// 書き換えていないため、URLのトークンから毎回対象アカウントを解決する。
async function renderViewOnlyRoomJoin(
  supabase: SupabaseClient,
  user: User,
  inviteToken: string,
) {
  const { data: viewAccountRows } = await supabase.rpc(
    "lookup_account_by_invite_token",
    { token: inviteToken },
  );
  const viewAccount = viewAccountRows?.[0];
  if (!viewAccount) return null; // トークンが無効 → 呼び出し元でフォールバック

  // 「自分のルームへ」ボタンの行き先(2026-11-18追加)。運営者(is_master)の
  // 場合、通常の"/"だとapp/page.tsx:413で/masterへ戻されてしまうため、
  // app/billing/return/page.tsx:40-54と同じ方法(自分自身の招待URL経由)で
  // ルーム入室画面へ進むようにする。運営者以外は"/"を開けば自分のルームの
  // 入室画面に進むため(resolveUserRouteStateがprofiles.account_idから
  // 自分のアカウントを解決するだけで済む)、招待トークンをクライアントに
  // 渡さない。
  const routeState = await resolveUserRouteState(supabase, user.id);
  let ownRoomHref: string | null = "/";
  if (routeState.isMaster) {
    const { data: ownAccountRows } = await supabase.rpc(
      "get_own_account_guest_info",
    );
    const ownInviteToken = ownAccountRows?.[0]?.invite_token ?? null;
    ownRoomHref = ownInviteToken ? `/?invite=${ownInviteToken}` : null;
  }

  const { data: banRow } = await supabase
    .from("banned_participants")
    .select("user_id")
    .eq("account_id", viewAccount.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (banRow) {
    return (
      <BannedNotice
        logoutRedirectTo={`/?invite=${encodeURIComponent(inviteToken)}`}
      />
    );
  }

  // rooms/accountsともに「自分自身が所属するアカウントのみ閲覧可」という
  // RLSがかかっているため、素のテーブルSELECTでは対象アカウント(自分の
  // 所属先とは別のアカウント)のルームが常に0件になってしまう。トークンの
  // 一致を検証したうえでRLSを迂回するSECURITY DEFINER関数からルーム一覧を
  // 取得する。
  const [{ data: profile }, { data: roomRows }, { data: appSettings }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, locale, avatar_mode, avatar_icon_url")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .rpc("list_rooms_by_invite_token", { token: inviteToken })
        .limit(1),
      supabase
        .from("app_settings")
        .select(
          "avatar_size_px, maintenance_enabled, maintenance_starts_at, maintenance_ends_at",
        )
        .eq("id", "default")
        .maybeSingle(),
    ]);

  const rooms: Room[] = await applyTemplateNameToRooms(
    supabase,
    (roomRows ?? []).map(
      (r: {
        id: string;
        account_id: string;
        template_id: string | null;
        name: string;
        preview_image: string;
      }) => ({
        id: r.id,
        accountId: r.account_id,
        templateId: r.template_id,
        name: r.name,
        previewImage: r.preview_image,
      }),
    ),
  );

  const plan = (viewAccount.plan as PlanId) ?? "free";

  return (
    <AvatarSpaceLoader
      initialName={profile?.display_name ?? undefined}
      rooms={rooms}
      maxPeoplePerRoom={PLANS[plan].maxPeoplePerRoom}
      screenShareDailyMinutes={PLANS[plan].screenShareDailyMinutes}
      videoCallDailyMinutes={PLANS[plan].videoCallDailyMinutes}
      voiceCallDailyMinutes={PLANS[plan].voiceCallDailyMinutes}
      recordingEnabled={PLANS[plan].recordingEnabled}
      dailyImageBytesLimit={PLANS[plan].dailyImageBytesLimit}
      isAccountAdmin={false}
      isMaster={false}
      // 自分自身は管理者用アカウントを持っているので、ログアウト後は
      // ゲスト用ログインではなく管理者用ログイン(TOPページ)に戻す。
      guestInviteToken={null}
      avatarSizePx={appSettings?.avatar_size_px ?? undefined}
      maintenanceEnabled={appSettings?.maintenance_enabled ?? false}
      maintenanceStartsAt={appSettings?.maintenance_starts_at ?? null}
      maintenanceEndsAt={appSettings?.maintenance_ends_at ?? null}
      // viewOnly(自分のアカウントを持つ人が他人の招待URLを一時閲覧中)
      // であることをLiveKitのToken発行APIに伝えるためのトークン。
      // profiles.account_idを書き換えていないため、通常のRLS経由では
      // ルームアクセスを証明できず、これが無いと音声/映像に参加できない。
      viewOnlyInviteToken={inviteToken}
      ownRoomHref={ownRoomHref}
      initialProfileLocale={(profile?.locale as Locale) ?? undefined}
      initialAvatarMode={(profile?.avatar_mode as AvatarMode) ?? undefined}
      initialAvatarIconUrl={profile?.avatar_icon_url ?? undefined}
    />
  );
}

// 入室の仕組みの作り替え 段階D-3。/?room=ルームID の入口
// (まだどこからもリンクしない)。account_membersに載っているメンバーが、
// 招待トークンを使わずに入室するための経路。
const ROOM_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function renderMemberRoomJoin(
  supabase: SupabaseClient,
  user: User,
  roomId: string,
) {
  // UUIDの形でなければDBに問い合わせずに無効な招待と同じ扱いにする。
  if (!ROOM_ID_PATTERN.test(roomId)) {
    redirect("/?error=invalid_invite");
  }

  const { data: entryRows, error: entryError } = await supabase.rpc(
    "get_member_room_entry",
    { p_room_id: roomId },
  );
  if (entryError) {
    // eslint-disable-next-line no-console
    console.error("メンバー入室時のルーム情報取得に失敗しました", entryError);
  }
  const entry = entryRows?.[0] ?? null;

  if (!entry) {
    // メンバーでない(またはBAN中・取得エラー)。段階E-1(2026-11-24)。
    // 以前はここで「rooms」への素のSELECTが1行でも返るかどうかで持ち主・
    // 移行前の古いゲストを判定し「/」へredirectしていたが、「rooms:
    // select master」のRLS(is_master(auth.uid())なら誰のルームでも
    // 読める)により、マスターが自分のものでも自分がメンバーでもない
    // 実在のルームIDを開いた場合にも真になってしまい、本人判定として
    // 使えない欠陥があった(2026-11-24調査)。resolveUserRouteStateで
    // 解決した「自分の所属先アカウント」のルームIDと、URLのroomIdが
    // 一致する場合にだけ持ち主・移行前の古いゲストとみなし、「/」への
    // redirectを経由せず直接ロビー画面(renderRoomJoin)を返す(段階Eの
    // カード一覧から/?room=で統一的にリンクできるようにするための変更。
    // 一致しない場合〈マスターが他人のルームIDを開いた場合を含む〉は、
    // 無効な招待と同じ扱いにする。運営者への挙動の変化は確認・承認済み)。
    // ルームの選び方(並び順・件数)はlib/roomListEntries.tsの
    // fetchAccountRoomCardと同じ関数を使ってそろえる(2026-11-24指摘)。
    const routeState = await resolveUserRouteState(supabase, user.id);
    if (routeState.type !== "no-account") {
      const ownCard = await fetchAccountRoomCard(
        supabase,
        routeState.accountId,
        routeState.type === "admin" ? "own" : "legacyGuest",
      );
      if (ownCard !== "failed" && ownCard.roomId === roomId) {
        return renderRoomJoin(supabase, user, routeState, null, null);
      }
    }
    redirect("/?error=invalid_invite");
  }

  // 「自分のルームへ」ボタンの行き先。renderViewOnlyRoomJoinと同じ理由・
  // 同じ処理(見ているルームの種類には依らない、閲覧者自身の情報)。
  const routeState = await resolveUserRouteState(supabase, user.id);
  let ownRoomHref: string | null = "/";
  if (routeState.isMaster) {
    const { data: ownAccountRows } = await supabase.rpc(
      "get_own_account_guest_info",
    );
    const ownInviteToken = ownAccountRows?.[0]?.invite_token ?? null;
    ownRoomHref = ownInviteToken ? `/?invite=${ownInviteToken}` : null;
  }

  const [{ data: profile }, { data: appSettings }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, locale, avatar_mode, avatar_icon_url")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("app_settings")
      .select(
        "avatar_size_px, maintenance_enabled, maintenance_starts_at, maintenance_ends_at",
      )
      .eq("id", "default")
      .maybeSingle(),
  ]);

  const rooms: Room[] = await applyTemplateNameToRooms(supabase, [
    {
      id: roomId,
      accountId: entry.account_id,
      templateId: entry.template_id,
      name: entry.room_name,
      previewImage: entry.preview_image,
    },
  ]);

  const plan = (entry.plan as PlanId) ?? "free";

  return (
    <AvatarSpaceLoader
      initialName={profile?.display_name ?? undefined}
      rooms={rooms}
      maxPeoplePerRoom={PLANS[plan].maxPeoplePerRoom}
      screenShareDailyMinutes={PLANS[plan].screenShareDailyMinutes}
      videoCallDailyMinutes={PLANS[plan].videoCallDailyMinutes}
      voiceCallDailyMinutes={PLANS[plan].voiceCallDailyMinutes}
      recordingEnabled={PLANS[plan].recordingEnabled}
      dailyImageBytesLimit={PLANS[plan].dailyImageBytesLimit}
      isAccountAdmin={false}
      isMaster={false}
      guestInviteToken={null}
      avatarSizePx={appSettings?.avatar_size_px ?? undefined}
      maintenanceEnabled={appSettings?.maintenance_enabled ?? false}
      maintenanceStartsAt={appSettings?.maintenance_starts_at ?? null}
      maintenanceEndsAt={appSettings?.maintenance_ends_at ?? null}
      isMemberEntry={true}
      ownRoomHref={ownRoomHref}
      initialProfileLocale={(profile?.locale as Locale) ?? undefined}
      initialAvatarMode={(profile?.avatar_mode as AvatarMode) ?? undefined}
      initialAvatarIconUrl={profile?.avatar_icon_url ?? undefined}
    />
  );
}

// 入室の仕組みの作り替え 段階E-2(2026-11-24)。"/"(招待URL・?room=の
// いずれも無い通常アクセス)で表示するカード一覧画面。自分のルーム・
// メンバーのルーム・(移行期間中のみ)移行前の古いゲストの特例カードを
// まとめて取得して渡す。招待トークンなど秘密の値はlib/roomListEntries.ts
// の戻り値に含まれないため、ここでも扱わない。
async function renderRoomListCard(
  supabase: SupabaseClient,
  user: User,
  state: UserRouteState,
  initialRoomJoinError: string | null,
  initialBillingNotice: "checkout_success" | "portal_returned" | null,
) {
  const result = await getRoomListEntries(supabase, user.id, state);
  // 表示言語は、既存のロビー画面(components/AvatarSpace.tsx:846-858)と
  // 同じ非対称なルールにそろえる(2026-11-24指摘)。profiles.localeが
  // "en"ならそれを優先し、それ以外はクッキー由来のgetServerLocale()の
  // 値を使う(profiles.localeが"ja"でも、クッキー側が既に"en"の場合まで
  // 強制的にjaへ戻すことはしない)。
  const locale: Locale =
    result.profileLocale === "en" ? "en" : getServerLocale();
  // billingNoticeはAvatarSpace.tsx側(renderRoomJoin経由)と同じ2種類の
  // 文言をサーバー側で先に翻訳して渡す(このカード一覧画面はクライアント
  // 側の状態を持たない単純な表示のため、initialRoomJoinErrorと同じ
  // 「既に翻訳済みの文字列を渡す」方式に統一する)。
  const translatedBillingNotice = initialBillingNotice
    ? translate(
        locale,
        initialBillingNotice === "checkout_success"
          ? "lobby.billingCheckoutSuccess"
          : "lobby.billingPortalReturned",
      )
    : null;
  return (
    <RoomListScreen
      result={result}
      locale={locale}
      initialRoomJoinError={initialRoomJoinError}
      initialBillingNotice={translatedBillingNotice}
    />
  );
}

// 招待URL(?invite=トークン)をSlack/LINEなどに貼った際のリンクプレビュー
// (OGP)に、管理画面で設定した招待者名を本文(description)として表示する
// ための動的メタデータ。タイトル・アイコンはブラウザタブ表示と統一する
// ため、招待の有無に関わらず常に「Globy」で固定する(openGraphは親
// (layout.tsx)のオブジェクトを丸ごと上書きするため、siteName・画像も
// ここで明示し直す必要がある)。招待者名が取得できない場合は何も返さず、
// layout.tsxの既定メタデータ(タイトル・説明とも「Globy」側)へ委ねる。
export async function generateMetadata({
  searchParams,
}: {
  searchParams: { invite?: string };
}): Promise<Metadata> {
  const inviteToken = searchParams.invite;
  if (!inviteToken) return {};

  const supabase = createClient();
  const { data: accountRows } = await supabase.rpc(
    "lookup_account_by_invite_token",
    { token: inviteToken },
  );
  const inviterName = accountRows?.[0]?.invite_inviter_name ?? null;
  if (!inviterName) return {};

  const title = "Globy";
  const description = `${inviterName}さんから招待されました`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: "Globy",
      images: ["/logo-icon.png"],
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: ["/logo-icon.png"],
    },
  };
}

// TOPページ(公開)。ログイン済みなら、招待URL経由・通常ログインの
// どちらでも、プラン選択/管理画面/ルーム入室画面のいずれかへ進む
// (F-2でルーム選択画面を廃止し、ここが唯一の入り口になった)。
export default async function Home({
  searchParams,
}: {
  searchParams: { error?: string; invite?: string; billing?: string; room?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const inviteToken = searchParams.invite;
  // 入室の仕組みの作り替え 段階D-3。/?room=ルームID の入口
  // (まだどこからもリンクしない)。
  const memberRoomId = searchParams.room;

  // 管理画面モーダル化 M-4(2026-11)。app/billing/return経由で戻った
  // 直後に表示する結果通知。想定外の値(無し・不正な文字列)は表示しない
  // (app/billing/return/page.tsxと同じ判定)。
  const initialBillingNotice =
    searchParams.billing === "checkout_success" ||
    searchParams.billing === "portal_returned"
      ? searchParams.billing
      : null;

  if (user) {
    // 招待URL(?invite=トークン)を開いた場合、それが自分自身の招待URLで
    // あっても他人の招待URLであっても、必ずその招待先ルームへの入室画面へ
    // 進む(F-3: 以前は自分自身の招待URLの場合だけ/masterや/adminに
    // 飛んでしまっていた不具合を修正)。既に別のルームに入室中だった場合も、
    // この画面への遷移(=AvatarSpaceの再マウント)によって古いルームの
    // LiveKit接続・presence購読は自然にクリーンアップされ、招待先の
    // ルームへ切り替わる(ログアウトはしない)。
    if (inviteToken) {
      const result = await joinAccountViaInvite(supabase, user.id, inviteToken);
      if (!result.ok) {
        if (result.error === "join_failed") {
          // eslint-disable-next-line no-console
          console.error("招待経由の参加に失敗しました", result.detail);
        }
        redirect(
          `/?error=${result.error === "invalid_invite" ? "invalid_invite" : "auth_failed"}`,
        );
      }
      if (result.viewOnly) {
        const rendered = await renderViewOnlyRoomJoin(
          supabase,
          user,
          inviteToken,
        );
        if (rendered) return rendered;
        // トークンが(直後に無効化されたなど)解決できなかった場合のみ、
        // 通常のルーティングにフォールスルーする。
      } else {
        const state = await resolveUserRouteState(supabase, user.id);
        if (state.type === "admin" || state.type === "guest") {
          return renderRoomJoin(
            supabase,
            user,
            state,
            null,
            initialBillingNotice,
          );
        }
        // no-account(通常起こらないはずの防御的フォールバック)は
        // 下の通常ルーティングに任せる。
      }
    } else if (memberRoomId) {
      // 入室の仕組みの作り替え 段階D-3。/?room=ルームID の入口
      // (まだどこからもリンクしない)。invite・roomの両方がある時は
      // 上のinviteの処理を優先する(このelse ifには入らない)。
      return renderMemberRoomJoin(supabase, user, memberRoomId);
    }

    const state = await resolveUserRouteState(supabase, user.id);
    if (state.isMaster) redirect("/master");
    // 入室の仕組みの作り替え 段階E-2(2026-11-24決定)。以前はここで
    // state.type==="no-account"の場合だけ/planへ転送し、admin/guestの
    // 場合だけrenderRoomJoinを呼んでいた。カード一覧画面の導入に合わせて、
    // no-accountも含め常にカード一覧(renderRoomListCard)を返す(自分の
    // ルームが無い人にもカード0件+「ルームを作成する」ボタンを見せる)。
    // /planへの自動転送はやめる(ボタンを押した時だけ/planへ進む。
    // app/plan/CreateRoomStart.tsx)。
    //
    // 無効化された招待URL(他人の招待URLが再発行等で無効になった後に
    // 踏んだ場合)の通知(2026-11追加)。ログイン済みの人がinvalid_invite
    // で/?error=invalid_inviteへ戻された場合、これまでは何も表示せず
    // 黙って自分自身のロビーに合流していた(無効な招待だったことが
    // 分からない不具合)。このブロック(inviteToken無し)に到達した
    // 場合、lobby.invalidInviteRejoinedの文言をカード一覧画面の初期
    // エラーとして渡す。authError.invalid_invite(未ログイン時のログイン
    // 画面用)とは文言を分ける。
    const initialRoomJoinError =
      searchParams.error === "invalid_invite"
        ? translate(getServerLocale(), "lobby.invalidInviteRejoined")
        : null;
    return renderRoomListCard(
      supabase,
      user,
      state,
      initialRoomJoinError,
      initialBillingNotice,
    );
  }

  // 未ログインかつ招待URLでもない、素のトップページへのアクセスは
  // LP(/lp)へ転送する(2026-10末)。ログイン画面はapp/login/page.tsx
  // (新規登録はapp/signup/page.tsx)に分離した。errorがある場合
  // (Googleログイン失敗等。/auth/complete参照)は転送せず、このまま
  // ログイン画面を表示してエラー内容を見せる。
  if (!inviteToken && !searchParams.error) {
    redirect("/lp");
  }

  const errorMessage = translateAuthError(getServerLocale(), searchParams.error);

  // 未ログインで招待URL経由の場合、ログイン画面に「〇〇〇さんからの招待」
  // と表示するため、招待者名だけ先に取得しておく(実際にゲストとして
  // 参加させる処理はログイン後のjoinAccountViaInviteで行う)。
  let inviterName: string | null = null;
  if (inviteToken) {
    const { data: accountRows } = await supabase.rpc(
      "lookup_account_by_invite_token",
      { token: inviteToken },
    );
    inviterName = accountRows?.[0]?.invite_inviter_name ?? null;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4">
      {/* ログインフロー統一(2026-08-24): 管理者用/ゲスト用のバッジ・
          文言出し分けを廃止し、常に同じログイン画面にする。招待URL
          経由の場合の招待者名表示だけは引き続き案内として残す。
          メール/パスワードのログイン・新規登録・パスワード再設定は
          クライアント側の対話操作が必要なためLoginCardへ切り出した。 */}
      <LoginCard
        inviteToken={inviteToken ?? null}
        inviterName={inviterName}
        errorMessage={errorMessage}
      />
    </div>
  );
}
