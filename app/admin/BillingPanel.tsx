"use client";

import { useState, useTransition } from "react";
import { PLANS, type PlanId } from "@/lib/types";
import { debugSetPlan } from "./actions";

const PLAN_DISPLAY_ORDER: PlanId[] = ["free", "light", "standard", "pro"];

// 「1人あたり1日◯分」/「無制限」の表示テキストをPLANSの値から生成する
// (プラン名・価格・機能項目の重複記述を避け、PLANSを唯一の情報源にする)。
function formatDailyLimit(minutes: number | null): string {
  return minutes === null ? "無制限" : `1人あたり1日${minutes}分`;
}

export default function BillingPanel({
  plan,
  trialEndsAt,
  isDebugPlanSwitcherAllowed,
}: {
  plan: PlanId;
  trialEndsAt: string | null;
  isDebugPlanSwitcherAllowed: boolean;
}) {
  const [showStripeNotice, setShowStripeNotice] = useState(false);

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
        {trialEndsAt && (
          <p className="mb-3 text-xs text-amber-600">
            無料お試しは{new Date(trialEndsAt).toLocaleDateString("ja-JP")}
            までです。
          </p>
        )}
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
                  <li>画面共有: {formatDailyLimit(info.screenShareDailyMinutes)}</li>
                  <li>ビデオ通話: {formatDailyLimit(info.videoCallDailyMinutes)}</li>
                  <li>音声通話: {formatDailyLimit(info.voiceCallDailyMinutes)}</li>
                  <li>チャット・画像履歴の保管期間: {info.historyRetentionLabel}</li>
                  <li>
                    ルーム作成:{" "}
                    {info.roomCreation === "template-or-original"
                      ? "テンプレート＋オリジナル作成可"
                      : "テンプレートのみ"}
                  </li>
                </ul>
                <button
                  disabled
                  className="cursor-not-allowed rounded-lg bg-slate-200 px-3 py-2 text-xs font-semibold text-slate-500"
                >
                  {isCurrent ? "利用中" : "お問い合わせください"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-slate-500">支払い方法</p>
        <button
          onClick={() => setShowStripeNotice(true)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          支払い方法を登録・変更
        </button>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-slate-500">請求履歴</p>
        <p className="text-xs text-slate-400">請求履歴はまだありません。</p>
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
                    <li>画面共有: {formatDailyLimit(info.screenShareDailyMinutes)}</li>
                    <li>ビデオ通話: {formatDailyLimit(info.videoCallDailyMinutes)}</li>
                    <li>音声通話: 無制限</li>
                    <li>チャット・画像履歴の保管期間: {info.historyRetentionLabel}</li>
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

      {showStripeNotice && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          決済機能は現在準備中です。もうしばらくお待ちください。
        </p>
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
