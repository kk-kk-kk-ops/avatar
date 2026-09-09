import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PLANS, type PlanId } from "@/lib/types";
import CheckoutButton from "./CheckoutButton";

// 選択した有料プランの内容を表示し、ボタン押下でStripe Checkoutへ
// リダイレクトする(実処理はactions.tsのcreateCheckoutSession)。
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: { plan?: string; checkout?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const planId = searchParams.plan as PlanId | undefined;
  const plan =
    planId && planId in PLANS && planId !== "free" ? PLANS[planId] : null;
  if (!plan || !planId) redirect("/plan");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl">
        <h1 className="mb-2 text-lg font-bold text-slate-800">
          お支払い内容の確認
        </h1>
        <p className="mb-6 text-sm text-slate-500">
          {plan.label} {plan.subLabel}・{plan.priceLabel}
        </p>
        {searchParams.checkout === "cancelled" && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            決済がキャンセルされました。
          </p>
        )}
        <CheckoutButton planId={planId} />
      </div>
    </div>
  );
}
