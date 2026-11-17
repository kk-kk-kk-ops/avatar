"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { broadcastForceLeaveForAccount } from "@/lib/broadcastForceLeave";
import { disconnectIndigoConnections } from "@/lib/broadcastIndigoDisconnect";
import { disconnectLivekitParticipant } from "@/lib/disconnectLivekitParticipant";
import { resolveLivekitParticipantUserId } from "@/lib/resolveLivekitParticipantUserId";
import { requireVerifiedBillingAccount } from "@/lib/billingAccountGuard";
import { PLANS, type PlanId } from "@/lib/types";
import { translate, type Locale } from "@/lib/i18n/translations";

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
  if (!user) redirect("/login");

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
    .select("id, name, background_image_url, thumbnail_image_url")
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
    preview_image: template.thumbnail_image_url ?? template.background_image_url,
  });
  if (error) throw new Error("ルームの作成に失敗しました");

  revalidatePath("/admin");
}

// 既存のルームに紐づくルームデザイン(テンプレート)を変更する実処理
// (2026-11 M-3で切り出し)。ダッシュボード(RoomManager.tsx、既存の
// updateRoomTemplate経由)と会議室内モーダル(updateRoomTemplateFromModal
// 経由)の両方から呼ばれる。ルーム名は変更しない(既に名前を変えている
// 場合を尊重するため)。
//
// roomId: 既存の入口(RoomManager.tsx)はルームのidを指定済みで渡してくる
// ため、その値をそのまま使う(挙動を変えない)。モーダル用の新しい入口は
// roomIdを渡さず(null)、その場合はそのアカウントの先頭ルーム(created_at
// 昇順で1件)を自動で解決する。app/page.tsx:104-112のルーム入室解決と
// 同じ方法で揃えている(1アカウント1ルームの前提、M-3調査のB-1/B-2・
// 確認方法Cで確認済み。2026-11時点で本番に2件以上のルームを持つ
// アカウントは無いことも確認済み)。
async function performUpdateRoomTemplate(
  supabase: ReturnType<typeof createClient>,
  accountId: string,
  roomId: string | null,
  templateId: string,
  locale: Locale,
): Promise<ActionResult> {
  const { data: template } = await supabase
    .from("templates")
    .select("id, background_image_url, thumbnail_image_url")
    .eq("id", templateId)
    .maybeSingle();
  if (!template) {
    return { ok: false, error: translate(locale, "admin.roomDesignNotFound") };
  }

  let targetRoomId: string;
  if (roomId) {
    targetRoomId = roomId;
  } else {
    const { data: room } = await supabase
      .from("rooms")
      .select("id")
      .eq("account_id", accountId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!room) {
      return { ok: false, error: translate(locale, "admin.roomNotFound") };
    }
    targetRoomId = room.id;
  }

  const { error } = await supabase
    .from("rooms")
    .update({
      template_id: template.id,
      preview_image: template.thumbnail_image_url ?? template.background_image_url,
    })
    .eq("id", targetRoomId)
    .eq("account_id", accountId);
  if (error) {
    return { ok: false, error: translate(locale, "admin.roomTemplateUpdateFailed") };
  }

  // 変更前のデザインのままそのルームに入っている参加者がいると、背景・
  // 障害物・ミーティングエリアの座標がズレたまま表示され続けてしまう
  // ため、強制退出させて再入室時に新デザインを読み込ませる(2026-09
  // 報告: 以前あったはずのこの通知が無くなっていたのを復活)。通知の
  // 送信に失敗しても、デザイン変更自体は既に成功しているため
  // アクション全体は失敗扱いにしない。targetIdを付けないため、
  // components/AvatarSpace.tsx:6753-6769のリスナーはルーム内の全員
  // (操作した管理者自身がそのルームに在室中の場合はその人も含む)に
  // 対して再読み込みを行う。
  try {
    await supabase
      .channel(`avatar-room-${targetRoomId}`)
      .httpSend("force-leave", { reason: "room-changed" });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("強制退出の送信に失敗しました", err);
  }
  // position-sync経路(IndigoPro WSサーバー)の接続も合わせて切断する
  // (2026-11追加)。indigoモード未導入時は何もしない。
  await disconnectIndigoConnections(targetRoomId);

  return { ok: true };
}

