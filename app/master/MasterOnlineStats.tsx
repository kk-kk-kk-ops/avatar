"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PlayerState, Room } from "@/lib/types";

type Stats = {
  total: number;
  mic: number;
  video: number;
  screen: number;
  watching: number;
};

const EMPTY: Stats = { total: 0, mic: 0, video: 0, screen: 0, watching: 0 };

// マスター向けのオンライン人数表示。ルームごとの内訳は不要とのことなので
// 合計のみ表示し、代わりに通信量把握のためマイク・ビデオ通話・画面共有を
// それぞれ何人が使っているかを表示する。
export default function MasterOnlineStats({ rooms }: { rooms: Room[] }) {
  const [stats, setStats] = useState<Stats>(EMPTY);

  useEffect(() => {
    if (rooms.length === 0) {
      setStats(EMPTY);
      return;
    }
    const supabase = createClient();
    const perRoomStats = new Map<string, Stats>();

    const recomputeTotal = () => {
      const totals = { ...EMPTY };
      perRoomStats.forEach((s) => {
        totals.total += s.total;
        totals.mic += s.mic;
        totals.video += s.video;
        totals.screen += s.screen;
        totals.watching += s.watching;
      });
      setStats(totals);
    };

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
          perRoomStats.set(room.id, {
            total: entries.length,
            mic: entries.filter((p) => p.micOn).length,
            video: entries.filter((p) => p.inCall).length,
            screen: entries.filter((p) => p.sharingScreen).length,
            watching: entries.filter((p) => p.watchingScreen).length,
          });
          recomputeTotal();
        })
        .subscribe();
      return channel;
    });

    return () => {
      channels.forEach((channel) => supabase.removeChannel(channel));
    };
  }, [rooms]);

  return (
    <div className="rounded-xl border border-slate-200 p-6">
      <p className="text-xs font-semibold text-slate-500">オンライン人数</p>
      <p className="mt-1 text-3xl font-bold text-slate-800">{stats.total}人</p>
      <div className="mt-4 grid grid-cols-4 gap-3 border-t border-slate-100 pt-4 text-center">
        <div>
          <p className="text-lg font-bold text-slate-800">{stats.mic}人</p>
          <p className="text-[11px] text-slate-500">音声通話中</p>
        </div>
        <div>
          <p className="text-lg font-bold text-slate-800">{stats.video}人</p>
          <p className="text-[11px] text-slate-500">ビデオ通話中</p>
        </div>
        <div>
          <p className="text-lg font-bold text-slate-800">{stats.screen}人</p>
          <p className="text-[11px] text-slate-500">画面共有中</p>
        </div>
        <div>
          <p className="text-lg font-bold text-slate-800">{stats.watching}人</p>
          <p className="text-[11px] text-slate-500">画面共有視聴中</p>
        </div>
      </div>
    </div>
  );
}
