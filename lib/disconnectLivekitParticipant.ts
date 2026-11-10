import { RoomServiceClient } from "livekit-server-sdk";
import { resolveLivekitServerCredentials } from "@/lib/livekitServers";

// 管理者キック時、LiveKitの通話からも実際に強制退去させる(2026-11追加)。
// 既存のforce-leaveブロードキャスト(Supabase Realtime経由)は、相手の
// クライアントが自主的に受け取って画面をリロードしてくれることに依存して
// おり、改造されたクライアントに無視される可能性がある。LiveKitサーバー
// 自身が持つ強制退去機能(RoomServiceClient.removeParticipant)を呼ぶことで、
// クライアント側の協力に関係なくサーバー側から確実に切断する。LiveKit自体の
// 設定・挙動は変更していない(既存のAPIをそのまま呼ぶだけ)。
//
// 失敗しても例外は投げない(app/admin/actions.tsの既存のkickParticipant
// 処理を壊さないため。lib/broadcastIndigoDisconnect.tsと同じ考え方で、
// 短いタイムアウトを設けてベストエフォートにする)。対象者が既に退出済みで
// LiveKit側に見つからない場合のエラーも、ここで握りつぶす。
export async function disconnectLivekitParticipant(
  livekitServerId: string | null,
  roomId: string,
  identity: string,
): Promise<void> {
  const { url, apiKey, apiSecret } =
    resolveLivekitServerCredentials(livekitServerId);
  if (!url || !apiKey || !apiSecret) return;

  const roomService = new RoomServiceClient(url, apiKey, apiSecret);
  const roomName = `avatar-room-${roomId}`;

  try {
    await Promise.race([
      roomService.removeParticipant(roomName, identity),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "LiveKit参加者の強制退去に失敗しました(既に退出済み・通信失敗等。処理は続行)",
      err,
    );
  }
}
