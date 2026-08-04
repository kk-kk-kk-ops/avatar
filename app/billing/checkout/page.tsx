import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PLANS, type PlanId } from "@/lib/types";

// Stripe決済は未実装のため、選択した有料プランの内容を表示するだけの
// 準備中ページ。決済処理を追加する際、ここからStripe Checkoutへ
// リダイレクトする形に差し替える想定。
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: { plan?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const planId = searchParams.plan as PlanId | undefined;
  const plan = planId && planId in PLANS ? PLANS[planId] : null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl">
        <h1 className="mb-2 text-lg font-bold text-slate-800">
          お支払い(準備中)
        </h1>
        {plan ? (
          <p className="mb-6 text-sm text-slate-500">
            {plan.label} {plan.subLabel}・{plan.priceLabel}
            の決済機能は現在準備中です。もうしばらくお待ちください。
          </p>
        ) : (
          <p className="mb-6 text-sm text-slate-500">
            決済機能は現在準備中です。もうしばらくお待ちください。
          </p>
        )}
        <Link
          href="/plan"
          className="block w-full rounded-lg bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-700"
        >
          プラン選択に戻る
        </Link>
      </div>
    </div>
  );
}
