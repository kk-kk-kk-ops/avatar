import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { resolveUserRouteState } from "@/lib/authRouting";
import { PLANS, type PlanId } from "@/lib/types";
import { BILLING } from "@/lib/site-info";
import { translate } from "@/lib/i18n/translations";
import { getServerLocale } from "@/lib/i18n/getServerLocale";
import CheckoutButton from "./CheckoutButton";

// 選択した有料プランの内容を表示し、ボタン押下でStripe Checkoutへ
// リダイレクトする(実処理はactions.tsのcreateCheckoutSession)。
// ここが特定商取引法で求められる「申込み確定前の最終確認画面」を兼ねる
// ため、プラン名・税込月額・自動更新・次回請求日・解約方法・返金しない
// ことを決済ボタンの近くにまとめて表示する(2026-10)。
//
// Stripe Checkout Session(app/billing/checkout/actions.ts)は
// trial_period_daysを指定していないため、決済完了と同時に即時課金される。
// アカウントが既に30日間無料トライアル中(accounts.trial_ends_atが未来)
// であっても、ここで有料プランへ申し込むとトライアルの残り日数に関わらず
// 本日から課金が始まる点を、トライアル中のユーザーには明示する。
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: { plan?: string; checkout?: string; from?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const planId = searchParams.plan as PlanId | undefined;
  const plan =
    planId && planId in PLANS && planId !== "free" ? PLANS[planId] : null;
  if (!plan || !planId) redirect("/plan");

  // 2026-11追加: アカウントの無い人がこのアドレスへ直接アクセスした場合、
  // アカウントを作らずに/plan(「ルームを作成」画面)へ戻す。新規アカウントは
  // 無料トライアルの開始からしか作らない方針にしたため。
  const state = await resolveUserRouteState(supabase, user.id);
  if (state.type === "no-account") redirect("/plan");

  const { data: account } = await supabase
    .from("accounts")
    .select("trial_ends_at")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  const trialEndsAt = account?.trial_ends_at
    ? new Date(account.trial_ends_at)
    : null;
  const isTrialActive = !!trialEndsAt && trialEndsAt.getTime() > Date.now();

  const today = new Date().toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // /admin 廃止の段階2(2026-11-22)。お支払いはすべて会議室から行う
  // 前提になったため、fromの値にかかわらず常に会議室へ戻れるリンクを
  // 表示する。
  const locale = getServerLocale();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl">
        <h1 className="mb-2 text-lg font-bold text-slate-800">
          お支払い内容の確認
        </h1>
        <p className="mb-6 text-sm text-slate-500">
          {plan.label} {plan.subLabel}
        </p>
        {searchParams.checkout === "cancelled" && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            決済がキャンセルされました。
          </p>
        )}

        <div className="mb-6 space-y-2 rounded-lg bg-slate-50 p-4 text-left text-xs leading-6 text-slate-700">
          <p>
            <span className="font-semibold text-slate-900">プラン:</span>{" "}
            {plan.label}
          </p>
          <p>
            <span className="font-semibold text-slate-900">月額料金(税込):</span>{" "}
            {plan.priceLabel}
          </p>
          <p>
            <span className="font-semibold text-slate-900">お支払い方法:</span>{" "}
            {BILLING.cycle}です。解約のお手続きをされない限り、毎月自動的に同じ金額が決済されます。
          </p>
          <p>
            <span className="font-semibold text-slate-900">次回のご請求日:</span>{" "}
            本日({today})に初回のお支払いが発生し、以降は毎月その同日が請求日になります。
          </p>
          {isTrialActive && (
            <p className="rounded-md bg-amber-50 px-2 py-1.5 text-amber-700">
              現在、無料トライアル期間中です(
              {trialEndsAt!.toLocaleDateString("ja-JP")}
              まで)。このまま{plan.label}プランにお申し込みいただくと、トライアルの残り期間に関わらず、本日から有料プランの請求が始まります。
            </p>
          )}
          <p>
            <span className="font-semibold text-slate-900">解約方法:</span>{" "}
            {BILLING.cancelHow}
          </p>
          <p>
            <span className="font-semibold text-slate-900">返金について:</span>{" "}
            {BILLING.refundRule}
          </p>
          <p className="pt-1">
            詳しくは
            <Link href="/tokushoho" target="_blank" className="text-red-700 underline underline-offset-2">
              特定商取引法に基づく表記
            </Link>
            と
            <Link href="/terms" target="_blank" className="text-red-700 underline underline-offset-2">
              利用規約
            </Link>
            をご確認ください。
          </p>
        </div>

        <p className="mb-3 text-[11px] leading-5 text-slate-500">
          法人・個人事業主のお客様は、次の画面で「商号」に会社名・屋号をご入力ください。請求書(適格請求書)の宛名として記載されます。
        </p>

        <CheckoutButton planId={planId} from="room" />

        <Link
          href="/billing/return?from=room"
          className="mt-3 block text-xs font-semibold text-slate-500 underline hover:text-slate-700"
        >
          {translate(locale, "billing.backToRoom")}
        </Link>
      </div>
    </div>
  );
}
