import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { createClient } from "@/lib/supabase/server";
import type { MeetingZone, WarpPoint } from "@/lib/types";

// 連続リクエストの簡易な間引き(2026-11追加)。正規のクライアント
// (components/AvatarSpace.tsx)は入室時に1回+約25分おきの更新でしか
// このAPIを呼ばないため、ユーザーあたり数秒に1回を超える頻度は異常と
// みなして拒否する。Vercelのサーバーレス関数はインスタンスが使い捨てに
// なりうるため完全な保証ではない(ベストエフォート)が、同一インスタンスが
// 短時間に複数リクエストを捌く一般的なケースでは機能する。より厳密な
// 保証が必要な場合はSupabase等の永続ストアへの置き換えを検討すること。
const MIN_INTERVAL_MS = 3000;
const lastIssuedAt = new Map<string, number>();

// components/AvatarSpace.tsxから(POSITION_TRANSPORT==="indigo"の場合のみ)
// 呼ばれる、IndigoPro位置情報WSサーバー(deploy/indigo-position-ws/)用の
// 接続トークン発行API。app/api/livekit-token/route.tsと同じ認可パターン
// (本人確認→ルームへのアクセス権確認)を踏襲する。
//
// このWSサーバーはSupabaseの認証情報を一切保持しない設計(2026-11設計
// レビュー)のため、ルーム参加権限の確認・マップサイズ/ワープ地点/会議室
// ゾーン情報の取得は全てここ(Next.js側)で行い、結果を署名付きJWTに
// 埋め込んで渡す。WSサーバー側はトークンの署名検証だけで済む。
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

  const lastAt = lastIssuedAt.get(user.id);
  if (lastAt !== undefined && Date.now() - lastAt < MIN_INTERVAL_MS) {
    return NextResponse.json(
      { error: "リクエストが頻繁すぎます。しばらく待ってから再試行してください" },
      { status: 429 },
    );
  }

  // 通常ルート: 自分の所属アカウントのルームか(RLS経由でそのまま判定できる)
  const { data: ownRoom } = await supabase
    .from("rooms")
    .select("id, account_id, template_id")
    .eq("id", roomId)
    .maybeSingle();

  let accountId: string | undefined = ownRoom?.account_id;
  let templateId: string | null | undefined = ownRoom?.template_id;

  // viewOnlyルート: app/api/livekit-token/route.tsと同じ考え方(招待URLの
  // 一時閲覧者はprofiles.account_idが書き換わっていないためRLS経由の
  // SELECTでは見えない。招待トークンの一致をSECURITY DEFINER関数で検証する)。
  if (!accountId && inviteToken) {
    const { data: viewRooms } = await supabase.rpc(
      "list_rooms_by_invite_token",
      { token: inviteToken },
    );
    const matched = (
      viewRooms as Array<{
        id: string;
        account_id: string;
        template_id: string | null;
      }> | null
    )?.find((r) => r.id === roomId);
    accountId = matched?.account_id;
    templateId = matched?.template_id;
  }

  if (!accountId) {
    return NextResponse.json(
      { error: "このルームへのアクセス権がありません" },
      { status: 403 },
    );
  }

  // BAN済みユーザーへの対策(2026-11追加)。通常はapp/page.tsxのページ
  // 表示前のガードでBANユーザーはAvatarSpace.tsxに到達せずこのAPIも
  // 呼ばれないが、Server Action/Route Handlerはページを経由せず直接
  // 呼び出すこともできるため、ここでも直接確認する(Tech Lead指摘)。
  // ※app/api/livekit-token/route.tsには同じチェックが無く同様の穴が
  // あるが、今回はこのAPI(新設分)のみ対応し、別件として報告する。
  // クエリ自体が失敗した場合は「BANなし」として通さず、確認できるまで
  // 拒否する(2026-11修正。確認できないことを通行許可にしない。
  // app/api/livekit-token/route.ts側の同種の修正とあわせて対応)。
  const { data: ban, error: banError } = await supabase
    .from("banned_participants")
    .select("user_id")
    .eq("account_id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (banError) {
    // eslint-disable-next-line no-console
    console.error("BAN確認に失敗しました", banError);
    return NextResponse.json(
      { error: "アクセス権の確認に失敗しました。時間を置いて再度お試しください" },
      { status: 503 },
    );
  }
  if (ban) {
    return NextResponse.json(
      { error: "このルームへのアクセスが制限されています" },
      { status: 403 },
    );
  }

  if (!templateId) {
    return NextResponse.json(
      { error: "ルームにテンプレートが設定されていません" },
      { status: 500 },
    );
  }

  const { data: template } = await supabase
    .from("templates")
    .select("map_width, map_height, meeting_area, warp_points")
    .eq("id", templateId)
    .maybeSingle();

  if (!template || !template.map_width || !template.map_height) {
    return NextResponse.json(
      { error: "テンプレートのマップサイズが未設定です" },
      { status: 500 },
    );
  }

  // 会議室(conference)ゾーンのみをteleport検証用に埋め込む。会議室入室時の
  // 30px瞬間移動(components/AvatarSpace.tsxのconfirmMeetingEntry)だけが
  // 実際にteleport:trueを伴う正規の瞬間移動先のため(ミーティングエリア
  // (meeting)・作業エリア(work)・全体アナウンスエリア(announcement)は
  // 歩いて出入りするだけでteleportは発生しない)。他の種別まで埋め込むと、
  // それらのエリアへの不正なteleport申告を誤って正当と判定してしまう
  // (2026-11設計レビューで指摘、意図的な絞り込み)。
  const rawZones = template.meeting_area;
  const zonesArray = Array.isArray(rawZones)
    ? rawZones
    : rawZones
      ? [rawZones]
      : [];
  const zones = (zonesArray as Array<Partial<MeetingZone>>)
    .filter((z) => (z.kind ?? "meeting") === "conference")
    .map((z, i) => ({
      id: z.id ?? `meeting-${i}`,
      kind: "conference",
      x: z.x ?? 0,
      y: z.y ?? 0,
      w: z.width ?? 0,
      h: z.height ?? 0,
    }));

  // ワープ地点はchannel(A〜D)ごとに最大1ペア(2点)まで(lib/types.tsの
  // WarpPoint型コメント参照)。WSサーバー(deploy/indigo-position-ws/lib/
  // validateMove.mjs)はペア単位の[x1,y1,x2,y2]形式を期待するため、
  // channelでグルーピングしてペア化する。
  const rawWarpPoints = Array.isArray(template.warp_points)
    ? (template.warp_points as Array<Partial<WarpPoint>>)
    : [];
  const byChannel = new Map<string, Array<{ x: number; y: number }>>();
  for (const w of rawWarpPoints) {
    if (
      typeof w.x !== "number" ||
      typeof w.y !== "number" ||
      typeof w.channel !== "string"
    ) {
      continue;
    }
    const list = byChannel.get(w.channel) ?? [];
    list.push({ x: w.x, y: w.y });
    byChannel.set(w.channel, list);
  }
  const warpPairs: Array<[number, number, number, number]> = [];
  for (const points of byChannel.values()) {
    if (points.length === 2) {
      warpPairs.push([points[0].x, points[0].y, points[1].x, points[1].y]);
    }
    // 0点・1点(異常系、片方だけ設置されている等)は瞬間移動自体が発生
    // しないためスキップする。3点以上は現状のデータモデル上発生しない想定。
  }

  const secret = process.env.INDIGO_WS_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "IndigoPro位置情報サーバーの設定が不足しています" },
      { status: 500 },
    );
  }
  const indigoWsUrl = process.env.INDIGO_WS_URL;
  if (!indigoWsUrl) {
    return NextResponse.json(
      { error: "IndigoPro位置情報サーバーの接続先が未設定です" },
      { status: 500 },
    );
  }

  const kid = process.env.INDIGO_WS_KID || "production";

  // identity(=components/AvatarSpace.tsxのselfId)は、他の参加者がSupabase
  // presence経由で知ることができる値のため、なりすまし対策が必要(app/api/
  // livekit-token/route.tsのLiveKit側対策と同じ理由)。認証済みユーザーID
  // (ownerUserId)を別クレームとして埋め込み、WSサーバー側(deploy/
  // indigo-position-ws/)で「同じidentityへの新しい接続は、ownerUserIdが
  // 一致する場合だけ正規の再接続として許可する」検証を行う(2026-11、
  // このAPIの実装時に発見したセキュリティ上の必須対応)。
  const token = jwt.sign(
    {
      sub: identity,
      ownerUserId: user.id,
      roomId,
      kid,
      mapW: template.map_width,
      mapH: template.map_height,
      warpPairs,
      zones,
    },
    secret,
    { expiresIn: "30m" },
  );

  lastIssuedAt.set(user.id, Date.now());

  return NextResponse.json({ token, wsUrl: indigoWsUrl });
}
