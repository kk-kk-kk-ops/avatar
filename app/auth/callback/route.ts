import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MASTER_EMAILS } from "@/lib/masterEmails";
import { joinAccountViaInvite } from "@/lib/joinAccountViaInvite";

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

  // マスター権限メールのリストに載っていれば、毎回ログイン時に
  // is_masterを付与しておく(既にtrueなら実質no-op)。
  if (email && MASTER_EMAILS.includes(email)) {
    const { error: masterError } = await supabase
      .from("profiles")
      .update({ is_master: true })
      .eq("user_id", user.id);
    if (masterError) {
      // eslint-disable-next-line no-console
      console.error("マスター権限の付与に失敗しました", masterError);
    }
  }

  // 招待リンク(?invite=トークン)経由のログインなら、そのアカウントへ
  // ゲストとして紐付ける(既に別アカウントのadmin/guestであっても
  // 切り替える。招待は常にゲスト参加を優先する)。ただし招待URLが
  // 自分自身がオーナーのアカウントのものだった場合(自分の招待URL)は
  // 何もせず、下の通常ルーティングに任せる。
  const inviteToken = searchParams.get("invite");
  if (inviteToken) {
    const result = await joinAccountViaInvite(supabase, user.id, inviteToken);
    if (!result.ok) {
      if (result.error === "join_failed") {
        // eslint-disable-next-line no-console
        console.error("招待経由の参加に失敗しました", result.detail);
      }
      const errorCode =
        result.error === "invalid_invite" ? "invalid_invite" : "auth_failed";
      return NextResponse.redirect(`${origin}/?error=${errorCode}`);
    }
    // 他人の招待URL経由でゲスト参加した場合は、isMaster/管理者であっても
    // 必ずルーム選択画面へ進む(自分の管理画面/マスター画面には戻さない)。
    if (!result.isOwnAccount) {
      return NextResponse.redirect(`${origin}/rooms`);
    }
  }

  return NextResponse.redirect(`${origin}/`);
}
