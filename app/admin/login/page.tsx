import { AUTH_ERROR_MESSAGES } from "@/lib/authErrorMessages";
import GoogleLoginButton from "@/components/auth/GoogleLoginButton";

// 管理者ログイン専用URL。TOPページ("/")はログイン済みセッションが
// あれば自動的にプラン選択/管理画面/ルーム選択へ進んでしまうため、
// 過去にゲストとして参加した経験がありログアウトしていない相手に
// 共有すると、このログインカードが一切表示されないまま既存の
// ルーム選択画面などへ飛ばされてしまう(TOPページはあくまで
// 「ログイン済みなら行き先へ進むハブ」として設計されているため)。
// このページはセッションの有無を一切見ず、常にログインカードだけを
// 表示することで、管理者を勧誘するための安定した配布用URLとして使う。
// ログイン後の行き先(管理者なら/admin、未登録ならプラン選択の/plan等)
// は従来通り/auth/callback経由でTOPページの振り分けに委ねる。
export default function AdminLoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const errorMessage = searchParams.error
    ? AUTH_ERROR_MESSAGES[searchParams.error]
    : null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-8 text-center shadow-xl">
        <span className="mb-4 inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          管理者用ログイン
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="ロゴ"
          className="mx-auto mb-4 h-14 w-14 object-contain"
        />
        <h1 className="mb-2 text-lg font-bold text-slate-800">Globy</h1>
        <p className="mb-6 text-xs text-slate-500">
          管理者・マスター権限をお持ちの方はこちらからログインしてください
        </p>

        {errorMessage && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            {errorMessage}
          </p>
        )}

        <GoogleLoginButton />
      </div>
    </div>
  );
}
