"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import {
  kickParticipantFromModal,
  listBannedParticipants,
  unbanParticipantFromModal,
} from "@/app/admin/actions";

// 管理画面モーダル化 M-1(2026-11)。会議室画面の設定パネルから開く、
// 今いるルームの在室者一覧。presenceの購読はAvatarSpace.tsx側で既に
// 行っているものを使い、このコンポーネント自身はSupabaseチャンネルを
// 一切購読しない(購読の二重化で会議室側のpresenceが壊れるのを避けるため)。
//
// M-2(2026-11)で強制退出・BAN解除を追加。ダッシュボード(/admin、
// app/admin/OnlineCount.tsx)と同じ処理(app/admin/actions.tsの
// performKick/performUnban)を、redirectしない別のエントリポイント
// (kickParticipantFromModal/unbanParticipantFromModal)経由で呼ぶ。

export type AdminOccupant = {
  id: string;
  name: string;
  userId: string | null;
  isSelf: boolean;
  micOn: boolean;
  inCall: boolean;
};

type BannedParticipant = {
  userId: string;
  displayName: string | null;
  bannedAt: string;
};

export default function AdminOccupantsModal({
  occupants,
  roomId,
  onClose,
}: {
  occupants: AdminOccupant[];
  roomId: string;
  onClose: () => void;
}) {
  const { t, locale } = useLocale();

  const [bannedParticipants, setBannedParticipants] = useState<
    BannedParticipant[]
  >([]);
  const [banListError, setBanListError] = useState<string | null>(null);
  const [kickingId, setKickingId] = useState<string | null>(null);
  const [kickError, setKickError] = useState<string | null>(null);
  // presenceから消えるまで数秒かかるため、強制退出が成功した相手のidを
  // 覚えておき、その間ボタンを押せないままにする(2026-11 M-2修正。
  // 一覧から行自体を消す楽観的更新はしない)。
  const [kickedIds, setKickedIds] = useState<Set<string>>(new Set());
  const [unbanningUserId, setUnbanningUserId] = useState<string | null>(null);
  const [unbanError, setUnbanError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listBannedParticipants(locale).then((result) => {
      if (cancelled) return;
      if (result.ok) setBannedParticipants(result.data);
      else setBanListError(result.error);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKick = async (occupant: AdminOccupant) => {
    if (!window.confirm(t("admin.forceLeaveConfirm", { name: occupant.name })))
      return;
    setKickError(null);
    setKickingId(occupant.id);
    const result = await kickParticipantFromModal(
      roomId,
      occupant.id,
      occupant.userId,
      locale,
    );
    setKickingId(null);
    if (!result.ok) {
      setKickError(result.error);
      return;
    }
    if (result.warning) setKickError(result.warning);
    setKickedIds((prev) => new Set(prev).add(occupant.id));

    // presenceからまだ消えていない間にBAN一覧を開き直しても反映されて
    // 見えないため、強制退出成功時にBAN一覧を読み直す(2026-11 M-2修正)。
    const refreshed = await listBannedParticipants(locale);
    if (refreshed.ok) {
      setBanListError(null);
      setBannedParticipants(refreshed.data);
    } else {
      setBanListError(refreshed.error);
    }
  };

  const handleUnban = async (participant: BannedParticipant) => {
    setUnbanError(null);
    setUnbanningUserId(participant.userId);
    const result = await unbanParticipantFromModal(participant.userId, locale);
    setUnbanningUserId(null);
    if (!result.ok) setUnbanError(result.error);
    else
      setBannedParticipants((prev) =>
        prev.filter((p) => p.userId !== participant.userId),
      );
  };

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

        {kickError && <p className="mb-2 text-xs text-red-600">{kickError}</p>}

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
                {!o.isSelf && (
                  <button
                    type="button"
                    onClick={() => handleKick(o)}
                    disabled={kickingId === o.id || kickedIds.has(o.id)}
                    className="shrink-0 rounded border border-red-200 px-2 py-0.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {kickingId === o.id
                      ? t("common.processing")
                      : t("admin.forceLeave")}
                  </button>
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

        {banListError && (
          <p className="mt-3 text-xs text-red-600">{banListError}</p>
        )}

        {bannedParticipants.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold text-slate-500">
              {t("admin.bannedParticipants")}
            </p>
            {unbanError && (
              <p className="mt-2 text-xs text-red-600">{unbanError}</p>
            )}
            <ul className="mt-2 space-y-1">
              {bannedParticipants.map((participant) => (
                <li
                  key={participant.userId}
                  className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"
                >
                  <span className="min-w-0 truncate">
                    {participant.displayName ?? t("admin.unnamed")}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleUnban(participant)}
                    disabled={unbanningUserId === participant.userId}
                    className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {unbanningUserId === participant.userId
                      ? t("common.processing")
                      : t("admin.unban")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
