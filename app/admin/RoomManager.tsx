"use client";

import { useState, useTransition } from "react";
import type { Room } from "@/lib/types";
import { addRoom, deleteRoom, renameRoom } from "./actions";
import { ROOM_TEMPLATES } from "./roomTemplates";

export default function RoomManager({
  rooms,
  maxRooms,
}: {
  rooms: Room[];
  maxRooms: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState(ROOM_TEMPLATES[0].id);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const handleAdd = () => {
    setError(null);
    startTransition(async () => {
      try {
        await addRoom(templateId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "ルームの作成に失敗しました");
      }
    });
  };

  const handleDelete = (roomId: string) => {
    if (!window.confirm("このルームを削除します。よろしいですか?")) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteRoom(roomId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "ルームの削除に失敗しました");
      }
    });
  };

  const startRename = (room: Room) => {
    setRenamingId(room.id);
    setRenameValue(room.name);
  };

  const submitRename = (roomId: string) => {
    setError(null);
    startTransition(async () => {
      try {
        await renameRoom(roomId, renameValue);
        setRenamingId(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "ルーム名の変更に失敗しました");
      }
    });
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {rooms.length} / {maxRooms} ルーム作成済み
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {rooms.map((room) => (
          <div
            key={room.id}
            className="overflow-hidden rounded-lg border border-slate-200"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={room.previewImage}
              alt={room.name}
              className="aspect-video w-full object-cover"
            />
            <div className="p-2">
              {renamingId === room.id ? (
                <div className="flex gap-1">
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && submitRename(room.id)
                    }
                    className="w-full rounded border border-slate-300 px-1.5 py-1 text-xs outline-none focus:border-slate-500"
                  />
                  <button
                    onClick={() => submitRename(room.id)}
                    disabled={pending}
                    className="shrink-0 rounded bg-slate-900 px-2 text-xs text-white"
                  >
                    保存
                  </button>
                </div>
              ) : (
                <>
                  <p className="truncate text-xs font-semibold text-slate-700">
                    {room.name}
                  </p>
                  <div className="mt-1 flex gap-2">
                    <button
                      onClick={() => startRename(room)}
                      className="text-[10px] text-slate-500 hover:text-slate-800"
                    >
                      名前変更
                    </button>
                    <button
                      onClick={() => handleDelete(room.id)}
                      disabled={pending}
                      className="text-[10px] text-red-500 hover:text-red-700"
                    >
                      削除
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-semibold text-slate-500">
            テンプレート
          </label>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          >
            {ROOM_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={handleAdd}
          disabled={pending || rooms.length >= maxRooms}
          className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          ➕ ルーム追加
        </button>
      </div>
    </div>
  );
}
