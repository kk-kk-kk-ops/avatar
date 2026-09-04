"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

const SESSION_TOKEN_STORAGE_KEY = "globy_session_token";
// LogoutButtonからも同じイベント名・チャンネル名規則で配信するため
// 公開する(payload.supersededTokenにこの値を入れて配信すると、
// 特定のタブだけでなくそのuser_idの全セッションが対象になる)。
export const SESSION_SUPERSEDED_EVENT = "superseded";
export const SESSION_SUPERSEDED_WILDCARD = "*";
export const sessionChannelName = (userId: string) => `user-session-${userId}`;

function getOrCreateSessionToken(): string {
  if (typeof window === "undefined") return "";
  const existing = window.sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
  if (existing) return existing;
  const token =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
  return token;
}

// 同一アカウント(user_id)での多重ログイン(複数タブ・複数デバイス)を
// 検知し、後からログインした方を優先して既存セッションを強制ログアウト
// させるための共通フック(2026-09追加。手順9)。バーチャル空間
// (AvatarSpace)・管理画面(AdminDashboard)・マスター画面
// (MasterDashboard)のいずれからも呼び出す。
//
// LiveKitのidentity(selfId)には一切手を入れない(近接判定による
// 音声・映像の購読切り替えがparticipant.identity === presenceのidという
// 前提に依存しているため)。完全に別の仕組みとして、online_sessions
// テーブルのsession_token列 + Supabase Realtimeの
// user-session-{userId}チャンネルだけで実現する。
//
// onForceLogout: 強制ログアウトが発生した際、signOut・ページ遷移の
// "前"に呼ばれる(LiveKit接続の明示的な切断など、呼び出し元固有の
// 後片付けが必要な場合に使う。無くても遷移自体でWebRTC接続は破棄
// されるため省略可)。
// redirectTo: 強制ログアウト後の遷移先(省略時は"/")。LogoutButtonの
// redirectToと同じ考え方で、招待URL経由のゲストの場合は呼び出し元から
// "/?invite=トークン"を渡すことで、強制ログアウト後も同じ招待URLの
// ゲスト用ログイン画面に戻れるようにする(2026-09追加。手順9の実機確認で、
// 招待URLゲストが強制ログアウトされると管理者用ログイン画面に飛ばされて
// しまう不具合が見つかったための対応)。
export function useSessionGuard(
  onForceLogout?: () => void,
  redirectTo?: string,
) {
  const onForceLogoutRef = useRef(onForceLogout);
  onForceLogoutRef.current = onForceLogout;
  const redirectToRef = useRef(redirectTo);
  redirectToRef.current = redirectTo;

  useEffect(() => {
    const supabase = createClient();
    const sessionToken = getOrCreateSessionToken();
    if (!sessionToken) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const forceLogout = () => {
      if (cancelled) return;
      cancelled = true;
      onForceLogoutRef.current?.();
      supabase.auth.signOut().finally(() => {
        const base = redirectToRef.current ?? "/";
        const separator = base.includes("?") ? "&" : "?";
        window.location.href = `${base}${separator}error=session_superseded`;
      });
    };

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;

      channel = supabase.channel(sessionChannelName(user.id));
      channel
        .on(
          "broadcast",
          { event: SESSION_SUPERSEDED_EVENT },
          ({ payload }: { payload: { supersededToken?: string } }) => {
            const superseded = payload?.supersededToken;
            if (
              superseded === sessionToken ||
              superseded === SESSION_SUPERSEDED_WILDCARD
            ) {
              forceLogout();
            }
          },
        )
        .subscribe(async (status) => {
          if (status !== "SUBSCRIBED" || cancelled) return;
          const { data: previousToken, error } = await supabase.rpc(
            "claim_session",
            { p_session_token: sessionToken },
          );
          if (error) {
            // eslint-disable-next-line no-console
            console.error("セッションの登録に失敗しました", error);
            return;
          }
          if (previousToken && previousToken !== sessionToken) {
            channel?.send({
              type: "broadcast",
              event: SESSION_SUPERSEDED_EVENT,
              payload: { supersededToken: previousToken },
            });
          }
        });
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);
}
