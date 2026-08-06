"use client";

import { useState, useTransition } from "react";
import type { MapTemplate } from "@/lib/types";
import ConfirmModal from "@/components/ConfirmModal";
import { createTemplate, deleteTemplate } from "./actions";
import { uploadTemplateImageClient } from "./uploadTemplateImage";
import TemplateEditor from "./TemplateEditor";

// どの操作が進行中かを個別に表示するため、useTransitionのpendingフラグ
// だけでなく「どのテンプレートの何をしているか」も保持する。
type PendingAction = { type: "create" } | { type: "delete"; id: string };

export default function TemplateManager({
  templates,
}: {
  templates: MapTemplate[];
}) {
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MapTemplate | null>(null);

  const editing = templates.find((t) => t.id === editingId) ?? null;

  const handleCreate = () => {
    setError(null);
    if (!name.trim() || !file) {
      setError("テンプレート名と背景画像を入力してください");
      return;
    }
    setPendingAction({ type: "create" });
    startTransition(async () => {
      try {
        const backgroundImageUrl = await uploadTemplateImageClient(file);
        await createTemplate(name.trim(), backgroundImageUrl);
        setName("");
        setFile(null);
        setCreating(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "作成に失敗しました");
      } finally {
        setPendingAction(null);
      }
    });
  };

  const handleDelete = (id: string) => {
    setError(null);
    setPendingAction({ type: "delete", id });
    startTransition(async () => {
      try {
        await deleteTemplate(id);
        setDeleteTarget(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "削除に失敗しました");
      } finally {
        setPendingAction(null);
      }
    });
  };

  if (editing) {
    return (
      <TemplateEditor template={editing} onClose={() => setEditingId(null)} />
    );
  }

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      {creating ? (
        <div className="mb-6 space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="テンプレート名"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={pending}
            className="w-full text-xs disabled:opacity-60"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={pending}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {pendingAction?.type === "create" ? "作成中..." : "作成"}
            </button>
            <button
              onClick={() => setCreating(false)}
              disabled={pending}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="mb-6 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          ＋ 新規テンプレート作成
        </button>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {templates.map((t) => (
          <div
            key={t.id}
            className="overflow-hidden rounded-lg border border-slate-200 bg-white"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={t.backgroundImageUrl}
              alt={t.name}
              className="aspect-video w-full object-cover"
            />
            <div className="p-2">
              <p className="truncate text-xs font-semibold text-slate-700">
                {t.name}
              </p>
              <div className="mt-1 flex gap-2">
                <button
                  onClick={() => setEditingId(t.id)}
                  disabled={pending}
                  className="text-[10px] text-slate-500 hover:text-slate-800 disabled:opacity-60"
                >
                  編集
                </button>
                <button
                  onClick={() => setDeleteTarget(t)}
                  disabled={pending}
                  className="text-[10px] text-red-500 hover:text-red-700 disabled:opacity-60"
                >
                  {pendingAction?.type === "delete" && pendingAction.id === t.id
                    ? "削除中..."
                    : "削除"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {deleteTarget && (
        <ConfirmModal
          title="テンプレートを削除"
          message={`「${deleteTarget.name}」を削除します。この操作は取り消せません。よろしいですか?`}
          pending={
            pendingAction?.type === "delete" &&
            pendingAction.id === deleteTarget.id
          }
          onConfirm={() => handleDelete(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
