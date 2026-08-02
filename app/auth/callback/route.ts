import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Googleログイン後、SupabaseがこのURLへリダイレクトしてくる。
// ここで認可コードをセッションに交換し、プロフィールの作成/更新を行う。
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const oauthError = searchParams.get("error");

  // ユーザーがGoogle側でログインをキャンセルした場合など
  if (oauthError) {
    const reason = oauthError === "access_denied" ? "cancelled" : "auth_failed";
    return NextResponse.redirect(`${origin}/login?error=${reason}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const supabase = createClient();

  let session;
  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const isExpired = /expired/i.test(error.message);
      return NextResponse.redirect(
        `${origin}/login?error=${isExpired ? "session_expired" : "auth_failed"}`
      );
    }
    session = data.session;
  } catch {
    return NextResponse.redirect(`${origin}/login?error=network`);
  }

  if (!session || !session.user) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const { user } = session;
  const metadata = user.user_metadata ?? {};
  const displayName =
    (metadata.full_name as string | undefined) ??
    (metadata.name as string | undefined) ??
    "ユーザー";
  const avatarUrl =
    (metadata.avatar_url as string | undefined) ?? (metadata.picture as string | undefined) ?? null;
  const email = user.email ?? (metadata.email as string | undefined) ?? null;

  const { error: upsertError } = await supabase.from("profiles").upsert(
    {
      user_id: user.id,
      provider: "google",
      display_name: displayName,
      avatar_url: avatarUrl,
      email,
      last_login_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (upsertError) {
    // eslint-disable-next-line no-console
    console.error("プロフィールの保存に失敗しました", upsertError);
  }

  return NextResponse.redirect(`${origin}/`);
}
