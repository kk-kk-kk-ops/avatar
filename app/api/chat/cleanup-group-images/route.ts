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
// leave_chat_group自体が「本人が実際にそのグループのメンバーだったか」を
// 検証済みであることを前提に、ここでは「ログイン済みかどうか」のみを
// 確認する(グループは既に削除済みのため、この時点でDB照合はできない。
// パスはUUIDを含み推測不可能なため、認証済みユーザーからの誤ったパス
// 指定があっても実害は無い)。
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const imagePaths = body?.imagePaths as string[] | undefined;
  if (!imagePaths || !Array.isArray(imagePaths) || imagePaths.length === 0) {
    return NextResponse.json({ deletedImages: 0 });
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

  const { error } = await serviceClient.storage
    .from("chat-images")
    .remove(imagePaths);
  if (error) {
    console.error("グループ画像の削除に失敗しました", error);
    return NextResponse.json({ error: "画像の削除に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ deletedImages: imagePaths.length });
}
