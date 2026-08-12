import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// チャット履歴の保管期間(プラン別)を超えたメッセージと、添付画像の
// Storageオブジェクトを削除する。Vercel Cronから毎日4:00 JST(19:00 UTC。
// vercel.json参照)に呼ばれる。
//
// SQLのpg_cronだけで完結させなかった理由: Supabase Storageのオブジェクトは
// storage.objectsテーブルの行をSQLで直接DELETEしても、Storageバックエンド上の
// 実ファイルは削除されず残ってしまう(storage-apiのDELETE API経由でしか
// 実ファイルは消えない、という既知の制約)。そのためここではsupabase-jsの
// Storage APIを使い、実ファイルの削除とメッセージ行の削除の両方を行う。
//
// RLSを全てバイパスするService Roleキーを使うため、このRouteは
// CRON_SECRETによる認証を必須にする(Vercel Cronは設定されたCRON_SECRETを
// 自動的にAuthorization: Bearerヘッダーで送る)。
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Service Roleの設定が不足しています" },
      { status: 500 },
    );
  }

  const supabase = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: expired, error: rpcError } = await supabase.rpc(
    "get_expired_chat_message_ids",
  );
  if (rpcError) {
    console.error("削除対象チャットメッセージの取得に失敗しました", rpcError);
    return NextResponse.json({ error: "削除対象の取得に失敗しました" }, { status: 500 });
  }

  const rows = (expired ?? []) as Array<{ id: string; image_path: string | null }>;
  if (rows.length === 0) {
    return NextResponse.json({ deletedMessages: 0, deletedImages: 0 });
  }

  const imagePaths = rows.map((r) => r.image_path).filter((p): p is string => !!p);
  if (imagePaths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from("chat-images")
      .remove(imagePaths);
    if (storageError) {
      // 画像削除に失敗しても、メッセージ行の削除は続行する
      // (次回実行時にリトライされることを許容し、全体を止めない)。
      console.error("添付画像の削除に失敗しました", storageError);
    }
  }

  const ids = rows.map((r) => r.id);
  const BATCH_SIZE = 1000;
  let deletedMessages = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const { error: deleteError } = await supabase
      .from("chat_messages")
      .delete()
      .in("id", batch);
    if (deleteError) {
      console.error("チャットメッセージの削除に失敗しました", deleteError);
      continue;
    }
    deletedMessages += batch.length;
  }

  return NextResponse.json({ deletedMessages, deletedImages: imagePaths.length });
}
