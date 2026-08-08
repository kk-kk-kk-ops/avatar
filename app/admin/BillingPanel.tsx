"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { PLANS, type PlanId } from "@/lib/types";
import { debugSetPlan } from "./actions";

const DEBUG_SWITCHABLE_PLAN_ORDER: PlanId[] = [
  "free",
  "light",
  "standard",
  "pro",
  "business",
];

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
  const planInfo = PLANS[plan];

  const [debugSelectedPlan, setDebugSelectedPlan] = useState<PlanId>(
    DEBUG_SWITCHABLE_PLAN_ORDER.includes(plan) ? plan : "free",
  );
  const [debugPending, startDebugTransition] = useTransition();
  const [debugError, setDebugError] = useState<string | null>(null);
  const [debugSaved, setDebugSaved] = useState(false);

  const handleDebugSave = () => {
    setDebugError(null);
    setDebugSaved(false);
    startDebugTransition(async () => {
      const result = await debugSetPlan(debugSelectedPlan);
      if (!result.ok) {
        setDebugError(result.error);
        return;
      }
      setDebugSaved(true);
      setTimeout(() => setDebugSaved(false), 2000);
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 text-xs font-semibold text-slate-500">契約プラン</p>
        <p className="text-base font-bold text-slate-800">
          {planInfo.label} {planInfo.subLabel}
        </p>
        {trialEndsAt && (
          <p className="mt-1 text-xs text-amber-600">
            無料お試しは{new Date(trialEndsAt).toLocaleDateString("ja-JP")}
            までです。
          </p>
        )}
        {plan !== "master" && (
          <div className="mt-3 flex gap-2">
            <Link
              href="/plan"
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            >
              プラン変更
            </Link>
          </div>
        )}
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
            選択して保存すると、このアカウントの契約プランがその場で
            切り替わります(人数上限・画面共有/ビデオ通話の日次制限に
            即反映されます)。動作確認用の機能です。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={debugSelectedPlan}
              onChange={(e) =>
                setDebugSelectedPlan(e.target.value as PlanId)
              }
              disabled={debugPending}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
            >
              {DEBUG_SWITCHABLE_PLAN_ORDER.map((id) => (
                <option key={id} value={id}>
                  {PLANS[id].label}
                </option>
              ))}
            </select>
            <button
              onClick={handleDebugSave}
              disabled={debugPending}
              className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-60"
            >
              {debugPending
                ? "切り替え中..."
                : debugSaved
                  ? "切り替えました"
                  : "このプランに切り替える"}
            </button>
          </div>
          {debugError && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
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
    </div>
  );
}
