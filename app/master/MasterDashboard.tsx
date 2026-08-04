"use client";

import { useState } from "react";
import type { MapTemplate, PlanId, Room } from "@/lib/types";
import { PLANS } from "@/lib/types";
import OnlineCount from "@/app/admin/OnlineCount";
import TemplateManager from "./TemplateManager";

type Tab = "dashboard" | "templates";

export default function MasterDashboard({
  planCounts,
  totalProfiles,
  subscriptionTotalYen,
  rooms,
  templates,
}: {
  planCounts: Record<PlanId, number>;
  totalProfiles: number;
  subscriptionTotalYen: number;
  rooms: Room[];
  templates: MapTemplate[];
}) {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <div>
      <div className="mb-6 flex gap-1 border-b border-slate-200">
        <button
          onClick={() => setTab("dashboard")}
          className={`border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
            tab === "dashboard"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-400 hover:text-slate-600"
          }`}
        >
          ダッシュボード
        </button>
        <button
          onClick={() => setTab("templates")}
          className={`border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
            tab === "templates"
              ? "border-emerald-600 bg-emerald-50 text-emerald-700"
              : "border-transparent bg-emerald-50/50 text-emerald-600 hover:bg-emerald-50"
          }`}
        >
          テンプレート作成
        </button>
      </div>

      {tab === "dashboard" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 p-6">
              <p className="text-xs font-semibold text-slate-500">
                登録者数(管理者+ゲスト)
              </p>
              <p className="mt-1 text-3xl font-bold text-slate-800">
                {totalProfiles}人
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 p-6">
              <p className="text-xs font-semibold text-slate-500">
                サブスク合計金額/月(概算)
              </p>
              <p className="mt-1 text-3xl font-bold text-slate-800">
                ¥{subscriptionTotalYen.toLocaleString()}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-6">
            <p className="mb-2 text-xs font-semibold text-slate-500">
              プランごとの登録者数(管理者のみ)
            </p>
            <ul className="space-y-1 text-sm text-slate-700">
              {(Object.keys(PLANS) as PlanId[]).map((plan) => (
                <li key={plan} className="flex justify-between">
                  <span>
                    {PLANS[plan].label} {PLANS[plan].subLabel}
                  </span>
                  <span>{planCounts[plan] ?? 0}件</span>
                </li>
              ))}
            </ul>
          </div>

          <OnlineCount rooms={rooms} />
        </div>
      )}

      {tab === "templates" && (
        <div className="rounded-xl bg-emerald-50/50 p-4">
          <TemplateManager templates={templates} />
        </div>
      )}
    </div>
  );
}
