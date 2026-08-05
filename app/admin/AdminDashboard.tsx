"use client";

import { useState } from "react";
import Link from "next/link";
import type { PlanId, Room } from "@/lib/types";
import LogoutButton from "@/components/auth/LogoutButton";
import OnlineCount from "./OnlineCount";
import RoomManager from "./RoomManager";
import InvitePanel from "./InvitePanel";
import BillingPanel from "./BillingPanel";

type Tab = "dashboard" | "rooms" | "invite" | "billing";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "ダッシュボード" },
  { id: "rooms", label: "ルーム管理" },
  { id: "invite", label: "招待" },
  { id: "billing", label: "契約情報" },
];

type TemplateOption = { id: string; name: string; backgroundImageUrl: string };

export default function AdminDashboard({
  accountName,
  rooms,
  plan,
  maxRooms,
  trialEndsAt,
  inviteToken,
  inviterName,
  templates,
  showMasterLink,
}: {
  accountName: string;
  rooms: Room[];
  plan: PlanId;
  maxRooms: number;
  trialEndsAt: string | null;
  inviteToken: string;
  inviterName: string;
  templates: TemplateOption[];
  showMasterLink: boolean;
}) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const selectTab = (t: Tab) => {
    setTab(t);
    setSidebarOpen(false);
  };

  return (
    <div className="flex min-h-screen">
      {/* スマホ用ヘッダー: サイドバーは画面外に隠れているので、開くための
          ハンバーガーボタンをここに置く(md以上では常時表示のサイドバー
          側にロゴ・名前があるのでこちらは非表示にする)。 */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Grovina" className="h-6 w-6 shrink-0 object-contain" />
          <span className="truncate text-sm font-bold text-slate-800">
            {accountName}
          </span>
        </div>
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label="メニューを開く"
          className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-base"
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
        className={`fixed inset-y-0 left-0 z-50 flex w-56 shrink-0 -translate-x-full flex-col border-r border-slate-200 bg-white transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : ""
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-4">
          <div className="flex min-w-0 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Grovina" className="h-6 w-6 shrink-0 object-contain" />
            <span className="truncate text-sm font-bold text-slate-800">
              {accountName}
            </span>
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
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => selectTab(t.id)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
                tab === t.id
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="space-y-2 border-t border-slate-200 p-3">
          {showMasterLink && (
            <Link
              href="/master"
              className="block w-full rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-center text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              マスター画面へ
            </Link>
          )}
          <Link
            href="/rooms"
            className="block w-full rounded-lg bg-slate-900 px-3 py-2 text-center text-xs font-semibold text-white hover:bg-slate-700"
          >
            ルームへ
          </Link>
          <LogoutButton className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50" />
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50 p-6 pt-20 md:pt-6">
        <div className="mx-auto max-w-3xl">
          {tab === "dashboard" && <OnlineCount rooms={rooms} />}
          {tab === "rooms" && (
            <RoomManager rooms={rooms} maxRooms={maxRooms} templates={templates} />
          )}
          {tab === "invite" && (
            <InvitePanel inviteToken={inviteToken} inviterName={inviterName} />
          )}
          {tab === "billing" && (
            <BillingPanel plan={plan} trialEndsAt={trialEndsAt} />
          )}
        </div>
      </main>
    </div>
  );
}
