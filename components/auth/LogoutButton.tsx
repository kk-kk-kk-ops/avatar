"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  SESSION_SUPERSEDED_EVENT,
  SESSION_SUPERSEDED_WILDCARD,
  sessionChannelName,
} from "@/lib/useSessionGuard";

type Props = {
  className?: string;
  // ログアウト後の遷移先。省略時はログイン画面(/login)。他人の招待URL
  // 経由で参加しているゲストの場合は、呼び出し元から"/?invite=トークン"を
  // 渡すことで、ログアウト後も同じ招待URLのゲスト用ログイン画面に
  // 戻れるようにする。
  redirectTo?: string;
  // ボタン文言の上書き(管理画面など、言語設定が英語表示に対応している
  // 画面からのみ渡す。マスター画面等、日本語固定のまま使う呼び出し元は
  // 省略すればよい)。
  label?: string;
  loadingLabel?: string;
};

// 同じアカウントを開いている他のタブ/デバイスにも、このタブでの
// ログアウトを即座に伝える(2026-09追加。手順9)。無くても、それらの
// タブは次に認証チェックが走る操作(画面遷移等)をした時点でいずれ
// ログアウトされるが、それまで通話・画面共有・マイクが動き続けて
// しまっていたための対策。realtimeの購読が遅い/失敗する場合に
// ログアウト自体を止めてしまわないよう、短いタイムアウト付きで行う。
async function notifyOtherTabs(
  supabase: ReturnType<typeof createClient>,
  userId: string,
) {
  const channel = supabase.channel(sessionChannelName(userId));
  await Promise.race([
    new Promise<void>((resolve) => {
      channel.subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        channel
          .send({
            type: "broadcast",
            event: SESSION_SUPERSEDED_EVENT,
            payload: { supersededToken: SESSION_SUPERSEDED_WILDCARD },
          })
          .finally(resolve);
      });
    }),
    new Promise<void>((resolve) => setTimeout(resolve, 1500)),
  ]);
  supabase.removeChannel(channel);
}

// 会議室(components/AvatarSpace.tsx)のログアウトボタンからも、この
// コンポーネントと全く同じ処理(他タブへの通知→signOut→移動)を使うために
// 切り出す(2026-11-21追加)。既存のLogoutButtonコンポーネント自体の動き
// (移動先の既定値"/login"、signOutの範囲、他タブへの通知)は変えない。
export async function performLogout(redirectTo?: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    try {
      await notifyOtherTabs(supabase, user.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("他タブへのログアウト通知に失敗しました", err);
    }
  }
  await supabase.auth.signOut();
  // ページ全体を再読み込みしてCookie・middlewareの状態を確実にリセットする
  window.location.href = redirectTo ?? "/login";
}

export default function LogoutButton({
  className,
  redirectTo,
  label,
  loadingLabel,
}: Props) {
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    await performLogout(redirectTo);
  };

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className={
        className ??
        "rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-60"
      }
    >
      {loading ? (loadingLabel ?? "ログアウト中...") : (label ?? "ログアウト")}
    </button>
  );
}
