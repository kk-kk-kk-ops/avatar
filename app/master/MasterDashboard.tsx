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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const selectTab = (t: Tab) => {
    setTab(t);
    setSidebarOpen(false);
  };

  return (
    <div className="flex min-h-screen">
      {/* スマホ用ヘッダー */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3 md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Globy" className="h-6 w-6 shrink-0 object-contain" />
          <span className="truncate text-sm font-bold text-white">マスター画面</span>
        </div>
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label="メニューを開く"
          className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-base text-slate-200"
        >
          ☰
        </button>
      </div>

      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-56 shrink-0 -translate-x-full flex-col border-r border-slate-800 bg-slate-900 transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : ""
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-4">
          <div className="flex min-w-0 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Globy" className="h-6 w-6 shrink-0 object-contain" />
            <span className="truncate text-sm font-bold text-white">マスター画面</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            aria-label="メニューを閉じる"
            className="shrink-0 text-lg text-slate-400 md:hidden"
          >
            ×
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          <button
            onClick={() => selectTab("dashboard")}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
              tab === "dashboard"
                ? "bg-red-600 text-white"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            ダッシュボード
          </button>
          <button
            onClick={() => selectTab("templates")}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
              tab === "templates"
                ? "bg-red-600 text-white"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            テンプレート作成
          </button>
        </nav>

        <div className="space-y-2 border-t border-slate-800 p-3">
          {showAdminLink && (
            <Link
              href="/admin"
              className="block w-full rounded-lg border border-slate-700 px-3 py-2 text-center text-xs font-semibold text-slate-200 hover:bg-slate-800"
            >
              管理画面へ
            </Link>
          )}
          {showRoomsLink && (
            <Link
              href="/rooms"
              className="block w-full rounded-lg border border-slate-700 px-3 py-2 text-center text-xs font-semibold text-slate-200 hover:bg-slate-800"
            >
              ルームへ
            </Link>
          )}
          <LogoutButton className="w-full rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800" />
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50 p-6 pt-20 md:pt-6">
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

        {tab === "templates" && <TemplateManager templates={templates} />}
      </main>
    </div>
  );
}
