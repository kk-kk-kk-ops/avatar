import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState } from "@/lib/authRouting";
import {
  PLANS,
  NEW_ITEM_SIZE,
  MAP_WIDTH,
  MAP_HEIGHT,
  type PlanId,
  type Room,
  type MapTemplate,
  type Obstacle,
  type MeetingZone,
  type AccountSummary,
} from "@/lib/types";
import MasterDashboard from "./MasterDashboard";

// マスター画面。is_master=trueのアカウントだけがアクセスできる、
// プラットフォーム全体の集計とテンプレート編集を行う画面。
export default async function MasterPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const state = await resolveUserRouteState(supabase, user.id);
  if (!state.isMaster) redirect("/");

  // 2段階認証(MFA)を設定済みのマスターアカウントは、このセッションで
  // まだ確認コードの入力(aal2への昇格)を済ませていなければ
  // チャレンジ画面へ回す。MFA自体は任意設定のため、未設定なら
  // nextLevelもaal1のままでここはスキップされる。
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect("/master/mfa-challenge");
  }

  // 「ルームへ」リンク用。通常の"/"はログイン済みマスターを/masterへ
  // 戻してしまうため、自分自身の招待URL経由でルーム入室画面へ進む
  // (F-3で、自分自身の招待URLは常にルーム入室画面へ遷移するようになった
  // ことを利用している)。
  let ownInviteToken: string | null = null;
  if (state.type !== "no-account") {
    const { data: ownAccount } = await supabase
      .from("accounts")
      .select("invite_token")
      .eq("id", state.accountId)
      .maybeSingle();
    ownInviteToken = ownAccount?.invite_token ?? null;
  }

  // マスター権限を持つユーザーが所有するアカウントは、集計上は課金対象の
  // 一般テナントとして扱わない(運用担当者自身のアカウントのため)。
  const { data: masterProfileRows } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("is_master", true);
  const masterUserIds = new Set(
    (masterProfileRows ?? []).map((p) => p.user_id),
  );

  const { data: accountRows } = await supabase
    .from("accounts")
    .select("id, name, plan, owner_user_id, livekit_server_id, created_at")
    .order("created_at", { ascending: false });
  const planCounts: Record<PlanId, number> = {
    free: 0,
    light: 0,
    standard: 0,
    pro: 0,
  };
  let subscriptionTotalYen = 0;
  (accountRows ?? []).forEach((a) => {
    if (masterUserIds.has(a.owner_user_id)) return;
    const plan = a.plan as PlanId;
    if (!(plan in planCounts)) return;
    planCounts[plan] += 1;
    subscriptionTotalYen += PLANS[plan]?.priceYen ?? 0;
  });

  const { count: totalProfiles } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true });

  // アカウント一覧(サーバー割り当て変更UI用)。ownerのメールアドレスは
  // profiles側にしかないため、accounts.owner_user_id経由で別途取得して
  // JS側で突き合わせる(accounts→profilesの向きにFKが無くPostgRESTの
  // ネストselectが使えないため)。
  const { data: ownerProfileRows } = await supabase
    .from("profiles")
    .select("user_id, email");
  const ownerEmailByUserId = new Map(
    (ownerProfileRows ?? []).map((p) => [p.user_id, p.email ?? ""]),
  );
  const accounts: AccountSummary[] = (accountRows ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    plan: a.plan as PlanId,
    ownerEmail: ownerEmailByUserId.get(a.owner_user_id) ?? "",
    livekitServerId: a.livekit_server_id,
    createdAt: a.created_at,
  }));

  const { data: roomRows } = await supabase
    .from("rooms")
    .select("id, account_id, template_id, name, preview_image");
  const rooms: Room[] = (roomRows ?? []).map((r) => ({
    id: r.id,
    accountId: r.account_id,
    templateId: r.template_id,
    name: r.name,
    previewImage: r.preview_image,
  }));

  const { data: appSettings } = await supabase
    .from("app_settings")
    .select("avatar_size_px")
    .eq("id", "default")
    .maybeSingle();

  const { data: templateRows } = await supabase
    .from("templates")
    .select(
      "id, name, background_image_url, obstacles, meeting_area, map_width, map_height, spawn_x, spawn_y",
    )
    .order("created_at", { ascending: true });

  const templates: MapTemplate[] = (templateRows ?? []).map((t) => {
    const rawObstacles = Array.isArray(t.obstacles) ? t.obstacles : [];
    const obstacles: Obstacle[] = rawObstacles.map(
      (o: Partial<Obstacle>, i: number) => ({
        id: o.id ?? `obstacle-${i}`,
        x: o.x ?? 0,
        y: o.y ?? 0,
        width: o.width ?? NEW_ITEM_SIZE,
        height: o.height ?? NEW_ITEM_SIZE,
        label: o.label ?? "🧱 壁",
      }),
    );

    const rawZones = Array.isArray(t.meeting_area) ? t.meeting_area : [];
    const meetingZones: MeetingZone[] = rawZones.map(
      (z: Partial<MeetingZone>, i: number) => ({
        id: z.id ?? `meeting-${i}`,
        x: z.x ?? 0,
        y: z.y ?? 0,
        width: z.width ?? NEW_ITEM_SIZE,
        height: z.height ?? NEW_ITEM_SIZE,
        label: z.label ?? "ミーティングエリア",
        kind: z.kind ?? "meeting",
      }),
    );

    return {
      id: t.id,
      name: t.name,
      backgroundImageUrl: t.background_image_url,
      obstacles,
      meetingZones,
      width: t.map_width ?? MAP_WIDTH,
      height: t.map_height ?? MAP_HEIGHT,
      spawnPoint:
        t.spawn_x != null && t.spawn_y != null
          ? { x: t.spawn_x, y: t.spawn_y }
          : null,
    };
  });

  return (
    <MasterDashboard
      planCounts={planCounts}
      totalProfiles={totalProfiles ?? 0}
      subscriptionTotalYen={subscriptionTotalYen}
      rooms={rooms}
      templates={templates}
      accounts={accounts}
      showAdminLink={state.type === "admin"}
      showRoomsLink={state.type !== "no-account"}
      ownInviteToken={ownInviteToken}
      userEmail={user.email ?? ""}
      avatarSizePx={appSettings?.avatar_size_px ?? 17}
    />
  );
}
