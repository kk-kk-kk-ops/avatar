import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState } from "@/lib/authRouting";
import PlanSelector from "./PlanSelector";

// プラン選択画面。まだどのアカウントにも属していない新規ユーザーだけが来る
// (既にアカウントがあれば/admin・/roomsへ振り分け、未ログインなら/へ)。
export default async function PlanPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const state = await resolveUserRouteState(supabase, user.id);
  if (state.type === "admin") redirect("/admin");
  if (state.type === "guest") redirect("/rooms");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <h1 className="mb-1 text-lg font-bold text-slate-800">
          プランを選択
        </h1>
        <p className="mb-6 text-sm text-slate-500">
          まずはプランを選んで始めましょう。無料お試しはいつでもプラン変更できます。
        </p>
        <PlanSelector />
      </div>
    </div>
  );
}
