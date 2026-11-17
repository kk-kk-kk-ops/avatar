import { RoomServiceClient, ServerError } from "livekit-server-sdk";
import { resolveLivekitServerCredentials } from "@/lib/livekitServers";

// 管理者キック時、LiveKitの通話からも実際に強制退去させる(2026-11追加)。
// 既存のforce-leaveブロードキャスト(Supabase Realtime経由)は、相手の
// クライアントが自主的に受け取って画面をリロードしてくれることに依存して
// おり、改造されたクライアントに無視される可能性がある。LiveKitサーバー
// 自身が持つ強制退去機能(RoomServiceClient.removeParticipant)を呼ぶことで、
// クライアント側の協力に関係なくサーバー側から確実に切断する。LiveKit自体の
// 設定・挙動は変更していない(既存のAPIをそのまま呼ぶだけ)。
//
// 例外は投げない(app/admin/actions.tsのperformKick処理を壊さないため。
// lib/broadcastIndigoDisconnect.tsと同じ考え方で、短いタイムアウトを設けて
// ベストエフォートにする)。ただし呼び出し元が管理画面に警告を出せるよう、
// 成否を戻り値で返す(2026-11、「LiveKit強制退去の失敗が管理画面に出ない」
// 課題への対応)。
//
// 対象者が既に退出済みでLiveKit側に見つからない場合は、livekit-server-sdk
// (ServerError、node_modules/livekit-server-sdk/dist/TwirpRPC.js)が
// code: "not_found" のエラーを投げる作りのため、これは失敗ではなく成功
// 扱いにする(本人確認済みの対象が既に自分で退出していただけのため)。
// 判定は必ずServerError.codeの値で行い、エラー文面の文字列一致では判定し
// ない(LiveKitサーバー側の文面変更に影響されないようにするため)。
export type DisconnectLivekitParticipantResult =
  | { ok: true }
  | { ok: false; reason: "notConfigured" | "timeout" | "error" };

export async function disconnectLivekitParticipant(
  livekitServerId: string | null,
  roomId: string,
  identity: string,
): Promise<DisconnectLivekitParticipantResult> {
  const { url, apiKey, apiSecret } =
    resolveLivekitServerCredentials(livekitServerId);
  if (!url || !apiKey || !apiSecret) {
    // eslint-disable-next-line no-console
    console.error(
      "LiveKitの接続設定(URL・キー)が不足しているため、強制退去を実施できませんでした",
    );
    return { ok: false, reason: "notConfigured" };
  }

  const roomService = new RoomServiceClient(url, apiKey, apiSecret);
  const roomName = `avatar-room-${roomId}`;

  try {
    await Promise.race([
      roomService.removeParticipant(roomName, identity),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
    return { ok: true };
  } catch (err) {
    if (err instanceof ServerError) {
      // 本番のVercelログでcode/statusの実際の値を確認するための記録
      // (秘密情報は含まない)。
      // eslint-disable-next-line no-console
      console.info(
        "LiveKit参加者の強制退去でServerErrorを受信しました",
        { code: err.code, status: err.status },
      );
      if (err.code === "not_found") {
        return { ok: true };
      }
      return { ok: false, reason: "error" };
    }
    if (err instanceof Error && err.message === "timeout") {
      // eslint-disable-next-line no-console
      console.error(
        "LiveKit参加者の強制退去がタイムアウトしました(応答を確認できませんでした)",
      );
      return { ok: false, reason: "timeout" };
    }
    // eslint-disable-next-line no-console
    console.error("LiveKit参加者の強制退去に失敗しました(通信失敗等)", err);
    return { ok: false, reason: "error" };
  }
}
