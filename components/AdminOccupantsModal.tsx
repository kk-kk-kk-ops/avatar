"use client";

import { useLocale } from "@/lib/i18n/LocaleContext";

// 管理画面モーダル化 M-1(2026-11)。会議室画面の設定パネルから開く、
// 今いるルームの在室者一覧(閲覧専用)。強制退出等の操作は持たない。
// presenceの購読はAvatarSpace.tsx側で既に行っているものを使い、この
// コンポーネント自身はSupabaseチャンネルを一切購読しない(購読の二重化で
// 会議室側のpresenceが壊れるのを避けるため)。

export type AdminOccupant = {
  id: string;
  name: string;
  isSelf: boolean;
  micOn: boolean;
  inCall: boolean;
};

export default function AdminOccupantsModal({
  occupants,
  onClose,
}: {
  occupants: AdminOccupant[];
  onClose: () => void;
}) {
  const { t } = useLocale();

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">
            {t("room.occupantsModalTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>

        <p className="mb-3 text-xs text-slate-500">
          {t("room.occupantsModalCount", { count: String(occupants.length) })}
        </p>

        <ul className="space-y-1">
          {occupants.map((o) => (
            <li
              key={o.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"
            >
              <span className="min-w-0 truncate">
                {o.name}
                {o.isSelf && (
                  <span className="ml-1 text-xs text-slate-400">
                    {t("room.occupantsModalSelfTag")}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-400">
                {o.micOn && <span title={t("settings.micLabel")}>🎤</span>}
                {o.inCall && (
                  <span title={t("room.occupantsModalInCallTag")}>📹</span>
                )}
              </span>
            </li>
          ))}
          {occupants.length === 0 && (
            <li className="py-4 text-center text-xs text-slate-400">
              {t("room.occupantsModalEmpty")}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
