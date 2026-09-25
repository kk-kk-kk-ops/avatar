import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState } from "@/lib/authRouting";
import {
  PLANS,
  type PlanId,
  type Room,
  type Announcement,
  type UpdateLog,
  type MaintenanceSettings,
  isMaintenanceActive,
  formatMaintenanceDateTime,
} from "@/lib/types";
import LogoutButton from "@/components/auth/LogoutButton";
import AdminDashboard from "./AdminDashboard";

// メンテナンス期間中、マスター以外の管理者を管理画面から締め出す際に
// 表示する画面(app/page.tsxのBannedNoticeと同じ考え方)。
function MaintenanceNotice({ maintenance }: { maintenance: MaintenanceSettings }) {
  return (
    <div className="flex h-screen w-full items-center justify-center overflow-hidden bg-slate-900 px-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-8 text-center shadow-xl">
        <h1 className="mb-2 text-lg font-bold text-slate-800">
          メンテナンス中
        </h1>
        <p className="mb-2 text-sm text-red-600">
          {maintenance.startsAt && formatMaintenanceDateTime(maintenance.startsAt)}
          {" "}〜{" "}
          {maintenance.endsAt && formatMaintenanceDateTime(maintenance.endsAt)}
        </p>
        <p className="mb-6 text-sm text-slate-500">
          ただいまメンテナンス中のため、管理画面をご利用いただけません。
          終了までしばらくお待ちください。
        </p>
        <LogoutButton className="w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700" />
      </div>
    </div>
  );
}

// 管理画面。アカウントのオーナー(role='admin')だけがアクセスできる。
export default async function AdminPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const state = await resolveUserRouteState(supabase, user.id);
  if (state.type === "no-account") redirect("/plan");
  if (state.type === "guest") redirect("/");

  // メンテナンス期間中は、マスター以外の管理者は管理画面に一切
  // アクセスできない(2026-09追加)。ダッシュボード自体を出し分けるより
  // 先に、ここで丸ごとブロックする。
  const { data: maintenanceSettings } = await supabase
    .from("app_settings")
    .select("maintenance_enabled, maintenance_starts_at, maintenance_ends_at")
    .eq("id", "default")
    .maybeSingle();
  const maintenance: MaintenanceSettings = {
    enabled: maintenanceSettings?.maintenance_enabled ?? false,
    startsAt: maintenanceSettings?.maintenance_starts_at ?? null,
    endsAt: maintenanceSettings?.maintenance_ends_at ?? null,
  };
  if (isMaintenanceActive(maintenance) && !state.isMaster) {
    return <MaintenanceNotice maintenance={maintenance} />;
  }

  const { data: account } = await supabase
    .from("accounts")
    .select(
      "id, name, plan, trial_ends_at, invite_token, invite_inviter_name, stripe_customer_id, stripe_subscription_id",
    )
    .eq("id", state.accountId)
    .single();

  const { data: roomRows } = await supabase
    .from("rooms")
    .select("id, account_id, template_id, name, preview_image")
    .eq("account_id", state.accountId)
    .order("created_at", { ascending: true });

  const rooms: Room[] = (roomRows ?? []).map((r) => ({
    id: r.id,
    accountId: r.account_id,
    templateId: r.template_id,
    name: r.name,
    previewImage: r.preview_image,
  }));

  const { data: templateRows } = await supabase
    .from("templates")
    .select("id, name, background_image_url")
    .order("created_at", { ascending: true });

  const { data: bannedRows } = await supabase.rpc(
    "list_banned_participants",
    { p_account_id: state.accountId },
  );
  const bannedParticipants = (
    (bannedRows ?? []) as {
      user_id: string;
      display_name: string | null;
      banned_at: string;
    }[]
  ).map((b) => ({
    userId: b.user_id,
    displayName: b.display_name,
    bannedAt: b.banned_at,
  }));

  const templates = (templateRows ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    backgroundImageUrl: t.background_image_url,
  }));

  // お知らせ・アップデート情報(マスター画面「お知らせ」タブで入力したもの)。
  // announcements/update_logsのRLSは、role='admin'のユーザーにSELECTのみ
  // 許可する設計になっている(supabase/consolidated_setup.sql参照。
  // INSERT/UPDATE/DELETEはマスターのみ)。
  const { data: announcementRows } = await supabase
    .from("announcements")
    .select("id, title, body, published_at, created_at")
    .order("published_at", { ascending: false })
    .order("created_at", { ascending: false });

  const { data: updateLogRows } = await supabase
    .from("update_logs")
    .select("id, version, body, released_at, created_at")
    .order("released_at", { ascending: false })
    .order("created_at", { ascending: false });

  // 「告知」「アップデート」タブ内、タイトルごとの未読バッジ表示用
  // (項目単位の既読管理。詳細はsupabase/consolidated_setup.sqlの
  // announcement_reads/update_log_reads参照)。
  const { data: announcementReadRows } = await supabase
    .from("announcement_reads")
    .select("announcement_id")
    .eq("account_id", state.accountId);
  const readAnnouncementIds = new Set(
    (announcementReadRows ?? []).map((r) => r.announcement_id),
  );

  const { data: updateLogReadRows } = await supabase
    .from("update_log_reads")
    .select("update_log_id")
    .eq("account_id", state.accountId);
  const readUpdateLogIds = new Set(
    (updateLogReadRows ?? []).map((r) => r.update_log_id),
  );

  const announcements: (Announcement & { unread: boolean })[] = (
    announcementRows ?? []
  ).map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    publishedAt: a.published_at,
    unread: !readAnnouncementIds.has(a.id),
  }));

  const updateLogs: (UpdateLog & { unread: boolean })[] = (
    updateLogRows ?? []
  ).map((u) => ({
    id: u.id,
    version: u.version,
    body: u.body,
    releasedAt: u.released_at,
    unread: !readUpdateLogIds.has(u.id),
  }));

  const plan = (account?.plan as PlanId) ?? "free";
  const maxRooms = PLANS[plan].maxRooms;

  // デバッグ用プラン切り替え機能(app/admin/BillingPanel.tsx)は、
  // 環境変数DEBUG_PLAN_SWITCH_EMAIL(カンマ区切りで複数指定可)に含まれる
  // メールアドレスのアカウントだけに表示する。ここで判定してクライアントへ
  // 渡すことで、対象外のユーザーにはUI自体がHTMLに含まれない
  // (actions.ts側でも別途再検証する)。
  const debugPlanSwitchEmails = (process.env.DEBUG_PLAN_SWITCH_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const isDebugPlanSwitcherAllowed =
    !!user.email && debugPlanSwitchEmails.includes(user.email);

  return (
    <AdminDashboard
      rooms={rooms}
      plan={plan}
      maxRooms={maxRooms}
      trialEndsAt={account?.trial_ends_at ?? null}
      inviteToken={account?.invite_token ?? ""}
      inviterName={account?.invite_inviter_name ?? ""}
      templates={templates}
      showMasterLink={state.isMaster}
      userEmail={user.email ?? ""}
      isDebugPlanSwitcherAllowed={isDebugPlanSwitcherAllowed}
      bannedParticipants={bannedParticipants}
      hasStripeCustomer={!!account?.stripe_customer_id}
      hasActiveSubscription={!!account?.stripe_subscription_id}
      announcements={announcements}
      updateLogs={updateLogs}
    />
  );
}
