import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 新規登録フォームの送信前に呼ばれる。メール/パスワードで既に登録済みの
// メールアドレスかどうかだけを返す(Googleで登録済みの場合はfalseを返し、
// 未登録の場合と区別しない)。これにより、メールアドレス列挙攻撃
// (第三者が入力したメールアドレスにGoogleアカウントがあるかどうかを
// 外部から判別できてしまう問題)を避けつつ、メール/パスワード同士の
// 重複登録だけは明示的にエラー表示できるようにする。
//
// profiles.providerは/auth/callbackがログインの都度upsertする値のため、
// 同一メールにGoogleとメール/パスワードの両方の識別情報がリンクされて
// いる場合は「直近にログインした方法」を反映する(Supabaseの自動
// アイデンティティリンクにより起こり得る)。その場合、providerが
// 'google'であればこの関数はfalseを返す(曖昧な案内のまま)。
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) {
    return NextResponse.json({ registeredWithPassword: false });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ registeredWithPassword: false });
  }
  const serviceClient = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data } = await serviceClient
    .from("profiles")
    .select("provider")
    .eq("email", email)
    .maybeSingle();

  return NextResponse.json({ registeredWithPassword: data?.provider === "email" });
}
