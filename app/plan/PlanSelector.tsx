"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PLANS, formatPlanDailyLimit, formatPlanRoomLabel, type PlanId } from "@/lib/types";
import { startFreeTrial } from "./actions";
import LogoutButton from "@/components/auth/LogoutButton";

const PLAN_ORDER: PlanId[] = ["free", "light", "standard", "pro"];

export default function PlanSelector() {
  const [selected, setSelected] = useState<PlanId>("free");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleNext = () => {
    setError(null);
    if (selected === "free") {
      startTransition(async () => {
        try {
          const result = await startFreeTrial();
          if (!result.ok) {
            setError(result.error);
            return;
          }
          router.push("/admin");
        } catch {
          setError("開始に失敗しました。時間をおいて再度お試しください。");
        }
      });
      return;
    }
    // Stripe決済は未実装のため、準備中ページへ案内する
    router.push(`/billing/checkout?plan=${selected}`);
  };

  return (
    <div>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_ORDER.map((planId) => {
          const plan = PLANS[planId];
          const isSelected = selected === planId;
          return (
            <label
              key={planId}
              className={`flex cursor-pointer flex-col rounded-xl border-2 bg-white p-4 transition-colors ${
                isSelected
                  ? "border-slate-900 bg-slate-50"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-bold text-slate-800">
                  {plan.label}
                </span>
                <input
                  type="radio"
                  name="plan"
                  value={planId}
                  checked={isSelected}
                  onChange={() => setSelected(planId)}
                />
              </div>
              <p className="mb-3 text-lg font-bold text-slate-900">
                {plan.priceLabel}
              </p>
              <ul className="flex-1 space-y-1 text-[11px] text-slate-600">
                <li>同時入室: {plan.maxPeoplePerRoom}人</li>
                <li>画面共有: {formatPlanDailyLimit(plan.screenShareDailyMinutes)}</li>
                <li>ビデオ通話: {formatPlanDailyLimit(plan.videoCallDailyMinutes)}</li>
                <li>音声通話: {formatPlanDailyLimit(plan.voiceCallDailyMinutes)}</li>
                <li>チャット履歴保管期間: {plan.historyRetentionLabel}</li>
                <li>ルーム: {formatPlanRoomLabel(plan.roomCreation)}</li>
              </ul>
            </label>
          );
        })}
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <button
        onClick={handleNext}
        disabled={pending}
        className="mx-auto block w-1/3 min-w-[160px] rounded-lg bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
      >
        {pending ? "処理中..." : "次へ"}
      </button>

      <LogoutButton className="mx-auto mt-3 block w-1/3 min-w-[160px] rounded-lg border border-slate-300 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50" />
    </div>
  );
}
