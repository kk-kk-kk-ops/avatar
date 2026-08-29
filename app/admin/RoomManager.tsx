"use client";

import { useState, useTransition } from "react";
import type { Room } from "@/lib/types";
import ConfirmModal from "@/components/ConfirmModal";
import { addRoom, deleteRoom, renameRoom, updateRoomTemplate } from "./actions";

type RoomDesignOption = {
  id: string;
  name: string;
  backgroundImageUrl: string;
};

// どの操作が進行中かを個別に表示するため、useTransitionのpending
// フラグだけでなく「どのルームの何をしているか」も保持する。
type PendingAction =
  | { type: "apply" }
  | { type: "rename"; roomId: string }
  | { type: "delete"; roomId: string };

export default function RoomManager({
  rooms,
  maxRooms,
  templates,
}: {
  rooms: Room[];
  maxRooms: number;
  templates: RoomDesignOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  // 既存ルームがあれば、現在紐づいているデザインを初期選択にする。
  const existingRoom = rooms[0] ?? null;
  const [selectedDesignId, setSelectedDesignId] = useState(
    existingRoom?.templateId ?? templates[0]?.id ?? "",
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Room | null>(null);

  const handleApply = () => {
    setError(null);
    setApplied(false);
    setPendingAction({ type: "apply" });
    startTransition(async () => {
      try {
        if (existingRoom) {
          await updateRoomTemplate(existingRoom.id, selectedDesignId);
        } else {
          await addRoom(selectedDesignId);
        }
        setApplied(true);
        setTimeout(() => setApplied(false), 2000);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "ルームデザインの適用に失敗しました",
        );
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
        <p className="text-xs text-slate-500">現在適用中ルーム</p>
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

      <div>
        <p className="mb-2 text-xs font-semibold text-slate-500">
          ルームデザイン
        </p>

        {templates.length === 0 ? (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            利用できるルームデザインがまだありません。マスター画面で作成してください。
          </p>
        ) : (
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {templates.map((t) => {
              // 現在ルームに適用されているデザインかどうか(選択中かとは
              // 別の概念)。適用中のものはボタンを押しても意味がないため
              // グレーアウトして押せないようにする。
              const isApplying = pendingAction?.type === "apply";
              const isCurrentlyApplied =
                existingRoom?.templateId === t.id && !isApplying && !applied;

              return (
                <div
                  key={t.id}
                  className={`relative overflow-hidden rounded-lg border-2 bg-slate-100 transition-colors ${
                    selectedDesignId === t.id
                      ? "border-emerald-500"
                      : "border-transparent hover:border-slate-300"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedDesignId(t.id)}
                    disabled={pending}
                    className="block w-full text-left disabled:opacity-60"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={t.backgroundImageUrl}
                      alt={t.name}
                      className="aspect-video w-full object-cover"
                    />
                    <p className="truncate px-2 py-1.5 text-xs font-semibold text-slate-700">
                      {t.name}
                    </p>
                  </button>
                  {/* このカードを選んでいる間だけ右下に表示する。他のカードを
                      選ぶとselectedDesignIdが変わるので自動的に隠れる。 */}
                  {selectedDesignId === t.id && (
                    <button
                      type="button"
                      onClick={handleApply}
                      disabled={
                        pending ||
                        isCurrentlyApplied ||
                        (!existingRoom && rooms.length >= maxRooms)
                      }
                      className={`absolute bottom-1.5 right-1.5 rounded px-2 py-1 text-[10px] font-semibold shadow disabled:cursor-not-allowed ${
                        isCurrentlyApplied
                          ? "bg-slate-300 text-slate-600"
                          : "bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-60"
                      }`}
                    >
                      {isApplying
                        ? existingRoom
                          ? "変更中..."
                          : "作成中..."
                        : applied
                          ? "適用しました"
                          : isCurrentlyApplied
                            ? "適用中"
                            : existingRoom
                              ? "変更"
                              : "作成"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
