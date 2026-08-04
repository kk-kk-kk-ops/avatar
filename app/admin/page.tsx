import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState } from "@/lib/authRouting";
import type { PlanId, Room } from "@/lib/types";
import AdminDashboard from "./AdminDashboard";
import LogoutButton from "@/components/auth/LogoutButton";

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
    .select("id, name, plan, trial_ends_at, invite_token")
    .eq("id", state.accountId)
    .single();

  const { data: roomRows } = await supabase
    .from("rooms")
    .select("id, account_id, name, preview_image")
    .eq("account_id", state.accountId)
    .order("created_at", { ascending: true });

  const rooms: Room[] = (roomRows ?? []).map((r) => ({
    id: r.id,
    accountId: r.account_id,
    name: r.name,
    previewImage: r.preview_image,
  }));

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Grovina" className="h-6 w-6 object-contain" />
          <span className="text-sm font-bold text-slate-800">
            {account?.name ?? "管理画面"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/rooms"
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
          >
            ルームへ
          </Link>
          <LogoutButton className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50" />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <AdminDashboard
          rooms={rooms}
          plan={(account?.plan as PlanId) ?? "free"}
          trialEndsAt={account?.trial_ends_at ?? null}
          inviteToken={account?.invite_token ?? ""}
        />
      </main>
    </div>
  );
}
