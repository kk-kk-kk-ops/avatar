import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { LIVEKIT_SERVERS } from "@/lib/livekitServers";

// β版の運用制限:全顧客合計の同時接続数がこれに達したら新規契約を停止する。
const BETA_ONLINE_CAP = 1000;

type ProvisionResult =
  | { ok: true; accountId: string; created: boolean }
  | { ok: false; error: string };

// ユーザーに紐づくaccounts行が無ければ作る共通処理。無料お試し
// (app/plan/actions.tsのstartFreeTrial)と、有料プランを直接選んだ場合の
// Checkout Session作成前(app/billing/checkout/actions.ts)の両方から
// 呼ばれる。accounts.planは常に'free'で作成する(DBトリガーがINSERT時の
// free以外を拒否するため)。有料プランで契約する場合の実際のplan反映は、
// Stripe Webhookがservice_roleクライアント経由で後から行う。
// createdは「今回このアカウントを新規作成したか」を表す(既存ユーザーの
// 再訪問時は早期returnするため常にfalse)。呼び出し元のstartFreeTrialは、
// これを使って30日間無料トライアルを「初回のみ」付与する。
export async function provisionAccountForUser(
  supabase: SupabaseClient,
  user: { id: string },
): Promise<ProvisionResult> {
  // 既にアカウントを持っていれば作り直さない(二重送信・ブラウザバック対策)
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingProfile?.account_id) {
    return { ok: true, accountId: existingProfile.account_id, created: false };
  }

  // β版の同時接続数上限チェック(全プラン共通の新規契約ゲート)
  const { data: onlineCount, error: countError } = await supabase.rpc(
    "get_online_session_count",
  );
  if (!countError && (onlineCount ?? 0) >= BETA_ONLINE_CAP) {
    return {
      ok: false,
      error:
        "現在アクセスが集中しているため、新規のご契約を一時的に停止しています。しばらくしてから再度お試しください。",
    };
  }

  // 新規契約に、最もアカウント数が少ない物理LiveKitサーバーをラウンドロビンで
  // 割り当てる(契約時点で固定し、以後は変わらない。lib/livekitServers.ts参照)。
  const { data: serverCounts } = await supabase.rpc(
    "count_accounts_by_livekit_server",
  );
  const countByServerId = new Map(
    (serverCounts as Array<{ livekit_server_id: string; account_count: number }> | null ?? []).map(
      (row) => [row.livekit_server_id, row.account_count],
    ),
  );
  const assignedServerId = LIVEKIT_SERVERS.reduce((leastLoaded, server) =>
    (countByServerId.get(server.id) ?? 0) <
    (countByServerId.get(leastLoaded.id) ?? 0)
      ? server
      : leastLoaded,
  ).id;

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .insert({
      name: "Globy",
      plan: "free",
      owner_user_id: user.id,
      livekit_server_id: assignedServerId,
    })
    .select("id")
    .single();

  if (accountError || !account) {
    return { ok: false, error: "アカウントの作成に失敗しました" };
  }

  // roleは本人による自己書き換えを防ぐDBトリガー(consolidated_setup.sql)の
  // 対象列のため、service_roleクライアントで更新する(直前に自分がowner_user_id
  // として新規accountsを作成できたこと自体がここまでの正規フローの証跡なので、
  // この1回の書き込みに限りRLS/トリガーをバイパスしても安全)。
  const { error: profileError } = await createServiceRoleClient()
    .from("profiles")
    .update({ account_id: account.id, role: "admin" })
    .eq("user_id", user.id);

  if (profileError) {
    return { ok: false, error: "プロフィールの更新に失敗しました" };
  }

  const { error: roomError } = await supabase.from("rooms").insert({
    account_id: account.id,
    name: "Globy",
    preview_image: "/map-background.webp",
  });

  if (roomError) {
    return { ok: false, error: "初期ルームの作成に失敗しました" };
  }

  return { ok: true, accountId: account.id, created: true };
}
