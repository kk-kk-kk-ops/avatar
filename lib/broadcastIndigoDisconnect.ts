import crypto from "node:crypto";

// IndigoPro位置情報WSサーバー(deploy/indigo-position-ws/)の管理API
// (POST /internal/disconnect)を呼び、強制退出に合わせて位置情報の
// WS接続も切断する(2026-11追加)。presence・チャット等のSupabase側
// 強制退出(force-leaveブロードキャスト)は既存の仕組みのまま一切変更せず、
// これはそれに加えて行う、position-sync経路専用の後始末。
//
// INDIGO_WS_ADMIN_URL/INDIGO_WS_ADMIN_SECRETが未設定の場合(=indigoモード
// 未導入、本番で当面はこの状態)は何もせず即座に戻る。失敗しても例外は
// 投げない(呼び出し元の強制退出処理自体を壊さないため。Supabase側の
// force-leaveが主たる仕組みであり、これはベストエフォートの補助)。
//
// userIdを省略するとそのルームの全接続が対象(プラン変更・ルーム変更時、
// 現在誰が接続中か呼び出し側が分からないため)。特定の1人だけを対象に
// する場合(管理者によるキック)はuserIdを指定する(app/api/livekit-token/
// route.ts等と同じ、selfId相当の値)。
export async function disconnectIndigoConnections(
  roomId: string,
  userId?: string,
): Promise<void> {
  const adminUrl = process.env.INDIGO_WS_ADMIN_URL;
  const secret = process.env.INDIGO_WS_ADMIN_SECRET;
  if (!adminUrl || !secret) return;

  try {
    const body = JSON.stringify(
      userId ? { roomId, userId } : { roomId },
    );
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}:${body}`)
      .digest("hex");

    await fetch(`${adminUrl}/internal/disconnect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-timestamp": timestamp,
        "x-signature": signature,
      },
      body,
      // 管理API呼び出しが長時間ハングして強制退出処理全体を遅らせない
      // よう、短いタイムアウトを設ける。
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // 通知に失敗しても致命的ではない(lib/broadcastForceLeave.tsの
    // 既存コメントと同じ考え方。Supabase側のforce-leaveが主、こちらは
    // position-sync経路のベストエフォートな補助のため)。
  }
}
