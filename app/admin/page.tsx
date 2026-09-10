import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState } from "@/lib/authRouting";
import {
  PLANS,
  type PlanId,
  type Room,
  type Announcement,
  type UpdateLog,
} from "@/lib/types";
import AdminDashboard from "./AdminDashboard";

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
    .select("id, title, body, published_at")
    .order("published_at", { ascending: false });
  const announcements: Announcement[] = (announcementRows ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    publishedAt: a.published_at,
  }));

  const { data: updateLogRows } = await supabase
    .from("update_logs")
    .select("id, version, body, released_at")
    .order("released_at", { ascending: false });
  const updateLogs: UpdateLog[] = (updateLogRows ?? []).map((u) => ({
    id: u.id,
    version: u.version,
    body: u.body,
    releasedAt: u.released_at,
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
