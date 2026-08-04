"use client";

import { useState } from "react";
import Link from "next/link";
import { PLANS, type PlanId } from "@/lib/types";

export default function BillingPanel({
  plan,
  trialEndsAt,
}: {
  plan: PlanId;
  trialEndsAt: string | null;
}) {
  const [showStripeNotice, setShowStripeNotice] = useState(false);
  const planInfo = PLANS[plan];

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
        <div className="mt-3 flex gap-2">
          <Link
            href="/plan"
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
          >
            プラン変更
          </Link>
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

      {showStripeNotice && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          決済機能は現在準備中です。もうしばらくお待ちください。
        </p>
      )}
    </div>
  );
}
