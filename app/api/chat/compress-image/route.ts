import { NextResponse } from "next/server";
import sharp from "sharp";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { DAILY_IMAGE_UPLOAD_LIMIT, CHAT_IMAGE_MAX_BYTES } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TARGET_BYTES = 500 * 1024;

// クライアントが"raw/{myUserId}/{uuid}.ext"へ直接アップロードした生画像を、
// 1920px以下・WebP・quality80(オーバーサイズならquality60で再試行)に
// 圧縮し、"{roomId}/{myUserId}/{uuid}.webp"へ保存し直す。
//
// 生画像のダウンロード・最終画像のアップロードはService Roleで行う
// (chat-imagesバケットにはSELECTポリシーを一切設けていないため、
// ユーザー自身のセッションでも生画像をdownloadできない設計にしている。
// 詳細はsupabase/consolidated_setup.sqlの9f-4節を参照)。
// 日次アップロード枚数の取得・加算は、auth.uid()を使うRPCのため
// ユーザー自身のセッションクライアント(Service Roleではない)で呼ぶ。
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const rawPath = body?.rawPath as string | undefined;
  const roomId = body?.roomId as string | undefined;
  const inviteToken = body?.inviteToken as string | undefined;

  if (!rawPath || !roomId) {
    return NextResponse.json({ error: "rawPathとroomIdが必要です" }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  if (!rawPath.startsWith(`raw/${user.id}/`)) {
    return NextResponse.json({ error: "不正な画像パスです" }, { status: 400 });
  }

  const { data: ownRoom } = await supabase
    .from("rooms")
    .select("id")
    .eq("id", roomId)
    .maybeSingle();
  let authorized = !!ownRoom;
  if (!authorized && inviteToken) {
    const { data: viewRooms } = await supabase.rpc("list_rooms_by_invite_token", {
      token: inviteToken,
    });
    authorized = !!(viewRooms as Array<{ id: string }> | null)?.some((r) => r.id === roomId);
  }
  if (!authorized) {
    return NextResponse.json(
      { error: "このルームへのアクセス権がありません" },
      { status: 403 },
    );
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

  // 日次上限の最終チェック(クライアント側のチェックは事前案内のためのもので、
  // ここがサーバー側での最終防波堤)。
  const { data: currentCount } = await supabase.rpc("get_daily_image_upload_count");
  if ((currentCount ?? 0) >= DAILY_IMAGE_UPLOAD_LIMIT) {
    await serviceClient.storage.from("chat-images").remove([rawPath]);
    return NextResponse.json(
      { error: `1日アップロード上限${DAILY_IMAGE_UPLOAD_LIMIT}枚までです` },
      { status: 429 },
    );
  }

  const { data: rawBlob, error: downloadError } = await serviceClient.storage
    .from("chat-images")
    .download(rawPath);
  if (downloadError || !rawBlob) {
    console.error("生画像の取得に失敗しました", downloadError);
    return NextResponse.json({ error: "画像の取得に失敗しました" }, { status: 500 });
  }

  const inputBuffer = Buffer.from(await rawBlob.arrayBuffer());
  if (inputBuffer.byteLength > CHAT_IMAGE_MAX_BYTES) {
    await serviceClient.storage.from("chat-images").remove([rawPath]);
    return NextResponse.json(
      { error: "画像サイズが上限(5MB)を超えています" },
      { status: 400 },
    );
  }

  const metadata = await sharp(inputBuffer).metadata().catch(() => null);
  if (!metadata?.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
    await serviceClient.storage.from("chat-images").remove([rawPath]);
    return NextResponse.json(
      { error: "対応していない画像形式です(JPEG/PNG/WebPのみ)" },
      { status: 400 },
    );
  }

  const compress = (quality: number) =>
    sharp(inputBuffer)
      .rotate() // EXIFの回転情報を反映してから焼き込む
      .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();

  let outputBuffer = await compress(80);
  if (outputBuffer.byteLength > TARGET_BYTES) {
    outputBuffer = await compress(60);
  }

  const finalPath = `${roomId}/${user.id}/${crypto.randomUUID()}.webp`;
  const { error: uploadError } = await serviceClient.storage
    .from("chat-images")
    .upload(finalPath, outputBuffer, { contentType: "image/webp" });
  if (uploadError) {
    console.error("圧縮画像のアップロードに失敗しました", uploadError);
    return NextResponse.json({ error: "画像の保存に失敗しました" }, { status: 500 });
  }

  await serviceClient.storage.from("chat-images").remove([rawPath]);
  await supabase.rpc("increment_daily_image_upload_count");

  return NextResponse.json({ imagePath: finalPath });
}
