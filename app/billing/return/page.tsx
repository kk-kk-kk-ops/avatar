import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState } from "@/lib/authRouting";

// /admin 廃止の段階2(2026-11-22)。決済・請求ポータルはすべて会議室内の
// 請求モーダルから開く前提になったため、success_url/cancel_url/return_url
// は常にこのページを経由する(/adminへ戻す分岐は廃止した)。
//
// マスター(運営者)は通常の"/"だとapp/page.tsx:396で/masterへ戻されて
// しまうため、app/master/page.tsx:46-64の「ルームへ」リンクと同じ方法
// (自分自身の招待URL経由)でルーム入室画面へ進む。
export default async function BillingReturnPage({
  searchParams,
}: {
  searchParams: { from?: string; status?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // "checkout_success"/"portal_returned"以外(無し・想定外の値)は
  // 通知を表示しない(誤った文言を出すより、何も出さない方が安全)。
  const status =
    searchParams.status === "checkout_success" ||
    searchParams.status === "portal_returned"
      ? searchParams.status
      : null;
  const billingQuery = status ? `billing=${status}` : "";

  const state = await resolveUserRouteState(supabase, user.id);
  if (state.isMaster) {
    // app/master/page.tsx:60-63と同じ方法(自分のprofiles.account_idが
    // 指すアカウントの招待トークンだけを返すSECURITY DEFINER関数)。
    const { data: ownAccountRows } = await supabase.rpc(
      "get_own_account_guest_info",
    );
    const ownInviteToken = ownAccountRows?.[0]?.invite_token ?? null;
    if (ownInviteToken) {
      const separator = billingQuery ? "&" : "";
      redirect(`/?invite=${ownInviteToken}${separator}${billingQuery}`);
    }
    // トークンが取れない場合(通常起こらないはずの防御的フォールバック)
    // は、下の通常の"/"へのリダイレクトに任せる。
  }

  redirect(billingQuery ? `/?${billingQuery}` : "/");
}
