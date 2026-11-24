"use client";

import AvatarPicker from "./AvatarPicker";
import type { AvatarMode, Room } from "@/lib/types";
import { formatMaintenanceDateTime, type MaintenanceSettings } from "@/lib/types";

// 入室の仕組みの作り替え 段階E-5-1b(2026-11-25)。入室前の画面(左の
// 380px固定サイドバー、会議室内の左サイドバー・設定タブと同じ暗い配色)。
// 中身はcomponents/AvatarSpace.tsxのif (!joined)ブロックにあった白い
// 入室パネルをそのまま移したもので、状態・ロジックはすべてAvatarSpace側
// に置いたまま、propsとして受け取るだけ(2026-11-25指摘のとおり、ここに
// ロジックは置かない)。
export type RoomJoinSidebarProps = {
  room: Pick<Room, "id" | "name" | "previewImage"> | undefined;
  onlineCount: number | undefined;
  maxPeoplePerRoom: number;
  maintenancePublished: boolean;
  maintenanceBlocking: boolean;
  maintenance: MaintenanceSettings;
  roomJoinError: string | null;
  billingNotice: string | null;
  selectedAvatarMode: AvatarMode;
  avatarPickerLocked: boolean;
  onSetAvatarMode: (mode: AvatarMode) => void;
  selectedAvatar: string;
  onSelectAvatar: (avatar: string) => void;
  selectedIconUrl: string | null;
  iconUploading: boolean;
  iconUploadError: string | null;
  onIconFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRequestDeleteIcon: () => void;
  nameInput: string;
  onNameInputChange: (value: string) => void;
  onJoin: () => void;
  isJoining: boolean;
  isRoomSwitchPending: boolean;
  isMaster: boolean;
  onGoToMaster: () => void;
  isStoppingRecording: boolean;
  onLogout: () => void;
  isLoggingOut: boolean;
  t: (key: string, params?: Record<string, string>) => string;
};

