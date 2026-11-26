"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { disconnectIndigoConnections } from "@/lib/broadcastIndigoDisconnect";
import { disconnectLivekitParticipant } from "@/lib/disconnectLivekitParticipant";
import { resolveLivekitParticipantUserId } from "@/lib/resolveLivekitParticipantUserId";
import { requireVerifiedBillingAccount } from "@/lib/billingAccountGuard";
import { PLANS, type PlanId, type Announcement } from "@/lib/types";
import { translate, type Locale } from "@/lib/i18n/translations";
import sharp from "sharp";

// Server Actionのエラーはproduction buildだと.messageが汎用文言に
// 差し替えられてしまう(Next.jsの仕様)ため、throwではなく戻り値で
// 成否とエラーメッセージを伝える(app/master/actions.tsと同じ方針)。
type ActionResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

// 既存のルームに紐づくルームデザイン(テンプレート)を変更する実処理。
// 会議室内モーダル(updateRoomTemplateFromModal)から呼ばれる。ルーム名は
// 変更しない(既に名前を変えている場合を尊重するため)。
//
// roomId: モーダルからは常にnullで渡され、その場合はそのアカウントの
// 先頭ルーム(created_at昇順で1件)を自動で解決する(1アカウント1ルーム
// の前提)。
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

// お知らせの既読状態を更新する実処理。会議室内モーダル
// (markAnnouncementReadFromModal)から呼ばれる。revalidatePathは呼ばない
// (呼び出し元が必要な時だけ呼ぶ、performRegenerateInviteToken等と同じ方針)。
async function performMarkAnnouncementRead(
  supabase: ReturnType<typeof createClient>,
  accountId: string,
  announcementId: string,
): Promise<ActionResult> {
  const { error } = await supabase
    .from("announcement_reads")
    .upsert(
      { account_id: accountId, announcement_id: announcementId },
      { onConflict: "account_id,announcement_id" },
    );
  if (error) return { ok: false, error: "既読状態の更新に失敗しました" };
  return { ok: true };
}

// 管理画面モーダル化 M-5(2026-11)。会議室画面から開く、お知らせの
// 一覧・既読状態を取得する。published_atの降順で並べ、未来日付の予約投稿も
// 絞り込まずそのまま含める。
// M-1・M-3・M-4と同じく、認可にはrequireVerifiedBillingAccountを使い、
// 失敗時はエラーを返すだけで遷移はしない。accountIdは引数で受け取らない。
export async function getAdminAnnouncements(locale: Locale = "ja"): Promise<
  | { ok: true; announcements: (Announcement & { unread: boolean })[] }
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

  const { data: announcementRows } = await supabase
    .from("announcements")
    .select("id, title, body, title_en, body_en, published_at, created_at")
    .order("published_at", { ascending: false })
    .order("created_at", { ascending: false });

  const { data: announcementReadRows } = await supabase
    .from("announcement_reads")
    .select("announcement_id")
    .eq("account_id", verified.account.id);
  const readAnnouncementIds = new Set(
    (announcementReadRows ?? []).map((r) => r.announcement_id),
  );

  const announcements: (Announcement & { unread: boolean })[] = (
    announcementRows ?? []
  ).map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    titleEn: a.title_en,
    bodyEn: a.body_en,
    publishedAt: a.published_at,
    unread: !readAnnouncementIds.has(a.id),
  }));

  return { ok: true, announcements };
}

export async function markAnnouncementReadFromModal(
  announcementId: string,
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

  return performMarkAnnouncementRead(
    supabase,
    verified.account.id,
    announcementId,
  );
}

// 別掲の案(2026-11、採用)。設定パネルのボタン・左上タブに未読の印を
// 出すための軽量版。本文は返さず、未読があるかどうかのbooleanのみ返す。
export async function getHasUnreadAnnouncements(locale: Locale = "ja"): Promise<
  { ok: true; hasUnread: boolean } | { ok: false; error: string }
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

  const { data: announcementRows } = await supabase
    .from("announcements")
    .select("id");
  const { data: announcementReadRows } = await supabase
    .from("announcement_reads")
    .select("announcement_id")
    .eq("account_id", verified.account.id);
  const readAnnouncementIds = new Set(
    (announcementReadRows ?? []).map((r) => r.announcement_id),
  );
  const hasUnread = (announcementRows ?? []).some(
    (a) => !readAnnouncementIds.has(a.id),
  );

  return { ok: true, hasUnread };
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

