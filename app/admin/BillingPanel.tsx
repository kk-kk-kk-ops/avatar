"use client";

import { useState, useTransition } from "react";
import { PLANS, formatPlanDailyLimit, formatPlanRoomLabel, type PlanId } from "@/lib/types";
import { debugSetPlan } from "./actions";
import { createCheckoutSession } from "@/app/billing/checkout/actions";
import { createPortalSession } from "@/app/billing/portal/actions";

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
      const result = await debugSetPlan(targetPlan);
      setDebugPendingPlan(null);
      if (!result.ok) {
        setDebugError(result.error);
        return;
      }
      setToastMessage(`プランを「${PLANS[targetPlan].label}」に切り替えました`);
      setTimeout(() => setToastMessage(null), 3000);
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 text-xs font-semibold text-slate-500">契約プラン</p>
        {trialEndsAt && (() => {
          const daysRemaining = Math.max(
            0,
            Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000),
          );
          return (
            <p className="mb-3 text-xs text-amber-600">
              無料トライアル期間:残り{daysRemaining}日
              ({new Date(trialEndsAt).toLocaleDateString("ja-JP")}まで)。
              期間終了後は自動的に無料プランに戻ります。
            </p>
          );
        })()}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                      現在のプラン
                    </span>
                  )}
                </div>
                <p className="mb-3 text-lg font-bold text-slate-900">
                  {info.priceLabel}
                </p>
                <ul className="mb-4 flex-1 space-y-1 text-[11px] text-slate-600">
                  <li>同時入室: {info.maxPeoplePerRoom}人</li>
                  <li>画面共有: {formatPlanDailyLimit(info.screenShareDailyMinutes)}</li>
                  <li>ビデオ通話: {formatPlanDailyLimit(info.videoCallDailyMinutes)}</li>
                  <li>音声通話: {formatPlanDailyLimit(info.voiceCallDailyMinutes)}</li>
                  <li>チャット履歴保管期間: {info.historyRetentionLabel}</li>
                  <li>ルーム: {formatPlanRoomLabel(info.roomCreation)}</li>
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
                    ? "利用中"
                    : billingPending === id
                      ? "処理中..."
                      : hasActiveSubscription
                        ? "プランを変更する"
                        : "このプランで契約する"}
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
        <p className="mb-1 text-xs font-semibold text-slate-500">請求履歴</p>
        {hasStripeCustomer ? (
          <button
            onClick={handlePortalClick}
            disabled={billingPending !== null}
            className="text-xs font-semibold text-slate-700 underline hover:text-slate-900 disabled:opacity-50"
          >
            お支払い方法・請求履歴の確認はこちらから
          </button>
        ) : (
          <p className="text-xs text-slate-400">請求履歴はまだありません。</p>
        )}
      </div>

      {isDebugPlanSwitcherAllowed && (
        <div className="rounded-xl border border-dashed border-amber-400 bg-amber-50 p-4">
          <p className="mb-1 text-xs font-semibold text-amber-700">
            🛠️ デバッグ用プラン切り替え(このアカウントのみ表示)
          </p>
          <p className="mb-3 text-[11px] text-amber-700">
            ボタンを押すと即座にこのアカウントの契約プランが切り替わります
            (人数上限・画面共有/ビデオ通話の日次制限に即反映され、この
            アカウントのルームに入室中の全員が強制的に退出します)。
            動作確認用の機能です。
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
                        現在のプラン
                      </span>
                    )}
                  </div>
                  <p className="mb-3 text-lg font-bold text-slate-900">
                    {info.priceLabel}
                  </p>
                  <ul className="mb-4 flex-1 space-y-1 text-[11px] text-slate-600">
                    <li>同時入室: {info.maxPeoplePerRoom}人</li>
                    <li>画面共有: {formatPlanDailyLimit(info.screenShareDailyMinutes)}</li>
                    <li>ビデオ通話: {formatPlanDailyLimit(info.videoCallDailyMinutes)}</li>
                    <li>音声通話: 無制限</li>
                    <li>チャット履歴保管期間: {info.historyRetentionLabel}</li>
                  </ul>
                  <button
                    onClick={() => handleDebugSwitch(id)}
                    disabled={debugPendingPlan !== null || isCurrent}
                    className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
                  >
                    {debugPendingPlan === id
                      ? "切り替え中..."
                      : isCurrent
                        ? "適用中"
                        : "このプランに切り替える"}
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
