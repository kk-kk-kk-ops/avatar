"use client";

import { useState, useTransition } from "react";
import type { MapTemplate } from "@/lib/types";
import { createTemplate, deleteTemplate } from "./actions";
import { uploadTemplateImageClient } from "./uploadTemplateImage";
import TemplateEditor from "./TemplateEditor";

export default function TemplateManager({
  templates,
}: {
  templates: MapTemplate[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = templates.find((t) => t.id === editingId) ?? null;

  const handleCreate = () => {
    setError(null);
    if (!name.trim() || !file) {
      setError("テンプレート名と背景画像を入力してください");
      return;
    }
    startTransition(async () => {
      try {
        const backgroundImageUrl = await uploadTemplateImageClient(file);
        await createTemplate(name.trim(), backgroundImageUrl);
        setName("");
        setFile(null);
        setCreating(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "作成に失敗しました");
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!window.confirm("このテンプレートを削除します。よろしいですか?")) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteTemplate(id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "削除に失敗しました");
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
                  className="text-[10px] text-slate-500 hover:text-slate-800"
                >
                  編集
                </button>
                <button
                  onClick={() => handleDelete(t.id)}
                  disabled={pending}
                  className="text-[10px] text-red-500 hover:text-red-700"
                >
                  削除
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {creating ? (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
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
            className="w-full text-xs"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={pending}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              作成
            </button>
            <button
              onClick={() => setCreating(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          ＋ 新規テンプレート作成
        </button>
      )}
    </div>
  );
}