// 既存の入口(入口自体・requireAdminAccountでのredirectする動きは変更
// しない)。revalidatePath("/admin")は、Server Actionを呼んだ今のページ
// (会議室の「/」)も暗黙的に再生成させてしまうため(2026-11、/master誤
// 遷移の調査で確認)、共通関数(performUpdateRoomTemplate)からは外し、
// ここ(/adminからの呼び出し時のみ)で呼ぶ。切り出し前と同じく、成功時
// (throwしない場合)だけ呼ぶ。
export async function updateRoomTemplate(roomId: string, templateId: string) {
  const { supabase, account } = await requireAdminAccount();
  const result = await performUpdateRoomTemplate(
    supabase,
    account.id,
    roomId,
    templateId,
    "ja",
  );
  if (!result.ok) throw new Error(result.error);
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

// 招待URLのトークンを再発行する実処理(2026-11 M-3で切り出し。古いURLは
// 自動的に無効になる)。
async function performRegenerateInviteToken(
  supabase: ReturnType<typeof createClient>,
  accountId: string,
  locale: Locale,
): Promise<ActionResult> {
  const newToken = crypto.randomUUID().replace(/-/g, "");

  const { error } = await supabase
    .from("accounts")
    .update({ invite_token: newToken })
    .eq("id", accountId);
  if (error) {
    return { ok: false, error: translate(locale, "admin.regenerateTokenFailed") };
  }

  return { ok: true };
}

// revalidatePath("/admin")は共通関数から外し、/adminからの呼び出し時の
// みここで呼ぶ(updateRoomTemplateと同じ理由、2026-11)。
export async function regenerateInviteToken() {
  const { supabase, account } = await requireAdminAccount();
  const result = await performRegenerateInviteToken(supabase, account.id, "ja");
  if (!result.ok) throw new Error(result.error);
  revalidatePath("/admin");
}

// 「告知」タブでタイトルを開いた項目を既読にする(項目単位の既読管理)。
export async function markAnnouncementRead(announcementId: string) {
  const { supabase, account } = await requireAdminAccount();

  const { error } = await supabase
    .from("announcement_reads")
    .upsert(
      { account_id: account.id, announcement_id: announcementId },
      { onConflict: "account_id,announcement_id" },
    );
  if (error) throw new Error("既読状態の更新に失敗しました");

  revalidatePath("/admin");
}

// 招待URLからログイン画面に遷移したときに表示する招待者名
// (「〇〇〇さんからの招待」の〇〇〇部分)を設定する実処理
// (2026-11 M-3で切り出し)。
async function performUpdateInviterName(
  supabase: ReturnType<typeof createClient>,
  accountId: string,
  name: string,
  locale: Locale,
): Promise<ActionResult> {
  const trimmed = name.trim();

  const { error } = await supabase
    .from("accounts")
    .update({ invite_inviter_name: trimmed || null })
    .eq("id", accountId);
  if (error) {
    return { ok: false, error: translate(locale, "admin.inviterNameUpdateFailed") };
  }

  return { ok: true };
}

// revalidatePath("/admin")は共通関数から外し、/adminからの呼び出し時の
// みここで呼ぶ(updateRoomTemplateと同じ理由、2026-11)。
export async function updateInviteInviterName(name: string) {
  const { supabase, account } = await requireAdminAccount();
  const result = await performUpdateInviterName(supabase, account.id, name, "ja");
  if (!result.ok) throw new Error(result.error);
  revalidatePath("/admin");
}

// 以下4つは会議室画面の管理者用モーダル(M-3、2026-11)から呼ぶ、
// redirectしないエントリポイント。M-2のlistBannedParticipants/
// kickParticipantFromModal等と同じ方針: 認可にはrequireVerifiedBillingAccount
// (lib/billingAccountGuard.ts、無変更でそのまま呼ぶ)を使い、失敗時は
// エラーを返すだけで遷移はしない。accountId・roomIdは引数で受け取らない
// (サーバー側でそのアカウントのものかを解決・確認する)。

// 招待URL・招待者名を取得する。
export async function getAdminInviteInfo(locale: Locale = "ja"): Promise<
  | { ok: true; inviteToken: string; inviterName: string }
  | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: translate(locale, "admin.loginRequired") };

  const verified = await requireVerifiedBillingAccount(supabase, user.id);
  if (!verified.ok) {
    return { ok: false, error: translate(locale, "admin.accountVerificationFailed") };
  }

  const { data: accountRow, error } = await supabase
    .from("accounts")
    .select("invite_token, invite_inviter_name")
    .eq("id", verified.account.id)
    .maybeSingle();
  if (error || !accountRow) {
    // eslint-disable-next-line no-console
    console.error("招待情報の取得に失敗しました", error);
    return { ok: false, error: translate(locale, "admin.inviteInfoLoadFailed") };
  }

  return {
    ok: true,
    inviteToken: accountRow.invite_token ?? "",
    inviterName: accountRow.invite_inviter_name ?? "",
  };
}

