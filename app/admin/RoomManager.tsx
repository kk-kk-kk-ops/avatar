"use client";

import { useState, useTransition } from "react";
import type { Room } from "@/lib/types";
import ConfirmModal from "@/components/ConfirmModal";
import { addRoom, deleteRoom, renameRoom } from "./actions";

type TemplateOption = { id: string; name: string; backgroundImageUrl: string };

// どの操作が進行中かを個別に表示するため、useTransitionのpending
// フラグだけでなく「どのルームの何をしているか」も保持する。
type PendingAction =
  | { type: "add" }
  | { type: "rename"; roomId: string }
  | { type: "delete"; roomId: string };

export default function RoomManager({
  rooms,
  maxRooms,
  templates,
}: {
  rooms: Room[];
  maxRooms: number;
  templates: TemplateOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Room | null>(null);
  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null;

  const handleAdd = () => {
    setError(null);
    setPendingAction({ type: "add" });
    startTransition(async () => {
      try {
        await addRoom(templateId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "ルームの作成に失敗しました");
      } finally {
        setPendingAction(null);
      }
    });
  };

  const handleDelete = (roomId: string) => {
    setError(null);
    setPendingAction({ type: "delete", roomId });
    startTransition(async () => {
      try {
        await deleteRoom(roomId);
        setDeleteTarget(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "ルームの削除に失敗しました");
      } finally {
        setPendingAction(null);
      }
    });
  };

  const startRename = (room: Room) => {
    setRenamingId(room.id);
    setRenameValue(room.name);
  };

  const submitRename = (roomId: string) => {
    setError(null);
    setPendingAction({ type: "rename", roomId });
    startTransition(async () => {
      try {
        await renameRoom(roomId, renameValue);
        setRenamingId(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "ルーム名の変更に失敗しました");
      } finally {
        setPendingAction(null);
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
                    disabled={pending}
                    className="w-full rounded border border-slate-300 px-1.5 py-1 text-xs outline-none focus:border-slate-500 disabled:opacity-60"
                  />
                  <button
                    onClick={() => submitRename(room.id)}
                    disabled={pending}
                    className="shrink-0 rounded bg-slate-900 px-2 text-xs text-white disabled:opacity-60"
                  >
                    {pendingAction?.type === "rename" &&
                    pendingAction.roomId === room.id
                      ? "保存中..."
                      : "保存"}
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
                      disabled={pending}
                      className="text-[10px] text-slate-500 hover:text-slate-800 disabled:opacity-60"
                    >
                      名前変更
                    </button>
                    <button
                      onClick={() => setDeleteTarget(room)}
                      disabled={pending}
                      className="text-[10px] text-red-500 hover:text-red-700 disabled:opacity-60"
                    >
                      {pendingAction?.type === "delete" &&
                      pendingAction.roomId === room.id
                        ? "削除中..."
                        : "削除"}
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
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {selectedTemplate && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={selectedTemplate.backgroundImageUrl}
              alt={selectedTemplate.name}
              className="mt-2 aspect-video w-full rounded-lg border border-slate-200 object-cover"
            />
          )}
        </div>
        <button
          onClick={handleAdd}
          disabled={pending || rooms.length >= maxRooms || templates.length === 0}
          className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          {pendingAction?.type === "add" ? "追加中..." : "➕ ルーム追加"}
        </button>
      </div>

      {deleteTarget && (
        <ConfirmModal
          title="ルームを削除"
          message={`「${deleteTarget.name}」を削除します。この操作は取り消せません。よろしいですか?`}
          pending={
            pendingAction?.type === "delete" &&
            pendingAction.roomId === deleteTarget.id
          }
          onConfirm={() => handleDelete(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
