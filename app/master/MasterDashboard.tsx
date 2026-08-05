"use client";

import { useState } from "react";
import Link from "next/link";
import type { MapTemplate, PlanId, Room } from "@/lib/types";
import { PLANS } from "@/lib/types";
import LogoutButton from "@/components/auth/LogoutButton";
import MasterOnlineStats from "./MasterOnlineStats";
import TemplateManager from "./TemplateManager";

type Tab = "dashboard" | "templates";

export default function MasterDashboard({
  planCounts,
  totalProfiles,
  subscriptionTotalYen,
  rooms,
  templates,
  showAdminLink,
  showRoomsLink,
}: {
  planCounts: Record<PlanId, number>;
  totalProfiles: number;
  subscriptionTotalYen: number;
  rooms: Room[];
  templates: MapTemplate[];
  showAdminLink: boolean;
  showRoomsLink: boolean;
}) {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Grovina" className="h-6 w-6 object-contain" />
          <span className="text-sm font-bold text-slate-800">マスター画面</span>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          <button
            onClick={() => setTab("dashboard")}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
              tab === "dashboard"
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            ダッシュボード
          </button>
          <button
            onClick={() => setTab("templates")}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
              tab === "templates"
                ? "bg-emerald-600 text-white"
                : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            }`}
          >
            テンプレート作成
          </button>
        </nav>

        <div className="space-y-2 border-t border-slate-200 p-3">
          {showAdminLink && (
            <Link
              href="/admin"
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              管理画面へ
            </Link>
          )}
          {showRoomsLink && (
            <Link
              href="/rooms"
              className="block w-full rounded-lg bg-slate-900 px-3 py-2 text-center text-xs font-semibold text-white hover:bg-slate-700"
            >
              ルームへ
            </Link>
          )}
          <LogoutButton className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50" />
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50 p-6">
        {tab === "dashboard" && (
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <p className="text-xs font-semibold text-slate-500">
                  登録者数(管理者+ゲスト)
                </p>
                <p className="mt-1 text-3xl font-bold text-slate-800">
                  {totalProfiles}人
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <p className="text-xs font-semibold text-slate-500">
                  サブスク合計金額/月(概算)
                </p>
                <p className="mt-1 text-3xl font-bold text-slate-800">
                  ¥{subscriptionTotalYen.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <p className="mb-2 text-xs font-semibold text-slate-500">
                プランごとの登録者数(管理者のみ)
              </p>
              <ul className="space-y-1 text-sm text-slate-700">
                {(Object.keys(PLANS) as PlanId[])
                  .filter((plan) => plan !== "master")
                  .map((plan) => (
                    <li key={plan} className="flex justify-between">
                      <span>
                        {PLANS[plan].label} {PLANS[plan].subLabel}
                      </span>
                      <span>{planCounts[plan] ?? 0}件</span>
                    </li>
                  ))}
              </ul>
            </div>

            <MasterOnlineStats rooms={rooms} />
          </div>
        )}

        {tab === "templates" && (
          <div className="rounded-xl bg-emerald-50/50 p-4">
            <TemplateManager templates={templates} />
          </div>
        )}
      </main>
    </div>
  );
}
