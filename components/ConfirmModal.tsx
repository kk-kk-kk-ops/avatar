"use client";

// ブラウザネイティブのconfirm()は見た目を調整できず素っ気ないため、
// 削除など取り消せない操作の確認にはこちらを使う。
export default function ConfirmModal({
  title,
  message,
  confirmLabel = "削除する",
  pending = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <p className="text-sm font-bold text-slate-800">{title}</p>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-60"
          >
            {pending ? "削除中..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
