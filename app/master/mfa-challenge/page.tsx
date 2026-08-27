import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MfaChallengeForm from "./MfaChallengeForm";

// マスターアカウントの2段階目の認証コード入力画面。is_master=trueだが
// まだこのセッションでaal2(2段階認証済み)になっていない場合に
// /master/page.tsxからここへリダイレクトされる。
export default async function MfaChallengePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_master")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.is_master) redirect("/");

  // 既にaal2まで済んでいるなら、このページに用はないので/masterへ戻す。
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal2") redirect("/master");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4 py-10">
      <MfaChallengeForm />
    </div>
  );
}
