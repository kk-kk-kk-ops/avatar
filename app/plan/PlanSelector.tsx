"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PLANS, type PlanId } from "@/lib/types";
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
          await startFreeTrial();
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
      <div className="mb-6 space-y-2">
        {PLAN_ORDER.map((planId) => {
          const plan = PLANS[planId];
          return (
            <label
              key={planId}
              className={`flex cursor-pointer items-center justify-between rounded-lg border-2 px-4 py-3 transition-colors ${
                selected === planId
                  ? "border-slate-900 bg-slate-50"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="plan"
                  value={planId}
                  checked={selected === planId}
                  onChange={() => setSelected(planId)}
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-800">
                    {plan.label}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {plan.subLabel}
                  </span>
                </span>
              </span>
              <span className="shrink-0 text-sm font-bold text-slate-800">
                {plan.priceLabel}
              </span>
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
        className="w-full rounded-lg bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
      >
        {pending ? "処理中..." : "次へ"}
      </button>

      <LogoutButton className="mt-3 w-full rounded-lg border border-slate-300 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50" />
    </div>
  );
}
