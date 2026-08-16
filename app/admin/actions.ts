"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PLANS, type PlanId } from "@/lib/types";

// Server Actionのエラーはproduction buildだと.messageが汎用文言に
// 差し替えられてしまう(Next.jsの仕様)ため、debugSetPlanだけは
// throwではなく戻り値で成否とエラーメッセージを伝える
// (app/master/actions.tsと同じ方針。他の関数は既存のまま据え置く)。
type ActionResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

// デバッグ用プラン切り替えで選べる4プラン(masterは対象外)。
const DEBUG_SWITCHABLE_PLANS: PlanId[] = ["free", "light", "standard", "pro"];

async function requireAdminAccount() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: account } = await supabase
    .from("accounts")
    .select("id, plan")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (!account) redirect("/plan");

  return { supabase, account, user };
}

export async function addRoom(templateId: string) {
  const { supabase, account } = await requireAdminAccount();

  const { data: template } = await supabase
    .from("templates")
    .select("id, name, background_image_url")
    .eq("id", templateId)
    .maybeSingle();
  if (!template) throw new Error("テンプレートが見つかりません");

  const { count } = await supabase
    .from("rooms")
    .select("id", { count: "exact", head: true })
    .eq("account_id", account.id);

  const maxRooms = PLANS[account.plan as keyof typeof PLANS].maxRooms;
  if ((count ?? 0) >= maxRooms) {
    throw new Error(
      `現在のプランではルームを${maxRooms}個までしか作成できません。プランを変更してください。`,
    );
  }

  const { error } = await supabase.from("rooms").insert({
    account_id: account.id,
    template_id: template.id,
    name: template.name,
    preview_image: template.background_image_url,
  });
  if (error) throw new Error("ルームの作成に失敗しました");

  revalidatePath("/admin");
}

// 既存のルームに紐づくルームデザイン(テンプレート)を変更する。
// ルーム名は変更しない(既に名前を変えている場合を尊重するため)。
export async function updateRoomTemplate(roomId: string, templateId: string) {
  const { supabase, account } = await requireAdminAccount();

  const { data: template } = await supabase
    .from("templates")
    .select("id, background_image_url")
    .eq("id", templateId)
    .maybeSingle();
  if (!template) throw new Error("ルームデザインが見つかりません");

  const { error } = await supabase
    .from("rooms")
    .update({
      template_id: template.id,
      preview_image: template.background_image_url,
    })
    .eq("id", roomId)
    .eq("account_id", account.id);
  if (error) throw new Error("ルームデザインの変更に失敗しました");

  revalidatePath("/admin");
}

export async function renameRoom(roomId: string, name: string) {
  const { supabase, account } = await requireAdminAccount();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("ルーム名を入力してください");

  const { error } = await supabase
    .from("rooms")
    .update({ name: trimmed })
    .eq("id", roomId)
    .eq("account_id", account.id);
  if (error) throw new Error("ルーム名の変更に失敗しました");

  revalidatePath("/admin");
}

export async function deleteRoom(roomId: string) {
  const { supabase, account } = await requireAdminAccount();

  const { error } = await supabase
    .from("rooms")
    .delete()
    .eq("id", roomId)
    .eq("account_id", account.id);
  if (error) throw new Error("ルームの削除に失敗しました");

  revalidatePath("/admin");
}

// 招待URLのトークンを再発行する(古いURLは自動的に無効になる)
export async function regenerateInviteToken() {
  const { supabase, account } = await requireAdminAccount();
  const newToken = crypto.randomUUID().replace(/-/g, "");

  const { error } = await supabase
    .from("accounts")
    .update({ invite_token: newToken })
    .eq("id", account.id);
  if (error) throw new Error("招待URLの再発行に失敗しました");

  revalidatePath("/admin");
}

// 招待URLからログイン画面に遷移したときに表示する招待者名
// (「〇〇〇さんからの招待」の〇〇〇部分)を設定する。
export async function updateInviteInviterName(name: string) {
  const { supabase, account } = await requireAdminAccount();
  const trimmed = name.trim();

  const { error } = await supabase
    .from("accounts")
    .update({ invite_inviter_name: trimmed || null })
    .eq("id", account.id);
  if (error) throw new Error("招待者名の更新に失敗しました");

  revalidatePath("/admin");
}

// プラン変更が反映された瞬間、そのアカウントのルームに入室中の全員を
// 強制退出させる。既存のチャット等と同じavatar-room-{roomId}チャンネルへ
// broadcastするだけで、AvatarSpace.tsx側の対応するリスナーが反応する
// (Node.jsスクリプトでの実機検証により、サーバー側からsubscribe()せず
// channel.httpSend()するだけで購読中の全クライアントに届くことを確認済み)。
async function broadcastForceLeaveForAccount(
  supabase: ReturnType<typeof createClient>,
  accountId: string,
) {
  const { data: rooms } = await supabase
    .from("rooms")
    .select("id")
    .eq("account_id", accountId);

  await Promise.all(
    (rooms ?? []).map((room) =>
      supabase
        .channel(`avatar-room-${room.id}`)
        .httpSend("force-leave", { reason: "plan-changed" })
        .catch(() => {
          // 通知に失敗しても致命的ではない(次回の同期処理や再読み込みで
          // いずれ新しいプランの制限が反映されるため)ので握りつぶす。
        }),
    ),
  );
}

