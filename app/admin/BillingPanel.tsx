"use client";

import { useState, useTransition } from "react";
import { PLANS, type PlanId } from "@/lib/types";
import { debugSetPlan } from "./actions";
import { createCheckoutSession } from "@/app/billing/checkout/actions";
import { createPortalSession } from "@/app/billing/portal/actions";
import { useLocale } from "@/lib/i18n/LocaleContext";

const PLAN_DISPLAY_ORDER: PlanId[] = ["free", "light", "standard", "pro"];

export default function BillingPanel({
  plan,
  trialEndsAt,
  isDebugPlanSwitcherAllowed,
  hasStripeCustomer,
  hasActiveSubscription,
}: {
  plan: PlanId;
  trialEndsAt: string | null;
  isDebugPlanSwitcherAllowed: boolean;
  hasStripeCustomer: boolean;
  hasActiveSubscription: boolean;
}) {
  const { t, locale } = useLocale();
  // 管理画面の英語対応(2026-10)にあたり、lib/types.tsのPLANS.priceLabel/
  // historyRetentionLabelは他画面(app/plan, app/billing/checkout、master画面)
  // でも共有されているため直接は変更せず、この画面専用にpriceYen等の
  // 数値からローカルで文言を組み立てる。
  const priceLabel = (id: PlanId) =>
    t("admin.priceLabel", { yen: PLANS[id].priceYen.toLocaleString() });
  const historyRetentionLabel = (id: PlanId) =>
    t(`admin.historyRetention.${PLANS[id].historyRetentionLabel}`);
  const dailyLimitLabel = (minutes: number | null) =>
    minutes === null
      ? t("admin.voiceCallUnlimited")
      : t("admin.dailyLimitPerPerson", { minutes: String(minutes) });

  // 契約プランカード・支払い方法ボタンの両方から共有するpending/error状態。
  // "portal"は「支払い方法を管理」ボタン、プランIDはそのプランカードの
  // クリックを表す。
  const [billingPending, setBillingPending] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [, startBillingTransition] = useTransition();

  const handlePlanCardClick = (targetPlan: PlanId) => {
    if (targetPlan === plan) return;
    // freeへの切り替えは「解約」を意味するが、実際の契約(サブスク
    // リプション)が無ければStripe側でやることが無い(plan列だけが
    // 実態と食い違って設定されているデバッグ用アカウント等)。
    if (targetPlan === "free" && !hasActiveSubscription) return;
    setBillingError(null);
    setBillingPending(targetPlan);
    startBillingTransition(async () => {
      // Stripe上に有効なサブスクリプション(stripe_subscription_id)が
      // 既にある場合のみCustomer Portal経由にする(プラン変更・freeへの
      // ダウングレード=解約の両方)。ここをplan列で判定すると、Stripeを
      // 一度も通していないのにplanだけ設定されているアカウント
      // (デバッグ用プラン切り替えを使ったマスターアカウント等)で
      // 「お支払い情報がまだ登録されていません」となりプラン変更が
      // 一切できなくなる不具合になるため、実際の契約有無
      // (hasActiveSubscription)で判定する。
      // targetPlanを渡すと、ポータルのトップページを経由せず「このプランに
      // 変更しますか?」の確認画面へ直接遷移する(freeへの切り替え=解約は
      // targetPlanが有料プランではないため、従来通りトップページ経由になる)。
      const result = hasActiveSubscription
        ? await createPortalSession(targetPlan)
        : await createCheckoutSession(targetPlan);
      setBillingPending(null);
      if (result && !result.ok) setBillingError(result.error);
    });
  };

  const handlePortalClick = () => {
    setBillingError(null);
    setBillingPending("portal");
    startBillingTransition(async () => {
      const result = await createPortalSession();
      setBillingPending(null);
      if (result && !result.ok) setBillingError(result.error);
    });
  };

  const handlePaymentMethodClick = () => {
    setBillingError(null);
    setBillingPending("payment_method");
    startBillingTransition(async () => {
      const result = await createPortalSession("payment_method_update");
      setBillingPending(null);
      if (result && !result.ok) setBillingError(result.error);
    });
  };

  const [debugPendingPlan, setDebugPendingPlan] = useState<PlanId | null>(
    null,
  );
  const [, startDebugTransition] = useTransition();
  const [debugError, setDebugError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleDebugSwitch = (targetPlan: PlanId) => {
    setDebugError(null);
    setDebugPendingPlan(targetPlan);
    startDebugTransition(async () => {
      const result = await debugSetPlan(targetPlan, locale);
      setDebugPendingPlan(null);
      if (!result.ok) {
        setDebugError(result.error);
        return;
      }
      setToastMessage(
        t("admin.planSwitchedToast", { label: PLANS[targetPlan].label }),
      );
      setTimeout(() => setToastMessage(null), 3000);
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 text-xs font-semibold text-slate-500">{t("admin.contractPlan")}</p>
        {trialEndsAt && (() => {
          const daysRemaining = Math.max(
            0,
            Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000),
          );
          return (
            <p className="mb-3 text-xs text-amber-600">
              {t("admin.trialRemaining", {
                days: String(daysRemaining),
                date: new Date(trialEndsAt).toLocaleDateString(
                  locale === "en" ? "en-US" : "ja-JP",
                ),
              })}
            </p>
          );
        })()}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_DISPLAY_ORDER.map((id) => {
            const info = PLANS[id];
            const isCurrent = plan === id;
            return (
              <div
                key={id}
                className={`flex flex-col rounded-xl border-2 bg-white p-4 ${
                  isCurrent ? "border-emerald-500" : "border-slate-200"
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-800">
                    {info.label}
                  </p>
                  {isCurrent && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      {t("admin.currentPlanBadge")}
                    </span>
                  )}
                </div>
                <p className="mb-3 text-lg font-bold text-slate-900">
                  {priceLabel(id)}
                </p>
                <ul className="mb-4 flex-1 space-y-1 text-[11px] text-slate-600">
                  <li>{t("admin.simultaneousCapacity", { count: String(info.maxPeoplePerRoom) })}</li>
                  <li>{t("admin.screenShareLabel")} {dailyLimitLabel(info.screenShareDailyMinutes)}</li>
                  <li>{t("admin.videoCallLabel")} {dailyLimitLabel(info.videoCallDailyMinutes)}</li>
                  <li>{t("admin.voiceCallLabel")} {dailyLimitLabel(info.voiceCallDailyMinutes)}</li>
                  <li>{t("admin.historyRetentionLabel")} {historyRetentionLabel(id)}</li>
                  <li>{t("admin.recordingLabel")} {info.recordingEnabled ? t("admin.available") : t("admin.unavailable")}</li>
                </ul>
                <button
                  onClick={() => handlePlanCardClick(id)}
                  disabled={
                    isCurrent ||
                    billingPending !== null ||
                    (id === "free" && !hasActiveSubscription)
                  }
                  className={
                    isCurrent
                      ? "cursor-not-allowed rounded-lg bg-slate-200 px-3 py-2 text-xs font-semibold text-slate-500"
                      : "rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                  }
                >
                  {isCurrent
                    ? t("admin.inUse")
                    : billingPending === id
                      ? t("common.processing")
                      : id === "free"
                        ? t("admin.cancelPlan")
                        : hasActiveSubscription
                          ? t("admin.changePlan")
                          : t("admin.subscribeThisPlan")}
                </button>
              </div>
            );
          })}
        </div>
        {billingError && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            {billingError}
          </p>
        )}
      </div>

      <div>
        <button
          onClick={handlePaymentMethodClick}
          disabled={billingPending !== null}
          className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {billingPending === "payment_method" ? t("common.processing") : t("admin.paymentMethodChange")}
        </button>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-slate-500">{t("admin.billingHistory")}</p>
        {hasStripeCustomer ? (
          <button
            onClick={handlePortalClick}
            disabled={billingPending !== null}
            className="text-xs font-semibold text-slate-700 underline hover:text-slate-900 disabled:opacity-50"
          >
            {t("admin.billingHistoryLink")}
          </button>
        ) : (
          <p className="text-xs text-slate-400">{t("admin.billingHistoryNone")}</p>
        )}
      </div>

      {isDebugPlanSwitcherAllowed && (
        <div className="rounded-xl border border-dashed border-amber-400 bg-amber-50 p-4">
          <p className="mb-1 text-xs font-semibold text-amber-700">
            {t("admin.debugSwitcherTitle")}
          </p>
          <p className="mb-3 text-[11px] text-amber-700">
            {t("admin.debugSwitcherBody")}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PLAN_DISPLAY_ORDER.map((id) => {
              const info = PLANS[id];
              const isCurrent = plan === id;
              return (
                <div
                  key={id}
                  className={`flex flex-col rounded-xl border-2 bg-white p-4 ${
                    isCurrent ? "border-emerald-500" : "border-slate-200"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-bold text-slate-800">
                      {info.label}
                    </p>
                    {isCurrent && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        {t("admin.currentPlanBadge")}
                      </span>
                    )}
                  </div>
                  <p className="mb-3 text-lg font-bold text-slate-900">
                    {priceLabel(id)}
                  </p>
                  <ul className="mb-4 flex-1 space-y-1 text-[11px] text-slate-600">
                    <li>{t("admin.simultaneousCapacity", { count: String(info.maxPeoplePerRoom) })}</li>
                    <li>{t("admin.screenShareLabel")} {dailyLimitLabel(info.screenShareDailyMinutes)}</li>
                    <li>{t("admin.videoCallLabel")} {dailyLimitLabel(info.videoCallDailyMinutes)}</li>
                    <li>{t("admin.voiceCallLabel")} {t("admin.voiceCallUnlimited")}</li>
                    <li>{t("admin.historyRetentionLabel")} {historyRetentionLabel(id)}</li>
                    <li>{t("admin.recordingLabel")} {info.recordingEnabled ? t("admin.available") : t("admin.unavailable")}</li>
                  </ul>
                  <button
                    onClick={() => handleDebugSwitch(id)}
                    disabled={debugPendingPlan !== null || isCurrent}
                    className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
                  >
                    {debugPendingPlan === id
                      ? t("admin.debugSwitching")
                      : isCurrent
                        ? t("admin.currentlyApplied")
                        : t("admin.debugSwitchTo")}
                  </button>
                </div>
              );
            })}
          </div>

          {debugError && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
              {debugError}
            </p>
          )}
        </div>
      )}

      {/* トースト通知(プラン切り替え成功時) */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg">
          ✅ {toastMessage}
        </div>
      )}
    </div>
  );
}
