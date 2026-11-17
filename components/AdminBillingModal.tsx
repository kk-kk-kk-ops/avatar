"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PLANS, type PlanId } from "@/lib/types";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { getAdminBillingInfo } from "@/app/admin/actions";
import { createPortalSession } from "@/app/billing/portal/actions";

// 管理画面モーダル化 M-4(2026-11)。会議室画面から開く、契約プラン・
// 支払い方法・請求履歴の表示・変更。AdminInviteRoomModal.tsx(M-3)と
// 同様、このコンポーネント自身はRealtimeチャンネルを一切購読しない
// (読み取り・操作はすべてServer Action経由)。
// デバッグ用プラン切り替え(app/admin/BillingPanel.tsxのdebugSetPlan)は
// ここには載せない(開発者専用のデバッグ機能であり、公開経路を増やす
// 必要が無いため。課題リストにある本番ガード不足の指摘とも独立に、
// このモーダルには元から含めない方針)。
//
// 決済・請求ポータルへの遷移は同じタブで行う(案α)。その直前に、
// 会議室の接続が切断されることを案内する確認ダイアログを挟む。
const PLAN_DISPLAY_ORDER: PlanId[] = ["free", "light", "standard", "pro"];

export default function AdminBillingModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();

  const [plan, setPlan] = useState<PlanId>("free");
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [hasStripeCustomer, setHasStripeCustomer] = useState(false);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAdminBillingInfo(locale).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setPlan(result.plan);
        setTrialEndsAt(result.trialEndsAt);
        setHasStripeCustomer(result.hasStripeCustomer);
        setHasActiveSubscription(result.hasActiveSubscription);
      } else {
        setLoadError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const priceLabel = (id: PlanId) =>
    t("admin.priceLabel", { yen: PLANS[id].priceYen.toLocaleString() });
  const historyRetentionLabel = (id: PlanId) =>
    t(`admin.historyRetention.${PLANS[id].historyRetentionLabel}`);
  const dailyLimitLabel = (minutes: number | null) =>
    minutes === null
      ? t("admin.voiceCallUnlimited")
      : t("admin.dailyLimitPerPerson", { minutes: String(minutes) });

  const [billingPending, setBillingPending] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [, startBillingTransition] = useTransition();

  const handlePlanCardClick = (targetPlan: PlanId) => {
    if (targetPlan === plan) return;
    if (targetPlan === "free" && !hasActiveSubscription) return;
    if (!window.confirm(t("room.billingLeaveConfirm"))) return;

    if (!hasActiveSubscription) {
      router.push(`/billing/checkout?plan=${targetPlan}&from=room`);
      return;
    }
    setBillingError(null);
    setBillingPending(targetPlan);
    startBillingTransition(async () => {
      const result = await createPortalSession(targetPlan, "room");
      setBillingPending(null);
      if (result && !result.ok) setBillingError(result.error);
    });
  };

  const handlePortalClick = () => {
    if (!window.confirm(t("room.billingLeaveConfirm"))) return;
    setBillingError(null);
    setBillingPending("portal");
    startBillingTransition(async () => {
      const result = await createPortalSession(undefined, "room");
      setBillingPending(null);
      if (result && !result.ok) setBillingError(result.error);
    });
  };

  const handlePaymentMethodClick = () => {
    if (!window.confirm(t("room.billingLeaveConfirm"))) return;
    setBillingError(null);
    setBillingPending("payment_method");
    startBillingTransition(async () => {
      const result = await createPortalSession("payment_method_update", "room");
      setBillingPending(null);
      if (result && !result.ok) setBillingError(result.error);
    });
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">
            {t("room.billingModalTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>

        {loadError && <p className="mb-2 text-xs text-red-600">{loadError}</p>}

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
          <div className="grid grid-cols-2 gap-3">
            {PLAN_DISPLAY_ORDER.map((id) => {
              const info = PLANS[id];
              const isCurrent = plan === id;
              return (
                <div
                  key={id}
                  className={`flex flex-col rounded-xl border-2 bg-white p-3 ${
                    isCurrent ? "border-emerald-500" : "border-slate-200"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-800">{info.label}</p>
                    {isCurrent && (
                      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
                        {t("admin.currentPlanBadge")}
                      </span>
                    )}
                  </div>
                  <p className="mb-2 text-sm font-bold text-slate-900">{priceLabel(id)}</p>
                  <ul className="mb-3 flex-1 space-y-1 text-[10px] text-slate-600">
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
                        ? "cursor-not-allowed rounded-lg bg-slate-200 px-2 py-1.5 text-[11px] font-semibold text-slate-500"
                        : "rounded-lg bg-slate-900 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
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

        <div className="mt-4 border-t border-slate-100 pt-3">
          <button
            onClick={handlePaymentMethodClick}
            disabled={billingPending !== null}
            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {billingPending === "payment_method" ? t("common.processing") : t("admin.paymentMethodChange")}
          </button>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-3">
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
      </div>
    </div>
  );
}
