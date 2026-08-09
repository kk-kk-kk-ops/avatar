"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PRESENCE_STATUS_COLORS, type PlayerState, type Room } from "@/lib/types";

// 各ルームのRealtimeチャンネルにpresenceだけ覗きに行き、現在入室中の
// 参加者名一覧を表示する。ルームは仕様上1アカウントにつき1つのみのため
// 「どのルームに何人」ではなく「今誰が入室しているか」だけを表示する。
// 自分自身はtrack()しない(観測者としてカウントに含めない)。
export default function OnlineCount({ rooms }: { rooms: Room[] }) {
  const [entriesByRoom, setEntriesByRoom] = useState<
    Record<string, PlayerState[]>
  >({});

  useEffect(() => {
    if (rooms.length === 0) return;
    const supabase = createClient();
    const channels = rooms.map((room) => {
      const channel = supabase.channel(`avatar-room-${room.id}`, {
        config: { presence: { key: `observer-${crypto.randomUUID()}` } },
      });
      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState<PlayerState>();
          const entries = Object.values(state)
            .map((list) => list[0])
            .filter(Boolean);
          setEntriesByRoom((prev) => ({ ...prev, [room.id]: entries }));
        })
        .subscribe();
      return channel;
    });

    return () => {
      channels.forEach((channel) => supabase.removeChannel(channel));
    };
  }, [rooms]);

  const participants = Object.values(entriesByRoom).flat();

  return (
    <div className="rounded-xl border border-slate-200 p-6">
      <p className="text-xs font-semibold text-slate-500">オンライン人数</p>
      <p className="mt-1 text-3xl font-bold text-slate-800">
        {participants.length}人
      </p>
      {participants.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm text-slate-700">
          {participants.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor:
                    PRESENCE_STATUS_COLORS[p.status ?? "available"],
                }}
              />
              <span className="truncate">{p.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
