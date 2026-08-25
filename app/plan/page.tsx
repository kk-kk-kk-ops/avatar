import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState } from "@/lib/authRouting";
import PlanSelector from "./PlanSelector";

// プラン選択画面。まだどのアカウントにも属していない新規ユーザーだけが来る
// (既にアカウントがあれば/admin・/(ルーム入室画面)へ振り分け、
// 未ログインなら/へ)。
export default async function PlanPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const state = await resolveUserRouteState(supabase, user.id);
  if (state.isMaster) redirect("/master");
  if (state.type === "admin") redirect("/admin");
  if (state.type === "guest") redirect("/");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-3xl rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-4 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Globy" className="h-6 w-6 object-contain" />
          <span className="text-sm font-bold text-slate-800">
            Globy
          </span>
        </div>
        <h1 className="mb-6 text-lg font-bold text-slate-800">
          プランを選択
        </h1>
        <PlanSelector />
      </div>
    </div>
  );
}