// 管理画面モーダル化 M-4(2026-11)。会議室内の請求モーダル用の読み取り
// 専用Action。Stripeの実ID(stripe_customer_id/stripe_subscription_id)は
// booleanへ変換してのみ返す。読み取りのみのため、他の読み取り用Action
// (getAdminInviteInfo・
// getAdminRoomInfo)と同様にrevalidatePathは呼ばない。
export async function getAdminBillingInfo(locale: Locale = "ja"): Promise<
  | {
      ok: true;
      plan: PlanId;
      trialEndsAt: string | null;
      hasStripeCustomer: boolean;
      hasActiveSubscription: boolean;
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

  const { data: accountRow, error } = await supabase
    .from("accounts")
    .select("plan, trial_ends_at")
    .eq("id", verified.account.id)
    .maybeSingle();
  if (error || !accountRow) {
    // eslint-disable-next-line no-console
    console.error("請求情報の取得に失敗しました", error);
    return { ok: false, error: translate(locale, "admin.billingInfoLoadFailed") };
  }

  return {
    ok: true,
    plan: accountRow.plan as PlanId,
    trialEndsAt: accountRow.trial_ends_at,
    hasStripeCustomer: !!verified.account.stripe_customer_id,
    hasActiveSubscription: !!verified.account.stripe_subscription_id,
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

// 強制退出の実処理(2026-11 M-2で切り出し)。会議室内モーダル
// (kickParticipantFromModal経由)から呼ばれる共通処理。処理順(ルーム所有
// 確認→照合→食い違い・自分自身の確認→BAN登録→LiveKit退去→位置同期切断
// →force-leave送信)は、切り出し前のkickParticipantと同じ順序を維持して
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

// 以下3つは会議室画面の管理者用モーダル(M-2、2026-11)から呼ぶ、
// redirectしないエントリポイント。会議室の画面を開いたままredirectを
// 踏むとLiveKit/Realtimeの接続が切れてしまうため、認可には
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

// ②-2(2026-11追加)。スタンダード・プロの持ち主がロビーで自分のルームの
// ロゴ画像を差し替える。認可はrequireVerifiedBillingAccountではなく
// is_room_owner(p_room_id)を使う(roomId単位の持ち主判定のため。
// supabase/migrations/2026-11-26_room_logo.sql参照)。
const ROOM_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReplaceRoomLogoResult =
  | { ok: true; url: string | null }
  | { ok: false; error: string };

// rooms.logo_image_urlの公開URLから、room-logosバケット内のパスだけを
// 取り出す(削除にはバケット内のパスが必要)。形が想定と違えばnullを返す。
function roomLogoPathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = "/room-logos/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

// 前のロゴ画像を削除してよいパスかどうか。"{roomId}/"配下(変換済みの
// ロゴ本体)だけを対象とし、"{roomId}/raw/"配下(持ち主が直接アップロード
// した元画像、別の処理が別タイミングで参照・削除している可能性がある)は
// 対象から外す(app/master/actions.tsのisDeletableOldLogoPathと同じ考え方)。
function isDeletableRoomLogoPath(
  roomId: string,
  path: string | null,
): path is string {
  return (
    !!path &&
    path.startsWith(`${roomId}/`) &&
    !path.startsWith(`${roomId}/raw/`)
  );
}

async function removeOldRoomLogoIfAny(
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  roomId: string,
  oldUrl: string | null,
  keepPath?: string,
) {
  const oldPath = roomLogoPathFromUrl(oldUrl);
  if (isDeletableRoomLogoPath(roomId, oldPath) && oldPath !== keepPath) {
    await serviceClient.storage.from("room-logos").remove([oldPath]);
  }
}

type RoomLogoInfoRow = { logo_image_url: string | null; plan: string | null };

// rawPath(uploadRoomLogoRawImageClientが"{roomId}/raw/"配下へ直接
// アップロードした元画像)を、サービスロールで読み込み、sharpのmetadataで
// 形式を確かめ(png/jpeg/webp以外、SVGを含めて拒否)、長い辺1600px以下に
// 縮め(元が小さければ拡大しない)、WebP(quality 90、透明は保持)にして
// "{roomId}/"配下へ保存し直し、元画像(raw)を削除する。standard・pro
// プラン以外は断る(プランはget_room_logo_info経由で確認する。
// PLANS[plan]?.roomLogoEnabled参照)。
export async function replaceRoomLogo(
  roomId: string,
  rawPath: string,
): Promise<ReplaceRoomLogoResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ログインしてください" };

  if (!ROOM_ID_PATTERN.test(roomId)) {
    return { ok: false, error: "不正なルームIDです" };
  }

  const { data: isOwner } = await supabase.rpc("is_room_owner", {
    p_room_id: roomId,
  });
  if (!isOwner) {
    return { ok: false, error: "このルームの持ち主ではありません" };
  }

  if (!rawPath.startsWith(`${roomId}/raw/`) || rawPath.includes("..")) {
    return { ok: false, error: "不正な画像パスです" };
  }

  const serviceClient = createServiceRoleClient();

  const { data: logoInfoRows } = await supabase.rpc("get_room_logo_info", {
    p_room_id: roomId,
  });
  const logoInfo = (logoInfoRows as RoomLogoInfoRow[] | null)?.[0];
  const plan = (logoInfo?.plan ?? undefined) as PlanId | undefined;
  if (!plan || !PLANS[plan]?.roomLogoEnabled) {
    await serviceClient.storage.from("room-logos").remove([rawPath]);
    return { ok: false, error: "このプランではロゴを設定できません" };
  }

  // 形式の確認・変換・保存・rooms.logo_image_urlの更新のどこで失敗しても、
  // finallyでrawPathの元画像を必ず削除してから、分かりやすい日本語の
  // エラーを返す。
  let finalPath: string | null = null;
  let publicUrl: string | null = null;
  let errorMessage: string | null = null;
  try {
    const { data: rawBlob, error: downloadError } = await serviceClient.storage
      .from("room-logos")
      .download(rawPath);
    if (downloadError || !rawBlob) {
      throw new Error("DOWNLOAD_FAILED");
    }

    const inputBuffer = Buffer.from(await rawBlob.arrayBuffer());
    const metadata = await sharp(inputBuffer).metadata();
    // SVGもここで拒否される(png/jpeg/webp以外はすべて断るため)。
    if (!metadata.format || !["png", "jpeg", "webp"].includes(metadata.format)) {
      throw new Error("UNSUPPORTED_FORMAT");
    }

    const outputBuffer = await sharp(inputBuffer)
      .rotate() // EXIFの回転情報を反映してから焼き込む
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 90 }) // 透明な部分はwebp変換後も保持される
      .toBuffer();

    finalPath = `${roomId}/${crypto.randomUUID()}.webp`;
    const { error: uploadError } = await serviceClient.storage
      .from("room-logos")
      .upload(finalPath, outputBuffer, { contentType: "image/webp" });
    if (uploadError) throw uploadError;

    publicUrl = serviceClient.storage
      .from("room-logos")
      .getPublicUrl(finalPath).data.publicUrl;

    const { error: updateError } = await serviceClient
      .from("rooms")
      .update({ logo_image_url: publicUrl })
      .eq("id", roomId);
    if (updateError) throw updateError;
  } catch (err) {
    console.error("ルームロゴ画像の変換・保存に失敗しました", err);
    errorMessage =
      err instanceof Error && err.message === "UNSUPPORTED_FORMAT"
        ? "対応していない画像形式です(PNG/JPEG/WebPのみ、SVGは登録できません)"
        : "画像の変換に失敗しました";
  } finally {
    await serviceClient.storage.from("room-logos").remove([rawPath]);
  }

  if (errorMessage) {
    return { ok: false, error: errorMessage };
  }

  await removeOldRoomLogoIfAny(
    serviceClient,
    roomId,
    logoInfo?.logo_image_url ?? null,
    finalPath ?? undefined,
  );

  return { ok: true, url: publicUrl };
}

