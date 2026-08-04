"use client";

import { useState } from "react";
import type { PlanId, Room } from "@/lib/types";
import { PLANS } from "@/lib/types";
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

type TemplateOption = { id: string; name: string };

export default function AdminDashboard({
  rooms,
  plan,
  trialEndsAt,
  inviteToken,
  templates,
}: {
  rooms: Room[];
  plan: PlanId;
  trialEndsAt: string | null;
  inviteToken: string;
  templates: TemplateOption[];
}) {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <div>
      <div className="mb-6 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t.id
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <OnlineCount rooms={rooms} />}
      {tab === "rooms" && (
        <RoomManager
          rooms={rooms}
          maxRooms={PLANS[plan].maxRooms}
          templates={templates}
        />
      )}
      {tab === "invite" && <InvitePanel inviteToken={inviteToken} />}
      {tab === "billing" && (
        <BillingPanel plan={plan} trialEndsAt={trialEndsAt} />
      )}
    </div>
  );
}
