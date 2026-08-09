"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PRESENCE_STATUS_COLORS, type PlayerState, type Room } from "@/lib/types";
import { kickParticipant } from "./actions";

// 各ルームのRealtimeチャンネルにpresenceだけ覗きに行き、現在入室中の
// 参加者名一覧を表示する。ルームは仕様上1アカウントにつき1つのみのため
// 「どのルームに何人」ではなく「今誰が入室しているか」だけを表示する。
// 自分自身はtrack()しない(観測者としてカウントに含めない)。
export default function OnlineCount({ rooms }: { rooms: Room[] }) {
  const [entriesByRoom, setEntriesByRoom] = useState<
    Record<string, PlayerState[]>
  >({});
  // 強制退出ボタンを押してからサーバーの応答が返るまでの間、二重送信を
  // 防ぐために対象の参加者IDだけボタンを無効化する。
  const [kickingId, setKickingId] = useState<string | null>(null);
  const [kickError, setKickError] = useState<string | null>(null);

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

  const participants = Object.entries(entriesByRoom).flatMap(
    ([roomId, list]) => list.map((player) => ({ roomId, player })),
  );

  const handleKick = async (roomId: string, player: PlayerState) => {
    if (!window.confirm(`${player.name}さんを強制的に退出させますか?`)) return;
    setKickError(null);
    setKickingId(player.id);
    const result = await kickParticipant(roomId, player.id);
    setKickingId(null);
    if (!result.ok) setKickError(result.error);
  };

  return (
    <div className="rounded-xl border border-slate-200 p-6">
      <p className="text-xs font-semibold text-slate-500">オンライン人数</p>
      <p className="mt-1 text-3xl font-bold text-slate-800">
        {participants.length}人
      </p>
      {kickError && (
        <p className="mt-2 text-xs text-red-600">{kickError}</p>
      )}
      {participants.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm text-slate-700">
          {participants.map(({ roomId, player }) => (
            <li key={player.id} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor:
                    PRESENCE_STATUS_COLORS[player.status ?? "available"],
                }}
              />
              <span className="min-w-0 flex-1 truncate">{player.name}</span>
              <button
                type="button"
                onClick={() => handleKick(roomId, player)}
                disabled={kickingId === player.id}
                className="shrink-0 rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {kickingId === player.id ? "処理中..." : "強制退出"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
