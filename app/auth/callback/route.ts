import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MASTER_EMAILS } from "@/lib/masterEmails";

// Googleログイン、およびメール/パスワード新規登録の確認メールのリンクを
// 踏んだ後、SupabaseがこのURLへリダイレクトしてくる(どちらもSupabase
// Auth側でPKCEのコード交換を使うため、同じ仕組みで共通に処理できる)。
// ここで認可コードをセッションに交換し、プロフィールの作成/更新を行う。
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const oauthError = searchParams.get("error");
  const oauthErrorCode = searchParams.get("error_code");
  // H-3: ログイン失敗時も、元々開いていた招待URLへ(エラー表示付きで)
  // 戻すため、成功時と同じ/auth/completeへの着地経路を使う。招待トークン
  // はsessionStorage側が主で、ここでのクエリはその保険(H-1と同じ考え方)。
  const inviteToken = searchParams.get("invite");
  const redirectToComplete = (errorCode?: string) => {
    const url = new URL("/auth/complete", origin);
    if (inviteToken) url.searchParams.set("invite", inviteToken);
    if (errorCode) url.searchParams.set("error", errorCode);
    return NextResponse.redirect(url.toString());
  };

  if (oauthError) {
    // メール確認/パスワード再設定リンクの有効期限切れ・使用済みの場合、
    // Supabase(GoTrue)はGoogleログインの「ユーザーがキャンセルした」場合と
    // 同じerror=access_deniedを返すが、error_code=otp_expiredが付く点で
    // 区別できる。以前はこれを区別せず一律「ログインがキャンセルされ
    // ました」と表示していたため、確認メールのリンクが期限切れ/使用済み
    // だった場合にも同じ誤解を招くメッセージが出てしまっていた
    // (メール到達確認テスト時に発覚)。
    if (oauthErrorCode === "otp_expired") {
      return redirectToComplete("link_expired");
    }
    // ユーザーがGoogle側でログインをキャンセルした場合など
    const reason = oauthError === "access_denied" ? "cancelled" : "auth_failed";
    return redirectToComplete(reason);
  }

  if (!code) {
    return redirectToComplete("auth_failed");
  }

  const supabase = createClient();

  let session;
  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const isExpired = /expired/i.test(error.message);
      return redirectToComplete(isExpired ? "session_expired" : "auth_failed");
    }
    session = data.session;
  } catch {
    return redirectToComplete("network");
  }

  if (!session || !session.user) {
    return redirectToComplete("auth_failed");
  }

  const { user } = session;
  const metadata = user.user_metadata ?? {};
  // メール/パスワードでの新規登録時はGoogleのようなプロフィール情報が
  // 無いため、表示名は「ユーザー」に、アイコンはnullにフォールバックする
  // (表示名は新規登録フォームで入力された場合のみuser_metadata.full_name
  // に入っている)。
  const displayName =
    (metadata.full_name as string | undefined) ??
    (metadata.name as string | undefined) ??
    "ユーザー";
  const avatarUrl =
    (metadata.avatar_url as string | undefined) ?? (metadata.picture as string | undefined) ?? null;
  const email = user.email ?? (metadata.email as string | undefined) ?? null;
  // Supabase Authがログイン方法に応じて自動的に設定する値
  // ('google' | 'email' 等)をそのまま使う。ハードコードしていた
  // "google"を、メール/パスワード追加に合わせて動的な値へ変更。
  const provider = (user.app_metadata?.provider as string | undefined) ?? "email";

  const { error: upsertError } = await supabase.from("profiles").upsert(
    {
      user_id: user.id,
      provider,
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

  // 招待リンク(?invite=トークン)経由のログインなら、招待の解決(自分自身の
  // 招待URLか・既に別アカウントを持つ人の一時閲覧か・純粋なゲスト参加か)は
  // すべてTOPページ(/)側に一本化している(F-3)。ここではトークンを
  // クエリ文字列として保持したまま/auth/completeへリダイレクトする
  // だけでよい。
  //
  // 直接"/"へリダイレクトしないのはH-1対応: signInWithOAuthのredirectTo
  // に付けたクエリ文字列は、Supabase側の許可リスト設定次第でGoogleとの
  // 往復の途中で失われることがあり(実際に発生し、招待URL経由でログイン
  // したのに管理者用ログイン画面に戻ってしまっていた)、ここでのクエリ
  // だけには頼れない。/auth/complete側でsessionStorage(ログイン開始前に
  // GoogleLoginButtonが保存したもの)を優先的に読み、それが無い場合の
  // 保険としてこのクエリを使う。
  return redirectToComplete();
}