export default function RoomJoinSidebar({
  room,
  onlineCount,
  maxPeoplePerRoom,
  maintenancePublished,
  maintenanceBlocking,
  maintenance,
  roomJoinError,
  billingNotice,
  selectedAvatarMode,
  avatarPickerLocked,
  onSetAvatarMode,
  selectedAvatar,
  onSelectAvatar,
  selectedIconUrl,
  iconUploading,
  iconUploadError,
  onIconFileChange,
  onRequestDeleteIcon,
  nameInput,
  onNameInputChange,
  onJoin,
  isJoining,
  isRoomSwitchPending,
  isMaster,
  onGoToMaster,
  isStoppingRecording,
  onLogout,
  isLoggingOut,
  t,
}: RoomJoinSidebarProps) {
  // 段階E-5-1bの追加指示a(2026-11-25)。カード切り替え中はサイドバー全体
  // を薄くせず、入室ボタンだけを「確認中...」にして押せなくする。
  const joinButtonLabel = maintenanceBlocking
    ? t("lobby.maintenanceInProgress")
    : isJoining || isRoomSwitchPending
      ? t("lobby.checking")
      : t("lobby.enterRoom");

  return (
    <div
      // 段階E-5-1b見直し(2026-11-25)。ブラウザ標準のスクロールバーが
      // 暗い背景の上で白く浮いて見える指摘への対応。[color-scheme:dark]
      // で、この要素の中のスクロールバー・フォーム部品を暗い配色にする
      // (ページ全体には付けない。白いカード一覧側の見た目は変えない)。
      className="order-2 flex min-h-0 w-full flex-col overflow-y-auto border-t border-slate-700 bg-slate-900 px-4 py-4 text-white [color-scheme:dark] md:order-1 md:w-[380px] md:shrink-0 md:border-t-0 md:border-r md:py-6"
    >
      {room ? (
        <div className="mb-4 flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold text-white">
            {room.name}
          </p>
          <span className="shrink-0 text-xs font-semibold text-slate-400">
            {t("lobby.onlineCount", {
              count: String(onlineCount ?? 0),
              max: String(maxPeoplePerRoom),
            })}
          </span>
        </div>
      ) : (
        <p className="mb-4 rounded-lg border border-amber-800 bg-amber-900/40 px-3 py-2 text-xs text-amber-200">
          {t("lobby.noRoomYet")}
        </p>
      )}

      <p className="mb-4 text-sm text-slate-400">
        {t("lobby.selectAvatarPrompt")}
      </p>

      {maintenancePublished && maintenance.startsAt && maintenance.endsAt && (
        <p className="mb-4 rounded-lg border border-red-800 bg-red-900/40 px-3 py-2 text-xs font-semibold text-red-200">
          {t("lobby.maintenanceNotice")}
          <br />
          {t("lobby.maintenancePeriod")}{formatMaintenanceDateTime(maintenance.startsAt)} 〜{" "}
          {formatMaintenanceDateTime(maintenance.endsAt)}
        </p>
      )}

      {roomJoinError && (
        <p className="mb-4 rounded-lg border border-red-800 bg-red-900/40 px-3 py-2 text-xs text-red-200">
          {roomJoinError}
        </p>
      )}

      {billingNotice && (
        <p className="mb-4 rounded-lg border border-blue-800 bg-blue-900/40 px-3 py-2 text-xs text-blue-200">
          {billingNotice}
        </p>
      )}

      <div className="mb-4">
        <div className="mb-3 flex rounded-lg bg-slate-800 p-1 text-xs font-semibold">
          <button
            type="button"
            disabled={avatarPickerLocked}
            onClick={() => onSetAvatarMode("avatar")}
            className={`flex-1 rounded-md py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              selectedAvatarMode === "avatar"
                ? "bg-slate-600 text-white"
                : "text-slate-400"
            }`}
          >
            {t("settings.avatarModeAvatar")}
          </button>
          <button
            type="button"
            disabled={avatarPickerLocked}
            onClick={() => onSetAvatarMode("icon")}
            className={`flex-1 rounded-md py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              selectedAvatarMode === "icon"
                ? "bg-slate-600 text-white"
                : "text-slate-400"
            }`}
          >
            {t("settings.avatarModeIcon")}
          </button>
        </div>

        {selectedAvatarMode === "avatar" ? (
          <AvatarPicker
            selected={selectedAvatar}
            onSelect={onSelectAvatar}
            disabled={avatarPickerLocked}
          />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="h-16 w-16 overflow-hidden rounded-full border-2 border-slate-600 bg-slate-800">
              {selectedIconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedIconUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xl font-bold text-slate-400">
                  {nameInput.trim().slice(0, 1) || "?"}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="cursor-pointer rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800">
                {iconUploading
                  ? t("settings.iconUploading")
                  : t("settings.iconUploadButton")}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={iconUploading}
                  onChange={onIconFileChange}
                />
              </label>
              {selectedIconUrl && (
                <button
                  type="button"
                  onClick={onRequestDeleteIcon}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
                >
                  {t("common.delete")}
                </button>
              )}
            </div>
            <p className="text-center text-[10px] text-slate-500">
              {t("settings.iconSquareHint")}
            </p>
            {iconUploadError && (
              <p className="text-center text-[10px] text-red-400">
                {iconUploadError}
              </p>
            )}
          </div>
        )}
      </div>

      <input
        autoFocus
        value={nameInput}
        onChange={(e) => onNameInputChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onJoin()}
        placeholder={t("lobby.namePlaceholder")}
        className="mb-4 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-slate-400"
      />
      <button
        onClick={onJoin}
        disabled={!room || isJoining || maintenanceBlocking || isRoomSwitchPending}
        className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {joinButtonLabel}
      </button>

      {isMaster && (
        <button
          type="button"
          onClick={onGoToMaster}
          disabled={isStoppingRecording}
          className="mt-2 block w-full rounded-lg bg-slate-800 py-2 text-center text-sm font-semibold text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t("room.goToMasterPanel")}
        </button>
      )}
      <button
        type="button"
        onClick={onLogout}
        disabled={isStoppingRecording || isLoggingOut}
        className="mt-2 block w-full rounded-lg border border-slate-600 py-2 text-center text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isLoggingOut ? t("admin.loggingOut") : t("admin.logout")}
      </button>
    </div>
  );
}
