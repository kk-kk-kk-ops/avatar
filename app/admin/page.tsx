import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// /admin 廃止の段階2(2026-11-22)。かつてはアカウント管理者専用の管理画面
// だったが、M-4〜M-5(2026-11)でその機能はすべて会議室内のモーダルに
// 移行済みのため、ここはログイン済みならTOPページ("/")へ転送するだけに
// する(運営者かどうか等の振り分けはapp/page.tsx側の既存ロジックに委ねる)。
// 未ログインの場合はmiddleware(lib/supabase/middleware.ts)が既に"/"へ
// 転送しているはずだが、/plan・/billing/checkout等の他ページと同じく
// 念のための防御的チェックを残す。
export default async function AdminPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  redirect("/");
}
