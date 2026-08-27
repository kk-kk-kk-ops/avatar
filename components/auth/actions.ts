"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

// 通常ログイン(メール/パスワード)への総当たり対策。うちのログイン画面
// (このServer Action)を経由した試行だけが対象で、anonキーでSupabaseの
// 認証APIを直接叩く攻撃までは防げない(そちらはSupabase Auth基盤側の
// レート制限が本質的な防波堤。Tech Lead確認依頼その26で別途ダッシュボード
// 確認を依頼済み)。
//
// メールアドレス単位・IPアドレス単位のそれぞれで、直近LOCK_WINDOW_MS以内に
// MAX_ATTEMPTS回失敗したらLOCK_WINDOW_MSの間ロックする。値を変えたら
// supabase/consolidated_setup.sqlのlogin_lockoutsセクションのコメントも
// 揃えること。
const MAX_ATTEMPTS = 10;
const LOCK_WINDOW_MS = 15 * 60 * 1000;

type LoginResult = { ok: true } | { ok: false; error: string };

function getClientIp(): string {
  // Vercel環境ではx-forwarded-forの先頭が実クライアントIP。
  // ローカル開発など無い場合は"unknown"にまとめ、少なくとも
  // メールアドレス単位のロックは機能させる。
  const forwardedFor = headers().get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

async function isLocked(service: ServiceClient, key: string): Promise<boolean> {
  const { data } = await service
    .from("login_lockouts")
    .select("locked_until")
    .eq("id", key)
    .maybeSingle();
  return !!data?.locked_until && new Date(data.locked_until).getTime() > Date.now();
}

async function recordFailure(service: ServiceClient, key: string): Promise<void> {
  const { data: existing } = await service
    .from("login_lockouts")
    .select("failed_count, updated_at")
    .eq("id", key)
    .maybeSingle();

  const now = new Date();
  // 直近の失敗からLOCK_WINDOW_MS以上経っていれば、カウントを1からやり直す
  // (ロック解除後の再スタート、および長期間ぽつぽつ失敗するケースの
  // 誤ロックを避けるため)。
  const windowExpired =
    !existing ||
    now.getTime() - new Date(existing.updated_at).getTime() > LOCK_WINDOW_MS;
  const nextCount = windowExpired ? 1 : existing.failed_count + 1;
  const lockedUntil =
    nextCount >= MAX_ATTEMPTS
      ? new Date(now.getTime() + LOCK_WINDOW_MS).toISOString()
      : null;

  await service.from("login_lockouts").upsert({
    id: key,
    failed_count: nextCount,
    locked_until: lockedUntil,
    updated_at: now.toISOString(),
  });
}

async function recordSuccess(service: ServiceClient, key: string): Promise<void> {
  await service.from("login_lockouts").delete().eq("id", key);
}

export async function loginWithPassword(
  email: string,
  password: string,
): Promise<LoginResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    return { ok: false, error: "メールアドレスとパスワードを入力してください。" };
  }

  const service = createServiceRoleClient();
  const emailKey = `email:${normalizedEmail}`;
  const ipKey = `ip:${getClientIp()}`;

  if ((await isLocked(service, emailKey)) || (await isLocked(service, ipKey))) {
    return {
      ok: false,
      error:
        "ログイン試行回数が多いため、しばらく時間をおいてから再度お試しください。",
    };
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (error) {
    await recordFailure(service, emailKey);
    await recordFailure(service, ipKey);
    return { ok: false, error: "メールアドレスまたはパスワードが正しくありません。" };
  }

  await recordSuccess(service, emailKey);
  await recordSuccess(service, ipKey);
  return { ok: true };
}
