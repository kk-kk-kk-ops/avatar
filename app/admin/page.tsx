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

  const templates = (templateRows ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    backgroundImageUrl: t.background_image_url,
  }));

  const plan = (account?.plan as PlanId) ?? "free";
  const maxRooms = PLANS[plan].maxRooms;

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
    />
  );
}
