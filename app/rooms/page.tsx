import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState } from "@/lib/authRouting";
import { PLANS, type PlanId, type Room } from "@/lib/types";
import AvatarSpaceLoader from "@/components/AvatarSpaceLoader";

// ルーム選択〜アバター選択〜入室までを担う画面。
// admin・guestの両方がここへ来る(招待されたゲストはログイン後直接ここへ)。
export default async function RoomsPage({
  searchParams,
}: {
  searchParams: { invite?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  // 既に自分自身の別アカウントを持っている人(admin/masterなど)が
  // 他人の招待URLを一時的に閲覧しているケース(viewOnly)。この場合
  // プロフィールは一切書き換えていないため、URLのトークンから毎回
  // 対象アカウントを解決する。ログイン状態(state)は本来の自分自身の
  // ものなので、下の通常フローとは完全に分けて処理する。
  const viewInviteToken = searchParams.invite;
  if (viewInviteToken) {
    const { data: viewAccountRows } = await supabase.rpc(
      "lookup_account_by_invite_token",
      { token: viewInviteToken },
    );
    const viewAccount = viewAccountRows?.[0];
    if (viewAccount) {
      const [{ data: profile }, { data: viewAccountFull }, { data: roomRows }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("display_name")
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase
            .from("accounts")
            .select("plan")
            .eq("id", viewAccount.id)
            .maybeSingle(),
          supabase
            .from("rooms")
            .select("id, account_id, template_id, name, preview_image")
            .eq("account_id", viewAccount.id)
            .order("created_at", { ascending: true }),
        ]);

      const rooms: Room[] = (roomRows ?? []).map((r) => ({
        id: r.id,
        accountId: r.account_id,
        templateId: r.template_id,
        name: r.name,
        previewImage: r.preview_image,
      }));

      const plan = (viewAccountFull?.plan as PlanId) ?? "free";

      return (
        <AvatarSpaceLoader
          initialName={profile?.display_name ?? undefined}
          rooms={rooms}
          maxPeoplePerRoom={PLANS[plan].maxPeoplePerRoom}
          isAccountAdmin={false}
          isMaster={false}
          // 自分自身は管理者用アカウントを持っているので、ログアウト後は
          // ゲスト用ログインではなく管理者用ログイン(TOPページ)に戻す。
          guestInviteToken={null}
        />
      );
    }
    // トークンが無効な場合は通常のルーティングにフォールスルーする。
  }

  const state = await resolveUserRouteState(supabase, user.id);
  if (state.isMaster && state.type === "no-account") redirect("/master");
  if (state.type === "no-account") redirect("/plan");

  const [{ data: profile }, { data: account }, { data: roomRows }] =
    await Promise.all([
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
        .order("created_at", { ascending: true }),
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

  return (
    <AvatarSpaceLoader
      initialName={profile?.display_name ?? undefined}
      rooms={rooms}
      maxPeoplePerRoom={PLANS[plan].maxPeoplePerRoom}
      isAccountAdmin={isAccountAdmin}
      isMaster={isAccountAdmin && state.isMaster}
      guestInviteToken={guestInviteToken}
    />
  );
}