// ダッシュボードの入室者一覧から、特定の参加者を強制退出させ、管理者が
// 「解除」するまで再入室できないようBANリスト(banned_participants)に
// 登録する。単にforce-leaveでタブを閉じさせるだけだと、本人のアカウント
// アクセス権自体は残ったままなのでルーム選択からすぐ入り直せてしまう
// (実際にそう報告があった)ため、DB側の恒久的な制限とセットにした。
// broadcastForceLeaveForAccountと同じforce-leaveイベントを使うが、
// targetIdを付けて送ることでAvatarSpace.tsx側が「自分宛てかどうか」を
// 判定できるようにし、ルーム内の他の参加者は退出させない。
export async function kickParticipant(
  roomId: string,
  participantId: string,
  participantUserId: string | null,
): Promise<ActionResult> {
  const { supabase, account, user } = await requireAdminAccount();

  // 自分のアカウントが所有するルームかどうかを確認してから送る
  // (他アカウントのルームへ勝手に強制退出broadcastを送れないようにする)。
  const { data: room } = await supabase
    .from("rooms")
    .select("id")
    .eq("id", roomId)
    .eq("account_id", account.id)
    .maybeSingle();
  if (!room) return { ok: false, error: "ルームが見つかりません" };

  // 管理者自身(オーナー)を誤ってBANし、自分自身のルームに入れなくなる
  // 事故を防ぐ(誰も解除できなくなってしまうため)。
  // BAN登録(banned_participantsへの書き込み)は、今すぐタブを閉じさせる
  // force-leaveの送信とは独立した「恒久的な再入室禁止」のための処理。
  // 以前はBAN登録が先で、これが失敗する(例:マイグレーション未適用で
  // テーブルが無い)と早期returnしてforce-leave自体が一切送られず、
  // 「強制退出を押しても本人がまだ画面に残り続ける」不具合になっていた。
  // 今すぐの退出はBAN登録の成否に関わらず必ず行うようにする。
  let banFailed = false;
  if (participantUserId && participantUserId !== user.id) {
    const { error: banError } = await supabase
      .from("banned_participants")
      .upsert({ account_id: account.id, user_id: participantUserId });
    if (banError) {
      // eslint-disable-next-line no-console
      console.error("BAN登録に失敗しました", banError);
      banFailed = true;
    }
  }

  try {
    await supabase
      .channel(`avatar-room-${roomId}`)
      .httpSend("force-leave", { reason: "admin-kicked", targetId: participantId });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("強制退出の送信に失敗しました", err);
    return { ok: false, error: "退出処理に失敗しました" };
  }

  revalidatePath("/admin");
  if (banFailed) {
    return {
      ok: true,
      warning:
        "退出させましたが、再入室防止(BAN)の登録に失敗しました。データベースの設定を確認してください。",
    };
  }
  return { ok: true };
}

// BANリストから外し、再入室できるようにする。
export async function unbanParticipant(userId: string): Promise<ActionResult> {
  const { supabase, account } = await requireAdminAccount();

  const { error } = await supabase
    .from("banned_participants")
    .delete()
    .eq("account_id", account.id)
    .eq("user_id", userId);
  if (error) return { ok: false, error: "解除に失敗しました" };

  revalidatePath("/admin");
  return { ok: true };
}

// デバッグ用: 環境変数DEBUG_PLAN_SWITCH_EMAILに一致するアカウントだけが、
// 自分のプランを5プランの中から自由に切り替えられる(動作確認用)。
// クライアント側の表示制御(app/admin/page.tsxのisDebugPlanSwitcherAllowed)
// とは別に、ここでも必ずメールアドレスを再検証する
// (Server Actionは表示上のUIに関わらず直接呼び出せるため)。
export async function debugSetPlan(planId: PlanId): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ログインが必要です" };

  const allowedEmail = process.env.DEBUG_PLAN_SWITCH_EMAIL;
  if (!allowedEmail || user.email !== allowedEmail) {
    return { ok: false, error: "この機能を利用する権限がありません" };
  }

  if (!DEBUG_SWITCHABLE_PLANS.includes(planId)) {
    return { ok: false, error: "不正なプランです" };
  }

  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (!account) return { ok: false, error: "アカウントが見つかりません" };

  const { error } = await supabase
    .from("accounts")
    .update({ plan: planId })
    .eq("id", account.id);
  if (error) return { ok: false, error: "プランの更新に失敗しました" };

  await broadcastForceLeaveForAccount(supabase, account.id);

  revalidatePath("/admin");
  return { ok: true };
}
