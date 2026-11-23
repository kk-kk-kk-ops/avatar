"use client";

import dynamic from "next/dynamic";
import type { AvatarMode, Room } from "@/lib/types";
import type { Locale } from "@/lib/i18n/translations";

// canvasやwindow/keyboardイベントを使うためSSRを無効化
const AvatarSpace = dynamic(() => import("@/components/AvatarSpace"), {
  ssr: false,
});

type Props = {
  initialName?: string;
  rooms: Room[];
  maxPeoplePerRoom: number;
  screenShareDailyMinutes: number | null;
  videoCallDailyMinutes: number | null;
  voiceCallDailyMinutes: number | null;
  recordingEnabled: boolean;
  dailyImageBytesLimit: number;
  isAccountAdmin: boolean;
  isMaster: boolean;
  guestInviteToken?: string | null;
  avatarSizePx?: number;
  viewOnlyInviteToken?: string;
  // 入室の仕組みの作り替え 段階D-2。メンバーとして入った人の経路。
  isMemberEntry?: boolean;
  ownRoomHref?: string | null;
  maintenanceEnabled?: boolean;
  maintenanceStartsAt?: string | null;
  maintenanceEndsAt?: string | null;
  initialProfileLocale?: Locale;
  initialAvatarMode?: AvatarMode;
  initialAvatarIconUrl?: string | null;
  // 無効化された招待URLを踏んだ後、ログイン済みの人が自分のロビーに
  // 合流した場合に表示する初期エラー文言(2026-11追加)。
  initialRoomJoinError?: string;
  // 管理画面モーダル化 M-4(2026-11)。app/billing/return経由で戻った
  // 直後に表示する結果通知。
  initialBillingNotice?: "checkout_success" | "portal_returned";
};

export default function AvatarSpaceLoader({
  initialName,
  rooms,
  maxPeoplePerRoom,
  screenShareDailyMinutes,
  videoCallDailyMinutes,
  voiceCallDailyMinutes,
  recordingEnabled,
  dailyImageBytesLimit,
  isAccountAdmin,
  isMaster,
  guestInviteToken,
  avatarSizePx,
  viewOnlyInviteToken,
  isMemberEntry,
  ownRoomHref,
  maintenanceEnabled,
  maintenanceStartsAt,
  maintenanceEndsAt,
  initialProfileLocale,
  initialAvatarMode,
  initialAvatarIconUrl,
  initialRoomJoinError,
  initialBillingNotice,
}: Props) {
  return (
    // バーチャル空間は「画面ぴったりに固定し、スクロールで動かさない」
    // 表示にする(以前はhtml/body全体にこのスタイルを付けていたが、
    // 他のページ(管理画面など)までスクロールできなくなっていたため
    // ここに閉じ込めた)。
    <div
      className="w-full overflow-hidden"
      style={{ height: "100dvh", overscrollBehavior: "none", touchAction: "pan-x pan-y" }}
    >
      <AvatarSpace
        initialName={initialName}
        rooms={rooms}
        maxPeoplePerRoom={maxPeoplePerRoom}
        screenShareDailyMinutes={screenShareDailyMinutes}
        videoCallDailyMinutes={videoCallDailyMinutes}
        voiceCallDailyMinutes={voiceCallDailyMinutes}
        recordingEnabled={recordingEnabled}
        dailyImageBytesLimit={dailyImageBytesLimit}
        isAccountAdmin={isAccountAdmin}
        isMaster={isMaster}
        guestInviteToken={guestInviteToken}
        avatarSizePx={avatarSizePx}
        viewOnlyInviteToken={viewOnlyInviteToken}
        isMemberEntry={isMemberEntry}
        ownRoomHref={ownRoomHref}
        maintenanceEnabled={maintenanceEnabled}
        maintenanceStartsAt={maintenanceStartsAt}
        maintenanceEndsAt={maintenanceEndsAt}
        initialProfileLocale={initialProfileLocale}
        initialAvatarMode={initialAvatarMode}
        initialAvatarIconUrl={initialAvatarIconUrl}
        initialRoomJoinError={initialRoomJoinError}
        initialBillingNotice={initialBillingNotice}
      />
    </div>
  );
}
