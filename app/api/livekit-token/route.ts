import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { createClient } from "@/lib/supabase/server";
import { resolveLivekitServerCredentials } from "@/lib/livekitServers";

// LiveKit移行 Phase1: Token発行のみ。まだAvatarSpace側からは呼ばれない
// (既存のMetered/自前WebRTCメッシュとは無関係に並行稼働させる)。
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

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
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