export async function regenerateInviteTokenFromModal(
  locale: Locale = "ja",
): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: translate(locale, "admin.loginRequired") };

  const verified = await requireVerifiedBillingAccount(supabase, user.id);
  if (!verified.ok) {
    return { ok: false, error: translate(locale, "admin.accountVerificationFailed") };
  }

  return performRegenerateInviteToken(supabase, verified.account.id, locale);
}

export async function updateInviteInviterNameFromModal(
  name: string,
  locale: Locale = "ja",
): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: translate(locale, "admin.loginRequired") };

  const verified = await requireVerifiedBillingAccount(supabase, user.id);
  if (!verified.ok) {
    return { ok: false, error: translate(locale, "admin.accountVerificationFailed") };
  }

  return performUpdateInviterName(supabase, verified.account.id, name, locale);
}

// 現在のルーム(先頭ルーム)のテンプレートIDと、選べるルームデザイン
// (テンプレート)一覧を取得する。
export async function getAdminRoomInfo(locale: Locale = "ja"): Promise<
  | {
      ok: true;
      room: { id: string; templateId: string | null } | null;
      templates: {
        id: string;
        name: string;
        backgroundImageUrl: string;
        thumbnailImageUrl: string | null;
      }[];
    }
  | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: translate(locale, "admin.loginRequired") };

  const verified = await requireVerifiedBillingAccount(supabase, user.id);
  if (!verified.ok) {
    return { ok: false, error: translate(locale, "admin.accountVerificationFailed") };
  }

  const { data: roomRow, error: roomError } = await supabase
    .from("rooms")
    .select("id, template_id")
    .eq("account_id", verified.account.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (roomError) {
    // eslint-disable-next-line no-console
    console.error("ルーム情報の取得に失敗しました", roomError);
    return { ok: false, error: translate(locale, "admin.roomInfoLoadFailed") };
  }

  const { data: templateRows, error: templateError } = await supabase
    .from("templates")
    .select("id, name, background_image_url, thumbnail_image_url")
    .order("created_at", { ascending: true });
  if (templateError) {
    // eslint-disable-next-line no-console
    console.error("ルームデザイン一覧の取得に失敗しました", templateError);
    return { ok: false, error: translate(locale, "admin.roomInfoLoadFailed") };
  }

  return {
    ok: true,
    room: roomRow ? { id: roomRow.id, templateId: roomRow.template_id } : null,
    templates: (templateRows ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      backgroundImageUrl: t.background_image_url,
      thumbnailImageUrl: t.thumbnail_image_url,
    })),
  };
}

