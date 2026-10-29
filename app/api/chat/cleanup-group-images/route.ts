import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// グループチャットの最後のメンバーが退出し、グループごと削除された際に
// 呼ばれる。leave_chat_group()がグループ削除の直前に集めた添付画像の
// パス一覧を受け取り、Storage実体を削除する(storage.objectsの行をSQLで
// DELETEしただけでは実ファイルは消えない既知の制約のため、
// app/api/cron/cleanup-chat-history/route.tsと同じ方針でここだけ
// Service Role経由のStorage APIを使う)。
//
// 2026-09 QA指摘: 以前は「ログイン済みかどうか」のみを確認しており、
// 認証済みユーザーであれば会話の当事者かどうかに関わらず、正規のAPI
// レスポンス経由で知り得る任意のimage_pathを指定してService Role権限で
// 削除できてしまっていた(パスの推測不可能性はなりすまし対策にならない。
// 会話相手には画像一覧取得の一部として正規に見えているため)。
// leave_chat_group()は「グループごと削除された(=chat_messagesもcascade
// 削除済み)」ときにだけこの一覧を返す設計のため、「そのimage_pathを
// 参照するchat_messages行が現在1件も存在しない」ことをここで検証すれば、
// 新しいテーブルを追加せずに「本当に空になったグループの画像か」を
// 確認できる(進行中の会話の画像はまだ対応するメッセージ行が残っている
// ため、この検証で弾かれる)。
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const requestedPaths = (body?.imagePaths as string[] | undefined) ?? [];
  const requestedThumbnailPaths =
    (body?.thumbnailPaths as string[] | undefined) ?? [];
  if (
    !Array.isArray(requestedPaths) ||
    !Array.isArray(requestedThumbnailPaths) ||
    (requestedPaths.length === 0 && requestedThumbnailPaths.length === 0)
  ) {
    return NextResponse.json({ deletedImages: 0 });
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

  // 現在もchat_messagesに参照が残っているパス(=進行中の会話の画像、または
  // 不正に指定されたパス)を除外し、本当に孤立したパスだけを削除対象にする。
  // image_path・thumbnail_pathは別の列のため、それぞれ個別に検証する。
  const findOrphaned = async (
    requested: string[],
    column: "image_path" | "thumbnail_path",
  ): Promise<string[]> => {
    if (requested.length === 0) return [];
    const { data: stillReferenced, error: refError } = await serviceClient
      .from("chat_messages")
      .select(column)
      .in(column, requested);
    if (refError) {
      console.error(`${column}の参照検証に失敗しました`, refError);
      throw refError;
    }
    const referencedSet = new Set(
      (stillReferenced as Array<Record<string, string>> | null ?? []).map(
        (row) => row[column],
      ),
    );
    const orphaned = requested.filter((p) => !referencedSet.has(p));
    const rejectedCount = requested.length - orphaned.length;
    if (rejectedCount > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `cleanup-group-images: ${rejectedCount}件の${column}が現在も参照されているため削除をスキップしました(user=${user.id})`,
      );
    }
    return orphaned;
  };

  let imagePaths: string[];
  let thumbnailPaths: string[];
  try {
    [imagePaths, thumbnailPaths] = await Promise.all([
      findOrphaned(requestedPaths, "image_path"),
      findOrphaned(requestedThumbnailPaths, "thumbnail_path"),
    ]);
  } catch {
    return NextResponse.json(
      { error: "画像の削除に失敗しました" },
      { status: 500 },
    );
  }

  const allPaths = [...imagePaths, ...thumbnailPaths];
  if (allPaths.length === 0) {
    return NextResponse.json({ deletedImages: 0 });
  }

  const { error } = await serviceClient.storage
    .from("chat-images")
    .remove(allPaths);
  if (error) {
    console.error("グループ画像の削除に失敗しました", error);
    return NextResponse.json({ error: "画像の削除に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ deletedImages: imagePaths.length, deletedThumbnails: thumbnailPaths.length });
}
