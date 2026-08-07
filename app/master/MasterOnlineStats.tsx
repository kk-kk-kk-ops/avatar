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

// 秒数を「X時間Y分」形式に整形する(1時間未満は「Y分」のみ)。
function formatWatchDuration(totalSeconds: number): string {
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}時間${minutes}分` : `${minutes}分`;
}

// マスター向けのオンライン人数表示。ルームごとの内訳は不要とのことなので
// 合計のみ表示し、代わりに通信量把握のためマイク・ビデオ通話・画面共有を
// それぞれ何人が使っているかを表示する。
export default function MasterOnlineStats({ rooms }: { rooms: Room[] }) {
  const [stats, setStats] = useState<Stats>(EMPTY);
  const [watchSeconds, setWatchSeconds] = useState(0);

  // 画面共有の視聴累積時間(今月分)。screen_watch_statsはmonth('YYYY-MM')
  // ごとに1行しか持たないため、翌月になれば該当行が無くなり自動的に
  // 0分から始まる(=毎月1日リセット)。
  useEffect(() => {
    const supabase = createClient();
    const monthKey = new Date().toISOString().slice(0, 7);
    const fetchWatchSeconds = async () => {
      const { data, error } = await supabase
        .from("screen_watch_stats")
        .select("watch_seconds")
        .eq("month", monthKey)
        .maybeSingle();
      if (error) {
        // eslint-disable-next-line no-console
        console.error("画面共有視聴累積時間の取得に失敗しました", error);
      }
      setWatchSeconds(data?.watch_seconds ?? 0);
    };
    fetchWatchSeconds();
    const interval = setInterval(fetchWatchSeconds, 30000);
    return () => clearInterval(interval);
  }, []);

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

  // 負荷スコア: ビデオ通話は1人あたり負荷1、画面共有(発信・視聴双方)は
  // 帯域・エンコード負荷が大きいためそれぞれ1人あたり負荷10として重み付け。
  const loadScore = stats.video * 1 + stats.screen * 10 + stats.watching * 10;

  return (
    <div className="rounded-xl border border-slate-200 p-6">
      <div className="flex items-start gap-8">
        <div>
          <p className="text-xs font-semibold text-slate-500">オンライン人数</p>
          <p className="mt-1 text-3xl font-bold text-slate-800">{stats.total}人</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500">負荷スコア</p>
          <p className="mt-1 text-3xl font-bold text-slate-800">{loadScore}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-5 gap-3 border-t border-slate-100 pt-4 text-center">
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
        <div>
          <p className="text-lg font-bold text-slate-800">
            {formatWatchDuration(watchSeconds)}
          </p>
          <p className="text-[11px] text-slate-500">画面共有視聴累積時間(今月)</p>
        </div>
      </div>
    </div>
  );
}
