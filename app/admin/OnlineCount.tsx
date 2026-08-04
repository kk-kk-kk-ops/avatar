"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Room } from "@/lib/types";

// 各ルームのRealtimeチャンネルにpresenceだけ覗きに行き、オンライン人数を
// 合算する。自分自身はtrack()しない(観測者としてカウントに含めない)。
export default function OnlineCount({ rooms }: { rooms: Room[] }) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (rooms.length === 0) return;
    const supabase = createClient();
    const channels = rooms.map((room) => {
      const channel = supabase.channel(`avatar-room-${room.name}`, {
        config: { presence: { key: `observer-${crypto.randomUUID()}` } },
      });
      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState();
          setCounts((prev) => ({
            ...prev,
            [room.id]: Object.keys(state).length,
          }));
        })
        .subscribe();
      return channel;
    });

    return () => {
      channels.forEach((channel) => supabase.removeChannel(channel));
    };
  }, [rooms]);

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return (
    <div className="rounded-xl border border-slate-200 p-6">
      <p className="text-xs font-semibold text-slate-500">オンライン人数</p>
      <p className="mt-1 text-3xl font-bold text-slate-800">{total}人</p>
      {rooms.length > 0 && (
        <ul className="mt-4 space-y-1 text-xs text-slate-500">
          {rooms.map((room) => (
            <li key={room.id} className="flex justify-between">
              <span>{room.name}</span>
              <span>{counts[room.id] ?? 0}人</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