// ②-2。ルームのロゴをテンプレート標準のロゴへ戻す(rooms.logo_image_url
// をnullにする)。replaceRoomLogoと異なり、プランに関係なく持ち主なら
// 通す(ダウングレード後も「デフォルトに戻す」操作自体は行えてよい)。
export async function resetRoomLogo(
  roomId: string,
): Promise<ReplaceRoomLogoResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ログインしてください" };

  if (!ROOM_ID_PATTERN.test(roomId)) {
    return { ok: false, error: "不正なルームIDです" };
  }

  const { data: isOwner } = await supabase.rpc("is_room_owner", {
    p_room_id: roomId,
  });
  if (!isOwner) {
    return { ok: false, error: "このルームの持ち主ではありません" };
  }

  const serviceClient = createServiceRoleClient();

  const { data: logoInfoRows } = await supabase.rpc("get_room_logo_info", {
    p_room_id: roomId,
  });
  const logoInfo = (logoInfoRows as RoomLogoInfoRow[] | null)?.[0];

  const { error } = await serviceClient
    .from("rooms")
    .update({ logo_image_url: null })
    .eq("id", roomId);
  if (error) return { ok: false, error: "ロゴ画像の解除に失敗しました" };

  await removeOldRoomLogoIfAny(
    serviceClient,
    roomId,
    logoInfo?.logo_image_url ?? null,
  );

  return { ok: true, url: null };
}