export async function updateRoomTemplateFromModal(
  templateId: string,
  locale: Locale = "ja",
): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: translate(locale, "admin.loginRequired") };

  const verified = await requireVerifiedBillingAccount(supabase, user.id);
  if (!verified.ok) {
    return { ok: false, error: translate(locale, "admin.accountVerificationFailed") };
  }

  return performUpdateRoomTemplate(
    supabase,
    verified.account.id,
    null,
    templateId,
    locale,
  );
}

// 強制退出の実処理(2026-11 M-2で切り出し)。ダッシュボード(OnlineCount.tsx、
// 既存のkickParticipant経由)と会議室内モーダル(kickParticipantFromModal
// 経由)の両方から呼ばれる共通処理。処理順(ルーム所有確認→照合→
// 食い違い・自分自身の確認→BAN登録→LiveKit退去→位置同期切断→
// force-leave送信)は、切り出し前のkickParticipantと同じ順序を維持して
// いる(先頭に照合・確認の段を追加しただけ)。
//
// 単にforce-leaveでタブを閉じさせるだけだと、本人のアカウントアクセス
// 権自体は残ったままなのでルーム選択からすぐ入り直せてしまう(実際に
// そう報告があった)ため、DB側の恒久的な制限(banned_participants)とセット
// にしている。broadcastForceLeaveForAccountと同じforce-leaveイベントを
// 使うが、targetIdを付けて送ることでAvatarSpace.tsx側が「自分宛てかどうか」
// を判定できるようにし、ルーム内の他の参加者は退出させない。
async function performKick(
  supabase: ReturnType<typeof createClient>,
  accountId: string,
  actingUserId: string,
  roomId: string,
  participantId: string,
  claimedParticipantUserId: string | null,
  locale: Locale,
): Promise<ActionResult> {
  // 自分のアカウントが所有するルームかどうかを確認してから送る
  // (他アカウントのルームへ勝手に強制退出broadcastを送れないようにする)。
  const { data: room } = await supabase
    .from("rooms")
    .select("id")
    .eq("id", roomId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (!room) return { ok: false, error: translate(locale, "admin.roomNotFound") };

  // LiveKitサーバーの割り当てをservice_roleで1回だけ読む(2026-11 M-2。
  // 以前はRLSクライアントで読んでいたが、この値をLiveKit参加者のmetadata
  // 照合〈本人確認〉にも使うため、読み取り自体を確実にする。段階4
  // 〈app/api/livekit-token/route.tsと同じ考え方〉に合わせた)。
  const { data: livekitAccount, error: livekitAccountError } =
    await createServiceRoleClient()
      .from("accounts")
      .select("livekit_server_id")
      .eq("id", accountId)
      .maybeSingle();

  // 照合: presenceの自己申告値(claimedParticipantUserId、改造クライアント
  // から任意の値に書き換え可能)をそのまま信用せず、LiveKit参加者のmetadata
  // 〈発行時にサーバーが認証済みuser.idを埋め込んだもの、
  // app/api/livekit-token/route.ts:158-162〉と突き合わせる。この照合方法は
  // 同route.ts:115-148の既存のなりすまし対策と同じで、LiveKit側の機能・
  // 設定は変更しない(既存APIの読み取りのみ)。
  let verifiedUserId: string | null = null;
  if (livekitAccountError) {
    // (2026-11修正、M-2でも継続) 取得に失敗した場合、以前はnullとして扱い
    // resolveLivekitServerCredentialsの既定サーバーへ無言でフォールバック
    // していた。2台目以降を追加した際、別サーバーにいる対象者に対して
    // 誤ったサーバーへremoveParticipantを送ってしまう(LiveKit側は
    // 「見つからない」エラーになり、disconnectLivekitParticipant内で
    // 握りつぶされて管理者に気づかれない)ため、ログを残しスキップする。
    // 照合もできないため、本人確認ができなかった場合と同じ扱いにする。
    // eslint-disable-next-line no-console
    console.error(
      "LiveKitサーバー割り当ての取得に失敗したため、LiveKit強制退去と本人確認をスキップします",
      livekitAccountError,
    );
  } else {
    verifiedUserId = await resolveLivekitParticipantUserId(
      livekitAccount?.livekit_server_id ?? null,
      roomId,
      participantId,
    );
  }

  // 食い違い(なりすましの疑い): 照合できた値と自己申告値が両方あり、
  // 食い違う場合は強制退出もBANもせず、エラーを返す。
  if (
    verifiedUserId &&
    claimedParticipantUserId &&
    verifiedUserId !== claimedParticipantUserId
  ) {
    return { ok: false, error: translate(locale, "admin.identityMismatch") };
  }

  // 自分自身の拒否: 照合できた値・自己申告値のどちらかが操作している
  // 本人(管理者自身)のuser_idと一致したら、何もせずエラーを返す。
  // 管理者自身を誤ってBAN・強制退出し、自分自身のルームに入れなくなる
  // 事故を防ぐ(誰も解除できなくなってしまうため)。
  if (
    verifiedUserId === actingUserId ||
    claimedParticipantUserId === actingUserId
  ) {
    return { ok: false, error: translate(locale, "admin.cannotKickSelf") };
  }

  // BAN登録(banned_participantsへの書き込み)は、今すぐタブを閉じさせる
  // force-leaveの送信とは独立した「恒久的な再入室禁止」のための処理。
  // 照合できた値がある場合のみ使う。照合できなかった場合は、presenceの
  // 自己申告値では登録しない(なりすましの疑いがある対象を誤ってBAN
  // しないようにする、2026-11 M-2)。
  let banFailed = false;
  let banSkippedUnverified = false;
  if (verifiedUserId) {
    const { error: banError } = await supabase
      .from("banned_participants")
      .upsert({ account_id: accountId, user_id: verifiedUserId });
    if (banError) {
      // eslint-disable-next-line no-console
      console.error("BAN登録に失敗しました", banError);
      banFailed = true;
    }
  } else {
    banSkippedUnverified = true;
  }

  // LiveKit→位置同期WS→force-leaveブロードキャストの順で実行する
  // (2026-11-10変更。以前はforce-leaveを最初に送っていたが、force-leaveを
  // 受け取ったクライアントがwindow.location.reload()で自分から先に
  // LiveKitから退出してしまい〈CLIENT_REQUEST_LEAVE〉、その直後に届く
  // サーバー側のLiveKit removeParticipant呼び出しが「本人はもう存在しない」
  // 扱いで404 Not Foundになるレースが実機のログで確認された。force-leaveを
  // 最後に送ることで、クライアントが自分から動き出す前にLiveKit側の
  // 強制退去を確実に先着させる。なお、RoomEvent.Disconnected〈クライアント
  // 側〉はPARTICIPANT_REMOVED理由では再接続を試みない作りのため、この
  // 順序変更によるクライアントの見た目の変化は無い想定)。

  // LiveKit(音声・映像・画面共有)側も、相手のクライアントの協力に頼らず
  // サーバー側から強制退去させる(2026-11追加。既存のforce-leave
  // ブロードキャストは改造クライアントに無視され得るため)。livekit_server_id
  // の取得自体に失敗した場合は上で既にログを残してスキップ済み。
  //
  // 失敗(設定不足・タイムアウト・その他のエラー)は警告として管理画面に
  // 表示する(2026-11、「LiveKit強制退去の失敗が管理画面に出ない」課題への
  // 対応)。対象者が既に退出済みだった場合(disconnectLivekitParticipant
  // がServerError code:"not_found"を検知したケース)は失敗ではないため
  // 警告を出さない。タイムアウトのみ「失敗した」ではなく「退出を確認
  // できなかった」という趣旨の文言にする。
  let livekitWarningKey: string | null = null;
  if (livekitAccountError) {
    livekitWarningKey = "admin.livekitDisconnectFailedWarning";
  } else {
    const result = await disconnectLivekitParticipant(
      livekitAccount?.livekit_server_id ?? null,
      roomId,
      participantId,
    );
    if (!result.ok) {
      livekitWarningKey =
        result.reason === "timeout"
          ? "admin.livekitDisconnectTimeoutWarning"
          : "admin.livekitDisconnectFailedWarning";
    }
  }

  // position-sync経路(IndigoPro WSサーバー)の接続も合わせて切断する
  // (2026-11追加)。indigoモード未導入時は何もしない。participantIdは
  // selfId相当の値(force-leaveのtargetIdと同じ)。
  await disconnectIndigoConnections(roomId, participantId);

  try {
    await supabase
      .channel(`avatar-room-${roomId}`)
      .httpSend("force-leave", { reason: "admin-kicked", targetId: participantId });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("強制退出の送信に失敗しました", err);
    return { ok: false, error: translate(locale, "admin.forceLeaveFailed") };
  }

  // 複数の警告が同時に成立する場合(例: 本人確認はできなかったが、
  // LiveKit退去にも失敗した)があるため、ActionResult.warningの型
  // (string、単数)は変えずに1つの文字列へつなげる(2026-11)。
  const warnings: string[] = [];
  if (banFailed) warnings.push(translate(locale, "admin.banFailedWarning"));
  if (banSkippedUnverified) {
    warnings.push(translate(locale, "admin.identityUnverifiedWarning"));
  }
  if (livekitWarningKey) warnings.push(translate(locale, livekitWarningKey));
  if (warnings.length > 0) {
    return { ok: true, warning: warnings.join(" ") };
  }
  return { ok: true };
}

// BAN解除の実処理(2026-11 M-2で切り出し)。ダッシュボードと会議室内
// モーダルの両方から呼ばれる。
async function performUnban(
  supabase: ReturnType<typeof createClient>,
  accountId: string,
  userId: string,
  locale: Locale,
): Promise<ActionResult> {
  const { error } = await supabase
    .from("banned_participants")
    .delete()
    .eq("account_id", accountId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: translate(locale, "admin.unbanFailed") };

  return { ok: true };
}

// ダッシュボードの入室者一覧から、特定の参加者を強制退出させる(入口は
// 変更しない。requireAdminAccountでログイン切れならredirectする既存の
// 動きのまま)。revalidatePath("/admin")は共通関数(performKick)から外し、
// ここ(/adminからの呼び出し時のみ)で、成功時(ok: trueの時。警告付きの
// 成功を含む)だけ呼ぶ(2026-11、/master誤遷移の調査で確認した理由に
// よる。切り出し前の元のコードで、force-leave送信が失敗して早期returnした
// 場合はrevalidatePathが呼ばれていなかったのと同じ条件になる)。
export async function kickParticipant(
  roomId: string,
  participantId: string,
  participantUserId: string | null,
  locale: Locale = "ja",
): Promise<ActionResult> {
  const { supabase, account, user } = await requireAdminAccount();
  const result = await performKick(
    supabase,
    account.id,
    user.id,
    roomId,
    participantId,
    participantUserId,
    locale,
  );
  if (result.ok) revalidatePath("/admin");
  return result;
}

// BANリストから外し、再入室できるようにする(入口は変更しない)。
// revalidatePath("/admin")は共通関数(performUnban)から外し、ここでのみ
// 成功時に呼ぶ(kickParticipantと同じ理由)。
export async function unbanParticipant(
  userId: string,
  locale: Locale = "ja",
): Promise<ActionResult> {
  const { supabase, account } = await requireAdminAccount();
  const result = await performUnban(supabase, account.id, userId, locale);
  if (result.ok) revalidatePath("/admin");
  return result;
}

// 以下3つは会議室画面の管理者用モーダル(M-2、2026-11)から呼ぶ、
// redirectしないエントリポイント。会議室の画面を開いたままrequireAdminAccount
// のredirectを踏むとLiveKit/Realtimeの接続が切れてしまうため、認可には
// requireVerifiedBillingAccount(lib/billingAccountGuard.ts、無変更で
// そのまま呼ぶ)を使い、失敗時はエラーを返すだけで遷移はしない。

// BAN中の参加者一覧を取得する。
export async function listBannedParticipants(locale: Locale = "ja"): Promise<
  | {
      ok: true;
      data: { userId: string; displayName: string | null; bannedAt: string }[];
    }
  | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: translate(locale, "admin.loginRequired") };

  const verified = await requireVerifiedBillingAccount(supabase, user.id);
  if (!verified.ok) {
    return { ok: false, error: translate(locale, "admin.accountVerificationFailed") };
  }

  const { data, error } = await supabase.rpc("list_banned_participants", {
    p_account_id: verified.account.id,
  });
  if (error) {
    // eslint-disable-next-line no-console
    console.error("BAN一覧の取得に失敗しました", error);
    return { ok: false, error: translate(locale, "admin.banListFailed") };
  }

  return {
    ok: true,
    data: (
      (data ?? []) as {
        user_id: string;
        display_name: string | null;
        banned_at: string;
      }[]
    ).map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      bannedAt: row.banned_at,
    })),
  };
}

