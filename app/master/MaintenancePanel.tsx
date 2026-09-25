"use client";

import { useEffect, useState, useTransition } from "react";
import {
  isMaintenanceActive,
  type MaintenanceSettings,
} from "@/lib/types";
import { updateMaintenanceWindow, setMaintenanceEnabled } from "./maintenanceActions";

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

// チェックボックスの見た目上のON/OFF。maintenance_enabledがtrueでも、
// 終了日時を過ぎれば自動的にOFFに見せる(2026-09の要望: 期間終了後は
// 自動的にチェックを外したい、という仕様をDBの書き戻し無しで満たす)。
function isEffectivelyEnabled(m: MaintenanceSettings): boolean {
  if (!m.enabled) return false;
  if (!m.endsAt) return true;
  return Date.now() <= new Date(m.endsAt).getTime();
}

export default function MaintenancePanel({
  maintenance,
}: {
  maintenance: MaintenanceSettings;
}) {
  const [startsInput, setStartsInput] = useState(
    toDatetimeLocalValue(maintenance.startsAt),
  );
  const [endsInput, setEndsInput] = useState(
    toDatetimeLocalValue(maintenance.endsAt),
  );
  // サーバー側の値が変わった(自分の保存・他タブでの変更の反映等)ら
  // 入力欄も追従させる。
  useEffect(() => {
    setStartsInput(toDatetimeLocalValue(maintenance.startsAt));
    setEndsInput(toDatetimeLocalValue(maintenance.endsAt));
  }, [maintenance.startsAt, maintenance.endsAt]);

  const [windowError, setWindowError] = useState<string | null>(null);
  const [windowPending, startWindowTransition] = useTransition();

  const [toggleError, setToggleError] = useState<string | null>(null);
  const [togglePending, startToggleTransition] = useTransition();
  // 確認ポップアップで次にする値(true=ONにする確認、false=OFFにする確認)。
  // nullなら非表示。
  const [confirmTarget, setConfirmTarget] = useState<boolean | null>(null);

  const handleSaveWindow = () => {
    setWindowError(null);
    if (!startsInput || !endsInput) {
      setWindowError("開始・終了日時を入力してください");
      return;
    }
    startWindowTransition(async () => {
      const result = await updateMaintenanceWindow(
        new Date(startsInput).toISOString(),
        new Date(endsInput).toISOString(),
      );
      if (!result.ok) setWindowError(result.error);
    });
  };

  const handleConfirmToggle = () => {
    if (confirmTarget === null) return;
    setToggleError(null);
    const target = confirmTarget;
    startToggleTransition(async () => {
      const result = await setMaintenanceEnabled(target);
      if (!result.ok) setToggleError(result.error);
      setConfirmTarget(null);
    });
  };

  const effectivelyEnabled = isEffectivelyEnabled(maintenance);
  const currentlyActive = isMaintenanceActive(maintenance);

  return (
    <div className="max-w-md space-y-4">
      <div>
        <label className="mb-1 block text-[11px] font-semibold text-slate-500">
          開始日時
        </label>
        <input
          type="datetime-local"
          value={startsInput}
          onChange={(e) => setStartsInput(e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500"
        />
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-semibold text-slate-500">
          終了日時
        </label>
        <input
          type="datetime-local"
          value={endsInput}
          onChange={(e) => setEndsInput(e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500"
        />
      </div>

      {windowError && (
        <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">
          {windowError}
        </p>
      )}

      <button
        onClick={handleSaveWindow}
        disabled={windowPending}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
      >
        {windowPending ? "保存中..." : "保存する"}
      </button>

      <div className="border-t border-slate-200 pt-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={effectivelyEnabled}
            disabled={togglePending}
            onChange={() => setConfirmTarget(!effectivelyEnabled)}
          />
          メンテナンス予告を表示する
        </label>
        {currentlyActive && (
          <p className="mt-1 text-xs text-red-600">
            現在メンテナンス期間中です(マスター以外は入室・管理画面への
            アクセスができません)。
          </p>
        )}
        {toggleError && (
          <p className="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">
            {toggleError}
          </p>
        )}
      </div>

      {confirmTarget !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <p className="text-sm font-bold text-slate-800">
              {confirmTarget
                ? "オンにしますか?メンテナンス期間が表示されます"
                : "メンテナンス表示が非表示になってしまいますがよろしいですか?"}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={handleConfirmToggle}
                disabled={togglePending}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {togglePending ? "処理中..." : "はい"}
              </button>
              <button
                onClick={() => setConfirmTarget(null)}
                disabled={togglePending}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                いいえ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
