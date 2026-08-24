import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState, type UserRouteState } from "@/lib/authRouting";
import { joinAccountViaInvite } from "@/lib/joinAccountViaInvite";
import { AUTH_ERROR_MESSAGES } from "@/lib/authErrorMessages";
import { PLANS, type PlanId, type Room } from "@/lib/types";
import GoogleLoginButton from "@/components/auth/GoogleLoginButton";
import AvatarSpaceLoader from "@/components/AvatarSpaceLoader";
import LogoutButton from "@/components/auth/LogoutButton";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

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
) {
  const [
    { data: profile },
    { data: account },
    { data: roomRows },
    { data: appSettings },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("accounts")
      .select("plan, invite_token")
      .eq("id", state.accountId)
      .single(),
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
      .select("avatar_size_px")
      .eq("id", "default")
      .maybeSingle(),
  ]);

  const rooms: Room[] = (roomRows ?? []).map((r) => ({
    id: r.id,
    accountId: r.account_id,
    templateId: r.template_id,
    name: r.name,
    previewImage: r.preview_image,
  }));

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
            guestInviteToken ? `/?invite=${guestInviteToken}` : "/"
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
      isAccountAdmin={isAccountAdmin}
      isMaster={isAccountAdmin && state.isMaster}
      guestInviteToken={guestInviteToken}
      avatarSizePx={appSettings?.avatar_size_px ?? undefined}
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
        .select("display_name")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .rpc("list_rooms_by_invite_token", { token: inviteToken })
        .limit(1),
      supabase
        .from("app_settings")
        .select("avatar_size_px")
        .eq("id", "default")
        .maybeSingle(),
    ]);

  const rooms: Room[] = (roomRows ?? []).map(
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
      isAccountAdmin={false}
      isMaster={false}
      // 自分自身は管理者用アカウントを持っているので、ログアウト後は
      // ゲスト用ログインではなく管理者用ログイン(TOPページ)に戻す。
      guestInviteToken={null}
      avatarSizePx={appSettings?.avatar_size_px ?? undefined}
      // viewOnly(自分のアカウントを持つ人が他人の招待URLを一時閲覧中)
      // であることをLiveKitのToken発行APIに伝えるためのトークン。
      // profiles.account_idを書き換えていないため、通常のRLS経由では
      // ルームアクセスを証明できず、これが無いと音声/映像に参加できない。
      viewOnlyInviteToken={inviteToken}
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
      images: ["/logo.png"],
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: ["/logo.png"],
    },
  };
}

// TOPページ(公開)。ログイン済みなら、招待URL経由・通常ログインの
// どちらでも、プラン選択/管理画面/ルーム入室画面のいずれかへ進む
// (F-2でルーム選択画面を廃止し、ここが唯一の入り口になった)。
export default async function Home({
  searchParams,
}: {
  searchParams: { error?: string; invite?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const inviteToken = searchParams.invite;

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
          return renderRoomJoin(supabase, user, state);
        }
        // no-account(通常起こらないはずの防御的フォールバック)は
        // 下の通常ルーティングに任せる。
      }
    }

    const state = await resolveUserRouteState(supabase, user.id);
    if (state.isMaster) redirect("/master");
    if (state.type === "no-account") redirect("/plan");
    if (state.type === "admin") redirect("/admin");
    return renderRoomJoin(supabase, user, state);
  }

  const errorMessage = searchParams.error
    ? AUTH_ERROR_MESSAGES[searchParams.error]
    : null;

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
      <div className="w-full max-w-xs rounded-2xl bg-white p-8 text-center shadow-xl">
        <span
          className={`mb-4 inline-block rounded-full px-3 py-1 text-xs font-semibold ${
            inviteToken
              ? "bg-emerald-50 text-emerald-700"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {inviteToken ? "ゲスト用ログイン" : "管理者用ログイン"}
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="ロゴ"
          className="mx-auto mb-4 h-14 w-14 object-contain"
        />
        <h1 className="mb-2 text-lg font-bold text-slate-800">
          Globy
        </h1>
        <p className="mb-6 text-xs text-slate-500">
          {inviteToken
            ? inviterName
              ? `${inviterName}さんからの招待`
              : "招待されたルームにゲストとして参加します"
            : "管理者・マスター権限をお持ちの方はこちらからログインしてください"}
        </p>

        {errorMessage && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            {errorMessage}
          </p>
        )}

        <GoogleLoginButton />
      </div>
    </div>
  );
}
