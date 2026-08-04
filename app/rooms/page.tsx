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
        .select("id, account_id, name, preview_image")
        .eq("account_id", state.accountId)
        .order("created_at", { ascending: true }),
    ]);

  const rooms: Room[] = (roomRows ?? []).map((r) => ({
    id: r.id,
    accountId: r.account_id,
    name: r.name,
    previewImage: r.preview_image,
  }));

  const plan = (account?.plan as PlanId) ?? "free";

  return (
    <AvatarSpaceLoader
      initialName={profile?.display_name ?? undefined}
      rooms={rooms}
      maxPeoplePerRoom={PLANS[plan].maxPeoplePerRoom}
    />
  );
}
