import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState } from "@/lib/authRouting";
import { PLANS, type PlanId, type Room } from "@/lib/types";
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
  if (state.type === "guest") redirect("/rooms");

  const { data: account } = await supabase
    .from("accounts")
    .select("id, name, plan, trial_ends_at, invite_token, invite_inviter_name")
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

  const plan = (account?.plan as PlanId) ?? "free";
  const maxRooms = PLANS[plan].maxRooms;

  // デバッグ用プラン切り替え機能(app/admin/BillingPanel.tsx)は、
  // 環境変数DEBUG_PLAN_SWITCH_EMAILに一致するメールアドレスのアカウント
  // だけに表示する。ここで判定してクライアントへ渡すことで、対象外の
  // ユーザーにはUI自体がHTMLに含まれない(actions.ts側でも別途再検証する)。
  const isDebugPlanSwitcherAllowed =
    !!process.env.DEBUG_PLAN_SWITCH_EMAIL &&
    user.email === process.env.DEBUG_PLAN_SWITCH_EMAIL;

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
    />
  );
}
