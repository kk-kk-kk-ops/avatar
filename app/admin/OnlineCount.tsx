"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PRESENCE_STATUS_COLORS, type PlayerState, type Room } from "@/lib/types";
import { kickParticipant, unbanParticipant } from "./actions";

type BannedParticipant = {
  userId: string;
  displayName: string | null;
  bannedAt: string;
};

// 各ルームのRealtimeチャンネルにpresenceだけ覗きに行き、現在入室中の
// 参加者名一覧を表示する。ルームは仕様上1アカウントにつき1つのみのため
// 「どのルームに何人」ではなく「今誰が入室しているか」だけを表示する。
// 自分自身はtrack()しない(観測者としてカウントに含めない)。
export default function OnlineCount({
  rooms,
  bannedParticipants,
}: {
  rooms: Room[];
  bannedParticipants: BannedParticipant[];
}) {
  const [entriesByRoom, setEntriesByRoom] = useState<
    Record<string, PlayerState[]>
  >({});
  // 強制退出ボタンを押してからサーバーの応答が返るまでの間、二重送信を
  // 防ぐために対象の参加者IDだけボタンを無効化する。
  const [kickingId, setKickingId] = useState<string | null>(null);
  const [kickError, setKickError] = useState<string | null>(null);
  const [unbanningUserId, setUnbanningUserId] = useState<string | null>(null);
  const [unbanError, setUnbanError] = useState<string | null>(null);

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
    if (
      !window.confirm(
        `${player.name}さんを強制退出させ、管理者が解除するまで再入室できないようにします。よろしいですか?`,
      )
    )
      return;
    setKickError(null);
    setKickingId(player.id);
    const result = await kickParticipant(roomId, player.id, player.userId ?? null);
    setKickingId(null);
    if (!result.ok) setKickError(result.error);
  };

  const handleUnban = async (participant: BannedParticipant) => {
    setUnbanError(null);
    setUnbanningUserId(participant.userId);
    const result = await unbanParticipant(participant.userId);
    setUnbanningUserId(null);
    if (!result.ok) setUnbanError(result.error);
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

      {bannedParticipants.length > 0 && (
        <div className="mt-6 border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold text-slate-500">
            強制退出させた参加者(再入室不可)
          </p>
          {unbanError && (
            <p className="mt-2 text-xs text-red-600">{unbanError}</p>
          )}
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {bannedParticipants.map((participant) => (
              <li key={participant.userId} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {participant.displayName ?? "(名前未設定)"}
                </span>
                <button
                  type="button"
                  onClick={() => handleUnban(participant)}
                  disabled={unbanningUserId === participant.userId}
                  className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {unbanningUserId === participant.userId
                    ? "処理中..."
                    : "解除"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
