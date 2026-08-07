"use client";

import { useState, useTransition } from "react";
import { updateAvatarSize } from "./actions";

// アバターの表示サイズ(px)を編集する。正方形前提なので入力は1つだけ
// (例: 20と入力すると20×20になる)。pxを変更すると即座にプレビューへ
// 反映され、実際に保存するまでは他の画面には影響しない。
export default function AvatarSettingsPanel({
  initialSizePx,
}: {
  initialSizePx: number;
}) {
  const [sizeInput, setSizeInput] = useState(String(initialSizePx));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const previewSize = Math.min(
    200,
    Math.max(1, Number(sizeInput) || 0),
  );

  const handleSave = () => {
    setError(null);
    setSaved(false);
    const sizePx = Number(sizeInput);
    if (!Number.isFinite(sizePx) || sizePx < 8 || sizePx > 200) {
      setError("8〜200pxの範囲で入力してください");
      return;
    }
    startTransition(async () => {
      const result = await updateAvatarSize(sizePx);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <div className="max-w-sm">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-xs font-semibold text-slate-500">
          アバターの表示サイズ(正方形)
        </p>
        <div className="mb-4 flex items-center gap-2">
          <input
            type="number"
            step={1}
            value={sizeInput}
            onChange={(e) => setSizeInput(e.target.value)}
            className="w-24 rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500"
          />
          <span className="text-xs text-slate-400">px</span>
        </div>

        <p className="mb-2 text-xs font-semibold text-slate-500">プレビュー</p>
        <div className="mb-4 flex h-40 items-center justify-center rounded-lg bg-slate-700">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/avatar/goo/front.png"
            alt="アバタープレビュー"
            className="object-contain"
            style={{ width: previewSize, height: previewSize }}
          />
        </div>

        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </p>
        )}

        <button
          onClick={handleSave}
          disabled={pending}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          {pending ? "保存中..." : saved ? "保存しました" : "保存"}
        </button>
      </div>
    </div>
  );
}
