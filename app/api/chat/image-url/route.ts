import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIGNED_URL_EXPIRES_IN = 300; // 5分

// チャットの添付画像は非公開バケット(chat-images)に置いているため、
// 表示のたびに認可チェック付きでこのRouteから署名付きURLを発行する。
// 認可は既存の2ルートをそのまま踏襲する:
//   - 通常: chat_messagesのRLS("chat_messages: select own dm")がそのまま
//     sender/recipient本人かを判定してくれるため、素のSELECTで十分。
//   - viewOnly: list_chat_messages_by_invite_tokenと同じ引数
//     (roomId, peerUserId, inviteToken)を使い、同じSECURITY DEFINER関数で
//     取得したスレッドの中から対象メッセージを探す。
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const messageId = searchParams.get("messageId");
  const roomId = searchParams.get("roomId");
  const peerUserId = searchParams.get("peerUserId");
  const inviteToken = searchParams.get("inviteToken");
  const download = searchParams.get("download") === "1";

  if (!messageId) {
    return NextResponse.json({ error: "messageIdが必要です" }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  let imagePath: string | null = null;

  if (inviteToken && roomId && peerUserId) {
    const { data } = await supabase.rpc("list_chat_messages_by_invite_token", {
      token: inviteToken,
      target_room_id: roomId,
      peer_user_id: peerUserId,
    });
    const row = (
      data as Array<{ id: string; image_path: string | null }> | null
    )?.find((m) => m.id === messageId);
    imagePath = row?.image_path ?? null;
  } else {
    const { data } = await supabase
      .from("chat_messages")
      .select("image_path")
      .eq("id", messageId)
      .maybeSingle();
    imagePath = (data as { image_path: string | null } | null)?.image_path ?? null;
  }

  if (!imagePath) {
    return NextResponse.json({ error: "画像が見つかりません" }, { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Service Roleの設定が不足しています" },
      { status: 500 },
    );
  }
  const serviceClient = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // download=1のときはContent-Dispositionを付けた署名付きURLを発行し、
  // ブラウザが開く/表示するのではなく保存ダイアログを出すようにする
  // (通常表示用のURLとは別発行にし、<img>表示時に保存扱いにならないようにする)。
  const { data: signed, error } = await serviceClient.storage
    .from("chat-images")
    .createSignedUrl(
      imagePath,
      SIGNED_URL_EXPIRES_IN,
      download ? { download: true } : undefined,
    );
  if (error || !signed) {
    console.error("署名付きURLの発行に失敗しました", error);
    return NextResponse.json({ error: "画像URLの発行に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl });
}
