import { NextResponse } from "next/server";
import sharp from "sharp";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { DAILY_IMAGE_UPLOAD_LIMIT, CHAT_IMAGE_MAX_BYTES } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TARGET_BYTES = 500 * 1024;
const CHAT_IMAGE_MAX_MB = Math.round(CHAT_IMAGE_MAX_BYTES / 1024 / 1024);

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
  // TODO: 全環境の差し替えが終わったら右側のフォールバックを削除する
  const serviceRoleKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
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
      { error: `画像サイズが上限(${CHAT_IMAGE_MAX_MB}MB)を超えています` },
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

  // 吹き出し表示専用の小さいサムネイル(幅320px・quality70)。元画像
  // (inputBuffer)から作る(outputBufferを再縮小するより画質が良いため)。
  const thumbnailBuffer = await sharp(inputBuffer)
    .rotate()
    .resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 70 })
    .toBuffer();

  // upload()がエラーを返さないにもかかわらず、実際には署名付きURL経由で
  // 404になり読み出せない(=実体が保存されていない)事象が確認されたため、
  // 保存直後に実際にdownloadできるかを確認する。読み出せない場合は
  // 1回だけ再アップロードを試みる(imagePathをメッセージに使わせて
  // 「読み込めない画像」を作らないための最終防波堤)。
  const uploadAndVerify = async (path: string, buffer: Buffer) => {
    const { error: uploadError } = await serviceClient.storage
      .from("chat-images")
      .upload(path, buffer, { contentType: "image/webp" });
    if (uploadError) {
      console.error("アップロードに失敗しました", path, uploadError);
      return false;
    }
    const canRead = async () => {
      const { data, error } = await serviceClient.storage
        .from("chat-images")
        .download(path);
      return !error && !!data;
    };
    if (await canRead()) return true;
    console.error("アップロード直後に読み出せなかったため再アップロードします", path);
    const { error: retryError } = await serviceClient.storage
      .from("chat-images")
      .upload(path, buffer, { contentType: "image/webp", upsert: true });
    if (retryError) {
      console.error("再アップロードに失敗しました", path, retryError);
      return false;
    }
    return await canRead();
  };

  const fileId = crypto.randomUUID();
  const finalPath = `${roomId}/${user.id}/${fileId}.webp`;
  if (!(await uploadAndVerify(finalPath, outputBuffer))) {
    return NextResponse.json({ error: "画像の保存に失敗しました" }, { status: 500 });
  }

  // サムネイルの保存に失敗しても、画像送信自体は失敗にしない。
  // thumbnail_pathをnullのままにすれば、表示側は既存画像(サムネイル無し)
  // と同じ経路で元画像(imagePath)にフォールバックする。
  let thumbnailPath: string | null = `${roomId}/${user.id}/${fileId}_thumb.webp`;
  if (!(await uploadAndVerify(thumbnailPath, thumbnailBuffer))) {
    thumbnailPath = null;
  }

  await serviceClient.storage.from("chat-images").remove([rawPath]);

  // 76-85行目の事前チェックはcheck-then-actのため、同時に複数リクエストが
  // 走ると上限を多少超過しうる(2026-09 QA指摘)。ここでの最終加算は
  // p_limitを渡し、DB側の行ロックで「チェックと加算」を1つの原子的な
  // 操作にした関数を使うことで、同時リクエストでも上限を厳密に守る
  // (supabase/consolidated_setup.sql 9e節参照)。
  const { data: newCount } = await supabase.rpc(
    "increment_daily_image_upload_count",
    { p_limit: DAILY_IMAGE_UPLOAD_LIMIT },
  );
  if (newCount === null) {
    // 上限に達していたため加算されなかった(同時アップロードによる競合)。
    // 既にアップロード済みの最終画像・サムネイルを巻き戻す。
    const pathsToRemove = thumbnailPath ? [finalPath, thumbnailPath] : [finalPath];
    await serviceClient.storage.from("chat-images").remove(pathsToRemove);
    return NextResponse.json(
      { error: `1日アップロード上限${DAILY_IMAGE_UPLOAD_LIMIT}枚までです` },
      { status: 429 },
    );
  }

  return NextResponse.json({ imagePath: finalPath, thumbnailPath });
}
