import { RoomServiceClient } from "livekit-server-sdk";
import { resolveLivekitServerCredentials } from "@/lib/livekitServers";

// 管理者による強制退出のBAN対象を確定させるための本人確認(2026-11 M-2)。
// presenceが自己申告するuserId(改造クライアントから任意の値に書き換え
// 可能、components/AvatarSpace.tsxのtrack()参照)をそのまま信用せず、
// LiveKit参加者のmetadata(発行時にサーバーが認証済みuser.idを埋め込んだ
// もの、app/api/livekit-token/route.ts:158-162と同じ値)から確認する。
// この照合方法自体はapp/api/livekit-token/route.ts:115-148のなりすまし
// 対策と同じで、LiveKit側の機能・設定は変更しない(既存APIの読み取りのみ)。
//
// 対象者が見つからない・metadataが無い・パースできない場合はnullを返す。
// 呼び出し元(app/admin/actions.tsのperformKick)は、nullの場合presenceの
// 自己申告値でBANしないフォールバックを行う。
export async function resolveLivekitParticipantUserId(
  livekitServerId: string | null,
  roomId: string,
  identity: string,
): Promise<string | null> {
  const { url, apiKey, apiSecret } =
    resolveLivekitServerCredentials(livekitServerId);
  if (!url || !apiKey || !apiSecret) return null;

  const roomService = new RoomServiceClient(url, apiKey, apiSecret);
  const roomName = `avatar-room-${roomId}`;

  try {
    const participants = await Promise.race([
      roomService.listParticipants(roomName),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
    const existing = participants.find(
      (p) => p.identity === identity && p.state !== 3 /* DISCONNECTED */,
    );
    if (!existing?.metadata) return null;
    const parsed = JSON.parse(existing.metadata) as { userId?: string };
    return parsed.userId ?? null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "LiveKit参加者情報の取得に失敗しました(本人確認をスキップします)",
      err,
    );
    return null;
  }
}
