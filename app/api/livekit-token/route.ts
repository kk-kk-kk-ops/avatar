import { NextResponse } from "next/server";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { createClient } from "@/lib/supabase/server";
import { resolveLivekitServerCredentials } from "@/lib/livekitServers";

// components/AvatarSpace.tsxから本番導線として呼ばれている。
// API_SECRETはこのRoute Handler内でしか使わず、クライアントにはJWTのみ返す。
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const roomId = body?.roomId as string | undefined;
  const identity = body?.identity as string | undefined;
  const inviteToken = body?.inviteToken as string | undefined;

  if (!roomId || !identity) {
    return NextResponse.json(
      { error: "roomIdとidentityが必要です" },
      { status: 400 },
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  // 通常ルート: 自分の所属アカウントのルームか(RLS経由でそのまま判定できる)
  const { data: ownRoom } = await supabase
    .from("rooms")
    .select("id, account_id")
    .eq("id", roomId)
    .maybeSingle();

  let accountId: string | undefined = ownRoom?.account_id;

  // viewOnlyルート: 既に自分のアカウントを持つ人が他人の招待URLを一時閲覧している
  // 場合、profiles.account_idは書き換えていないためRLS経由のSELECTでは見えない。
  // 招待トークンの一致をSECURITY DEFINER関数で検証する(/?invite=のviewOnly
  // 判定と同じ考え方)。
  if (!accountId && inviteToken) {
    const { data: viewRooms } = await supabase.rpc(
      "list_rooms_by_invite_token",
      { token: inviteToken },
    );
    const matched = (
      viewRooms as Array<{ id: string; account_id: string }> | null
    )?.find((r) => r.id === roomId);
    accountId = matched?.account_id;
  }

  if (!accountId) {
    return NextResponse.json(
      { error: "このルームへのアクセス権がありません" },
      { status: 403 },
    );
  }

  // このルームが属するアカウントに固定で割り当てられたLiveKitサーバーを使う
  // (単一送信元からの同時接続50人規模でWebARENA Indigo側の遮断が発生する
  // ことが判明したため、契約時点でサーバーを固定する方式にした。
  // lib/livekitServers.ts参照)。
  const { data: account } = await supabase
    .from("accounts")
    .select("livekit_server_id")
    .eq("id", accountId)
    .maybeSingle();

  const { url, apiKey, apiSecret } = resolveLivekitServerCredentials(
    account?.livekit_server_id ?? null,
  );
  if (!apiKey || !apiSecret || !url) {
    return NextResponse.json(
      { error: "LiveKitの設定が不足しています" },
      { status: 500 },
    );
  }

  const roomName = `avatar-room-${roomId}`;

  // なりすまし対策(2026-09 QA指摘): identityはクライアントが自由に指定できる
  // 値(components/AvatarSpace.tsxのselfId)で、同室の他参加者はSupabase
  // Realtime presence経由でお互いのidentityを知ることができる。そのため、
  // 他人のidentityを指定してこのAPIを呼び直されると、LiveKit側の仕様
  // (同一identityの新規接続は既存セッションをDUPLICATE_IDENTITYで切断する)
  // により、任意の参加者を強制的に切断できてしまっていた。
  //
  // identityの値そのものはpresenceのidと一致している必要がある(近接判定
  // による購読先の切り替えがparticipant.identityとpresenceのidを直接
  // 突き合わせているため、AvatarSpace.tsx側の変更は不要な設計にする)。
  // そこで値は変えず、「そのidentityを最初に使い始めたのが本当に自分か」を
  // LiveKit参加者のmetadataに認証済みユーザーIDを埋め込んで検証する。
  try {
    const roomService = new RoomServiceClient(url, apiKey, apiSecret);
    const participants = await roomService.listParticipants(roomName);
    const existing = participants.find(
      (p) => p.identity === identity && p.state !== 3 /* DISCONNECTED */,
    );
    if (existing?.metadata) {
      try {
        const ownerUserId = (
          JSON.parse(existing.metadata) as { userId?: string }
        ).userId;
        if (ownerUserId && ownerUserId !== user.id) {
          return NextResponse.json(
            { error: "この識別子は別のユーザーが使用中です" },
            { status: 409 },
          );
        }
      } catch {
        // metadataが想定形式でない場合は所有者不明として扱い、ブロックしない
        // (古いクライアント/移行期の参加者を誤って弾かないため)。
      }
    }
  } catch (err) {
    // LiveKitサーバーへの参加者一覧取得自体が失敗した場合(サーバー障害等)は、
    // このなりすましチェックのためだけに正規ユーザーの入室をブロックしない
    // (どのみちこの後のroom.connect()がLiveKitサーバーへ到達できなければ
    // 別途失敗する)。
    // eslint-disable-next-line no-console
    console.error("LiveKit参加者一覧の取得に失敗しました", err);
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    metadata: JSON.stringify({ userId: user.id }),
    ttl: 21600, // 6時間
  });
  at.addGrant({
    room: `avatar-room-${roomId}`,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });

  const token = await at.toJwt();
  // urlは接続先エンドポイントであり秘密情報ではないため、
  // クライアントがroom.connect()に使えるようここで一緒に返す
  // (NEXT_PUBLIC_環境変数を別途増やさずに済む)。
  return NextResponse.json({ token, url });
}
