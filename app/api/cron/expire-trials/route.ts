import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { timingSafeEqualString } from "@/lib/timingSafeEqualString";
import { broadcastForceLeaveForAccount } from "@/lib/broadcastForceLeave";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 30日間無料トライアル(standardプラン相当)の期限が切れたアカウントを
// 自動的にfreeプランへ戻す。Vercel Cronから毎日4:00 JST(19:00 UTC。
// vercel.json参照)に呼ばれる。trial_usedはtrueのまま維持する
// (再付与防止)。
//
// 判定条件(trial_ends_at超過かつstripe_subscription_idが無い)を
// SELECTしてから1件ずつUPDATEする方式にはしない。その間にStripe Webhook
// (app/api/stripe/webhook/route.ts)が割り込んで有料契約が成立した
// (stripe_subscription_idが付いた)アカウントを、古い判定のまま
// freeへ巻き戻してしまう競合(レース)が起こりうるため。判定条件を
// UPDATE文自身のWHERE句として1回のSQL文で評価させることで、Webhookが
// 先にstripe_subscription_idを書き込んでいた場合はそのアカウントだけ
// 0件マッチとなり安全になる。
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization") ?? "";
  if (!cronSecret || !timingSafeEqualString(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Service Roleの設定が不足しています" },
      { status: 500 },
    );
  }

  const supabase = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: expired, error } = await supabase
    .from("accounts")
    .update({ plan: "free", trial_ends_at: null })
    .lt("trial_ends_at", new Date().toISOString())
    .is("stripe_subscription_id", null)
    .select("id");

  if (error) {
    console.error("トライアル期限切れアカウントの更新に失敗しました", error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }

  const accountIds = (expired ?? []).map((row) => row.id as string);
  await Promise.all(
    accountIds.map((accountId) => broadcastForceLeaveForAccount(supabase, accountId)),
  );

  return NextResponse.json({ downgraded: accountIds.length });
}