export async function kickParticipantFromModal(
  roomId: string,
  participantId: string,
  participantUserId: string | null,
  locale: Locale = "ja",
): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: translate(locale, "admin.loginRequired") };

  const verified = await requireVerifiedBillingAccount(supabase, user.id);
  if (!verified.ok) {
    return { ok: false, error: translate(locale, "admin.accountVerificationFailed") };
  }

  return performKick(
    supabase,
    verified.account.id,
    user.id,
    roomId,
    participantId,
    participantUserId,
    locale,
  );
}

export async function unbanParticipantFromModal(
  userId: string,
  locale: Locale = "ja",
): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: translate(locale, "admin.loginRequired") };

  const verified = await requireVerifiedBillingAccount(supabase, user.id);
  if (!verified.ok) {
    return { ok: false, error: translate(locale, "admin.accountVerificationFailed") };
  }

  return performUnban(supabase, verified.account.id, userId, locale);
}

// デバッグ用: 環境変数DEBUG_PLAN_SWITCH_EMAIL(カンマ区切りで複数指定可)に
// 含まれるアカウントだけが、自分のプランを4プランの中から自由に切り替え
// られる(動作確認用)。クライアント側の表示制御
// (app/admin/page.tsxのisDebugPlanSwitcherAllowed)とは別に、ここでも
// 必ずメールアドレスを再検証する(Server Actionは表示上のUIに関わらず
// 直接呼び出せるため)。
export async function debugSetPlan(
  planId: PlanId,
  locale: Locale = "ja",
): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: translate(locale, "admin.loginRequired") };

  const allowedEmails = (process.env.DEBUG_PLAN_SWITCH_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (!user.email || !allowedEmails.includes(user.email)) {
    return { ok: false, error: translate(locale, "admin.permissionDenied") };
  }

  if (!DEBUG_SWITCHABLE_PLANS.includes(planId)) {
    return { ok: false, error: translate(locale, "admin.invalidPlan") };
  }

  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (!account) return { ok: false, error: translate(locale, "admin.accountNotFound") };

  // planは本人による自己書き換えを防ぐDBトリガー(consolidated_setup.sql)の
  // 対象列のため、service_roleクライアントで更新する(直前にDEBUG_PLAN_SWITCH_EMAIL
  // でのメール照合を済ませているので、この1回の書き込みに限りRLS/トリガーを
  // バイパスしても安全)。
  const { error } = await createServiceRoleClient()
    .from("accounts")
    .update({ plan: planId })
    .eq("id", account.id);
  if (error) return { ok: false, error: translate(locale, "admin.planUpdateFailed") };

  await broadcastForceLeaveForAccount(supabase, account.id);

  revalidatePath("/admin");
  return { ok: true };
}
