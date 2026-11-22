import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState } from "@/lib/authRouting";
import CreateRoomStart from "./CreateRoomStart";

// 「ルームを作成」画面(2026-11変更。以前は4プランから選ぶ画面だった)。
// まだどのアカウントにも属していない新規ユーザーだけが来る(既にアカウント
// があれば/(ルーム入室画面)へ振り分け、未ログインなら/login へ)。
// この振り分け自体は変更していない。
export default async function PlanPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const state = await resolveUserRouteState(supabase, user.id);
  if (state.isMaster) redirect("/master");
  if (state.type === "admin") redirect("/");
  if (state.type === "guest") redirect("/");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-4 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Globy" className="h-6 w-6 object-contain" />
          <span className="text-sm font-bold text-slate-800">
            Globy
          </span>
        </div>
        <CreateRoomStart />
      </div>
    </div>
  );
}
