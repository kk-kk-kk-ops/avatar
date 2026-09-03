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
  // ログアウト後の遷移先。省略時はTOPページ(管理者用ログイン画面)。
  // 他人の招待URL経由で参加しているゲストの場合は、呼び出し元から
  // "/?invite=トークン"を渡すことで、ログアウト後も同じ招待URLの
  // ゲスト用ログイン画面に戻れるようにする。
  redirectTo?: string;
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

export default function LogoutButton({ className, redirectTo }: Props) {
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
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
    window.location.href = redirectTo ?? "/";
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
      {loading ? "ログアウト中..." : "ログアウト"}
    </button>
  );
}
