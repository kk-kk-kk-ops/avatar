import type { SupabaseClient } from "@supabase/supabase-js";
import { disconnectIndigoConnections } from "@/lib/broadcastIndigoDisconnect";

// プラン変更が反映された瞬間、そのアカウントのルームに入室中の全員を
// 強制退出させる。既存のチャット等と同じavatar-room-{roomId}チャンネルへ
// broadcastするだけで、AvatarSpace.tsx側の対応するリスナーが反応する
// (Node.jsスクリプトでの実機検証により、サーバー側からsubscribe()せず
// channel.httpSend()するだけで購読中の全クライアントに届くことを確認済み)。
// app/admin/actions.tsのdebugSetPlanと、Stripe Webhook
// (app/api/stripe/webhook/route.ts)の両方から呼ばれる共通処理。
export async function broadcastForceLeaveForAccount(
  supabase: SupabaseClient,
  accountId: string,
): Promise<void> {
  const { data: rooms } = await supabase
    .from("rooms")
    .select("id")
    .eq("account_id", accountId);

  await Promise.all(
    (rooms ?? []).map((room) =>
      supabase
        .channel(`avatar-room-${room.id}`)
        .httpSend("force-leave", { reason: "plan-changed" })
        .catch(() => {
          // 通知に失敗しても致命的ではない(次回の同期処理や再読み込みで
          // いずれ新しいプランの制限が反映されるため)ので握りつぶす。
        }),
    ),
  );

  // position-sync経路(IndigoPro WSサーバー)の接続も合わせて切断する
  // (2026-11追加)。indigoモード未導入時は何もしない(disconnectIndigo
  // Connections内部で判定)。userIdを指定しない=ルーム全体が対象。
  await Promise.all(
    (rooms ?? []).map((room) => disconnectIndigoConnections(room.id)),
  );
}
