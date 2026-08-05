import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState } from "@/lib/authRouting";
import { PLANS, type PlanId, type Room } from "@/lib/types";
import AvatarSpaceLoader from "@/components/AvatarSpaceLoader";

// ルーム選択〜アバター選択〜入室までを担う画面。
// admin・guestの両方がここへ来る(招待されたゲストはログイン後直接ここへ)。
export default async function RoomsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

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
        .select("plan")
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

  return (
    <AvatarSpaceLoader
      initialName={profile?.display_name ?? undefined}
      rooms={rooms}
      maxPeoplePerRoom={PLANS[plan].maxPeoplePerRoom}
      isAccountAdmin={isAccountAdmin}
      isMaster={isAccountAdmin && state.isMaster}
    />
  );
}
