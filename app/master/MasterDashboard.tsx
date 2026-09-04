"use client";

import { useState } from "react";
import Link from "next/link";
import type { AccountSummary, MapTemplate, PlanId, Room } from "@/lib/types";
import { PLANS } from "@/lib/types";
import { useSessionGuard } from "@/lib/useSessionGuard";
import LogoutButton from "@/components/auth/LogoutButton";
import MasterOnlineStats from "./MasterOnlineStats";
import ServerResourceTable from "./ServerResourceTable";
import TemplateManager from "./TemplateManager";
import AvatarSettingsPanel from "./AvatarSettingsPanel";
import AccountServerAssignment from "./AccountServerAssignment";
import MfaSettingsPanel from "./MfaSettingsPanel";

type Tab = "dashboard" | "templates" | "avatar" | "accounts" | "security";

export default function MasterDashboard({
  planCounts,
  totalProfiles,
  subscriptionTotalYen,
  rooms,
  templates,
  accounts,
  showAdminLink,
  showRoomsLink,
  ownInviteToken,
  userEmail,
  avatarSizePx,
}: {
  planCounts: Record<PlanId, number>;
  totalProfiles: number;
  subscriptionTotalYen: number;
  rooms: Room[];
  templates: MapTemplate[];
  accounts: AccountSummary[];
  showAdminLink: boolean;
  showRoomsLink: boolean;
  ownInviteToken: string | null;
  userEmail: string;
  avatarSizePx: number;
}) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 多重ログイン検知(2026-09追加。手順9)。別のタブ/デバイスで同じ
  // アカウントが後からログインしてきた場合、このマスター画面セッションを
  // 強制ログアウトさせる。
  useSessionGuard();

  const selectTab = (t: Tab) => {
    setTab(t);
    setSidebarOpen(false);
  };

  return (
    <div className="flex min-h-screen">
      {/* スマホ用ヘッダー */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3 md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Globy" className="h-4 w-4 object-contain" />
          </div>
          <span className="truncate text-sm font-bold text-white">Globy</span>
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
        className={`fixed inset-y-0 right-0 z-50 flex w-56 shrink-0 flex-col border-l border-slate-800 bg-slate-900 transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between gap-2 border-b border-slate-800 px-4 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="Globy" className="h-4 w-4 object-contain" />
              </div>
              <span className="truncate text-sm font-bold text-white">Globy</span>
            </div>
            <p className="mt-1 truncate pl-8 text-xs text-slate-400">{userEmail}</p>
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
            テンプレート
          </button>
          <button
            onClick={() => selectTab("avatar")}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
              tab === "avatar"
                ? "bg-red-600 text-white"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            アバター
          </button>
          <button
            onClick={() => selectTab("accounts")}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
              tab === "accounts"
                ? "bg-red-600 text-white"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            アカウント
          </button>
          <button
            onClick={() => selectTab("security")}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
              tab === "security"
                ? "bg-red-600 text-white"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            セキュリティ
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
          {showRoomsLink && ownInviteToken && (
            <Link
              // 通常の"/"はログイン済みマスターを/masterへ戻してしまうため、
              // 自分自身の招待URL経由でルーム入室画面へ進む(F-3)。
              href={`/?invite=${ownInviteToken}`}
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
                {(Object.keys(PLANS) as PlanId[]).map((plan) => (
                    <li key={plan} className="flex justify-between">
                      <span>{PLANS[plan].label}</span>
                      <span>{planCounts[plan] ?? 0}件</span>
                    </li>
                  ))}
              </ul>
            </div>

            <MasterOnlineStats rooms={rooms} />

            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <ServerResourceTable />
            </div>
          </div>
        )}

        {tab === "templates" && (
          <TemplateManager templates={templates} avatarSizePx={avatarSizePx} />
        )}

        {tab === "avatar" && (
          <AvatarSettingsPanel initialSizePx={avatarSizePx} />
        )}

        {tab === "accounts" && (
          <AccountServerAssignment accounts={accounts} />
        )}

        {tab === "security" && <MfaSettingsPanel />}
      </main>
    </div>
  );
}
