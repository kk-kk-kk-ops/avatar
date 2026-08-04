import Link from "next/link";
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
} from "@/lib/types";
import MasterDashboard from "./MasterDashboard";
import LogoutButton from "@/components/auth/LogoutButton";

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
    .select("plan, owner_user_id");
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

  const { data: templateRows } = await supabase
    .from("templates")
    .select(
      "id, name, background_image_url, obstacles, meeting_area, map_width, map_height",
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
        label: o.label ?? "🧱 障害物",
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
    };
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Grovina" className="h-6 w-6 object-contain" />
          <span className="text-sm font-bold text-slate-800">マスター画面</span>
        </div>
        <div className="flex items-center gap-3">
          {state.type === "admin" && (
            <Link
              href="/admin"
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              管理画面へ
            </Link>
          )}
          {state.type !== "no-account" && (
            <Link
              href="/rooms"
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            >
              ルームへ
            </Link>
          )}
          <LogoutButton className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50" />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <MasterDashboard
          planCounts={planCounts}
          totalProfiles={totalProfiles ?? 0}
          subscriptionTotalYen={subscriptionTotalYen}
          rooms={rooms}
          templates={templates}
        />
      </main>
    </div>
  );
}
