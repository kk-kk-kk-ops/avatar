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
    return NextResponse.redirect(`${origin}/?error=${reason}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=auth_failed`);
  }

  const supabase = createClient();

  let session;
  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const isExpired = /expired/i.test(error.message);
      return NextResponse.redirect(
        `${origin}/?error=${isExpired ? "session_expired" : "auth_failed"}`
      );
    }
    session = data.session;
  } catch {
    return NextResponse.redirect(`${origin}/?error=network`);
  }

  if (!session || !session.user) {
    return NextResponse.redirect(`${origin}/?error=auth_failed`);
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

  // 招待リンク(?invite=トークン)経由のログインなら、そのアカウントへ
  // ゲストとして紐付ける。既に何らかのアカウントに所属済みの場合は
  // 上書きしない(誤って別アカウントのゲストに切り替わるのを防ぐ)。
  const inviteToken = searchParams.get("invite");
  if (inviteToken) {
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("account_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!existingProfile?.account_id) {
      const { data: accountRows } = await supabase.rpc(
        "lookup_account_by_invite_token",
        { token: inviteToken },
      );
      const account = accountRows?.[0];

      if (!account) {
        return NextResponse.redirect(`${origin}/?error=invalid_invite`);
      }

      const { error: joinError } = await supabase
        .from("profiles")
        .update({ account_id: account.id, role: "guest" })
        .eq("user_id", user.id);

      if (joinError) {
        // eslint-disable-next-line no-console
        console.error("アカウントへの参加に失敗しました", joinError);
        return NextResponse.redirect(`${origin}/?error=auth_failed`);
      }
    }
  }

  return NextResponse.redirect(`${origin}/`);
}
