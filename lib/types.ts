// 在席ステータス(通話可能/取込み中/離席中/チャットのみ可)。参加者一覧の
// 丸アイコンの色に使う。chatOnlyは表示上のステータスのみで、現状は
// マイク・ビデオ通話・画面共有を実際に制限する機能は持たない(work
// エリアのような強制OFFとは別物)。
export type PresenceStatus = "available" | "busy" | "away" | "chatOnly";

export type PlayerState = {
  id: string; // ブラウザごとのランダムID(ゲストID)
  userId?: string; // 認証済みSupabaseユーザーの安定ID(auth.uid())。DMの
  // 宛先特定に使う(idはリロードのたびに変わるため宛先には使えない)。
  name: string;
  color: string;
  x: number;
  y: number;
  dir: "up" | "down" | "left" | "right";
  moving: boolean;
  message?: string; // 吹き出しの内容(最大20文字)
  showMessage?: boolean; // 吹き出しを常時表示するかどうか(設定画面のチェックボックスで切り替え)
  meetingZoneId?: string | null; // 現在いるミーティングエリアのID(いなければnull)
  lockedMeetingZoneId?: string | null; // 施錠中の会議室(conference)ゾーンID。
  // このフィールドをpresence上に持たせることで、施錠者が異常切断した際も
  // presenceのleave検知だけで自動的に解錠扱いになる(専用の後始末処理が不要)。
  micOn?: boolean; // マイクが現在ONかどうか(相手にも表示する)
  sharingScreen?: boolean; // 画面共有中かどうか(相手にも表示する)
  // 画面共有開始時点の静止画プレビュー(dataURL)。broadcastは後から入室
  // した人には届かないため、presence経由でも渡せるようここに乗せる。
  screenPreviewDataUrl?: string | null;
  inCall?: boolean; // ビデオ通話中かどうか(相手にも表示する)
  watchingScreen?: boolean; // 誰かの画面共有を視聴中かどうか(マスター画面の集計用)
  avatarImage?: string; // 選択したアバター画像のパス(例: /avatar/goo.png)
  status?: PresenceStatus; // 在席ステータス(未設定時はavailable扱い)
};

export const PRESENCE_STATUS_COLORS: Record<PresenceStatus, string> = {
  available: "#22c55e", // 緑:通話可能
  busy: "#ef4444", // 赤:取込み中
  away: "#eab308", // 黄:離席中
  chatOnly: "#3b82f6", // 青:チャットのみ可
};

export const PRESENCE_STATUS_LABELS: Record<PresenceStatus, string> = {
  available: "通話可能",
  busy: "取込み中",
  away: "離席中",
  chatOnly: "チャットのみ可",
};

// public/avatar 内の選択可能なアバター画像一覧。
// 拡張子なしのパス(例: "/avatar/goo")は「向きごとの画像を持つフォルダ」を
// 表し、front/back/left/right.webpを向きに応じて出し分ける
// (getAvatarSpritePath参照)。拡張子ありのパスは従来通り1枚絵のアバター。
export const AVATAR_IMAGES = [
  "/avatar/goo",
  "/avatar/goo_blue",
  "/avatar/goo_yewllow",
  "/avatar/kids1",
  "/avatar/kids2",
  "/avatar/men",
  "/avatar/rabi",
  "/avatar/woman",
  "/avatar/woman2",
];

// 向き(dir)ごとのファイル名
const AVATAR_DIR_FILENAMES: Record<PlayerState["dir"], string> = {
  up: "back",
  down: "front",
  left: "left",
  right: "right",
};

// アバター選択一覧やプレビューで使う「代表画像」。フォルダ形式ならfront.webp、
// 1枚絵ならそのままの画像を返す。
export function getAvatarThumbnail(avatarImage: string): string {
  return isAvatarFolder(avatarImage)
    ? `${avatarImage}/front.webp`
    : avatarImage;
}

// avatarImageが拡張子を持たない場合、向きごとの画像を持つフォルダとみなす。
function isAvatarFolder(avatarImage: string): boolean {
  return !/\.[a-zA-Z0-9]+$/.test(avatarImage);
}

// 移動方向(dir)に応じたアバター画像のパスを返す。フォルダ形式でない
// (=1枚絵の)アバターは向きが変わっても常に同じ画像を返す。
export function getAvatarSpritePath(
  avatarImage: string,
  dir: PlayerState["dir"],
): string {
  if (!isAvatarFolder(avatarImage)) return avatarImage;
  return `${avatarImage}/${AVATAR_DIR_FILENAMES[dir]}.webp`;
}

// ルーム(バーチャル空間)。Supabaseのroomsテーブルの行に対応する
// (roomsテーブルはaccount単位で複数持てる)。
export type Room = {
  id: string;
  accountId: string;
  templateId: string | null;
  name: string;
  previewImage: string;
};

// マスター画面「アカウント」タブに表示する、契約(アカウント)の要約情報。
export type AccountSummary = {
  id: string;
  name: string;
  plan: PlanId;
  ownerEmail: string;
  livekitServerId: string | null;
  createdAt: string;
};

// マップのひな形。Supabaseのtemplatesテーブルの行に対応する。
// マップ編集はマスターがテンプレートに対して行い、個々のルームは常に
// 紐づくテンプレートのレイアウトを参照する(ルーム自身は編集不可)。
export type MapTemplate = {
  id: string;
  name: string;
  backgroundImageUrl: string;
  obstacles: Obstacle[];
  meetingZones: MeetingZone[];
  warpPoints: WarpPoint[];
  width: number;
  height: number;
  // 入室時のアバター初期位置(当たり判定ボックスの中心座標。障害物・
  // エリアの左上座標とは座標系が異なるので注意)。未設定ならマップ中心
  // にスポーンする。
  spawnPoint: { x: number; y: number } | null;
  // マップに配置できる装飾オブジェクト(2026-09追加)。登録済み画像の
  // ライブラリ(objectLibrary)と、実際にマップへ配置したインスタンス
  // (placedObjects)は別物。詳細はPlacedObject/TemplateObjectImageの
  // コメント参照。
  objectLibrary: TemplateObjectImage[];
  placedObjects: PlacedObject[];
};

// 「オブジェクト登録」で登録した透過PNG画像のライブラリ(テンプレートごと)。
// マップ上への配置はこれとは別のPlacedObjectで、同じimageUrlを何度でも
// 挿入できる(=1枚の画像から複数のインスタンスを作れる)。ライブラリから
// 削除しても、既にマップへ配置済みのPlacedObjectはそれぞれ自分自身の
// imageUrlを持っているため影響を受けない(Storage上の実ファイルも
// 削除しない。既に配置済みのインスタンスの表示を壊さないため)。
export type TemplateObjectImage = { id: string; imageUrl: string };

// マップに配置した装飾オブジェクトのインスタンス。壁(Obstacle)と違い、
// 実際に画像として表示され、当たり判定は持たない(アバターは自由に
// 通り抜けられる)。バーチャル空間内での重なり順は、背景画像 < アバター
// < オブジェクト(常に最前面)に固定する(AvatarSpace.tsx参照)。
export type PlacedObject = Rect & {
  id: string;
  imageUrl: string;
  rotation?: number;
};

// 契約単位の組織。Supabaseのaccountsテーブルの行に対応する。
export type Account = {
  id: string;
  name: string;
  plan: PlanId;
  trialEndsAt: string | null;
  ownerUserId: string;
  inviteToken: string;
};

export type ProfileRole = "admin" | "guest";

export type PlanId = "free" | "light" | "standard" | "pro";

// 各プランの上限(ルーム数、ルームごとの同時接続人数、画面共有・ビデオ通話・
// 音声通話の1日あたり利用可能時間)と表示用ラベル。
// screenShareDailyMinutes/videoCallDailyMinutes/voiceCallDailyMinutesは
// nullで「無制限」を表す(無制限プランでは日次カウント自体を行わない)。
// roomCreationは表示用(契約情報画面向け)で、実際のアクセス制御はまだ
// 存在しない(テンプレート以外のルーム作成機能自体が未実装のため)。
// 料金・上限はサービス側の固定値のためDBではなくここで管理する。
export const PLANS: Record<
  PlanId,
  {
    label: string;
    subLabel: string;
    priceLabel: string;
    priceYen: number; // 概算のサブスク合計金額集計に使う(Stripe連携後は実額に置き換える)
    maxRooms: number;
    maxPeoplePerRoom: number;
    screenShareDailyMinutes: number | null; // 1人1日あたりの画面共有可能時間(分)。毎日4:00にリセット。nullは無制限
    videoCallDailyMinutes: number | null; // 1人1日あたりのビデオ通話可能時間(分)。毎日4:00にリセット。nullは無制限
    voiceCallDailyMinutes: number | null; // 1人1日あたりの音声通話可能時間(分)。毎日4:00にリセット。nullは無制限
    roomCreation: "template-only" | "template-or-original"; // 表示用。ルーム作成方法の説明
    historyRetentionLabel: string; // チャット・画像履歴の保管期間(表示用)。実際の削除判定は
    // supabase/consolidated_setup.sqlのget_expired_chat_message_ids()に同じ期間をハードコードしている
    // (DBはこの表示値を読まない。他の上限値と同じくコード側を唯一の情報源とする方針のため)
  }
> = {
  free: {
    label: "無料",
    subLabel:
      "（ミーティングルーム1つ　人数上限：5名／画面共有・ビデオ通話：1日5分まで／音声通話：無制限）",
    priceLabel: "0円/月",
    priceYen: 0,
    maxRooms: 1,
    maxPeoplePerRoom: 5,
    screenShareDailyMinutes: 5,
    videoCallDailyMinutes: 5,
    voiceCallDailyMinutes: null,
    roomCreation: "template-only",
    historyRetentionLabel: "7日",
  },
  light: {
    label: "ライト",
    subLabel:
      "（ミーティングルーム1つ　人数上限：10名／画面共有・ビデオ通話：1日45分まで／音声通話：無制限）",
    priceLabel: "2,980円/月",
    priceYen: 2980,
    maxRooms: 1,
    maxPeoplePerRoom: 10,
    screenShareDailyMinutes: 45,
    videoCallDailyMinutes: 45,
    voiceCallDailyMinutes: null,
    roomCreation: "template-only",
    historyRetentionLabel: "1ヶ月",
  },
  standard: {
    label: "スタンダード",
    subLabel:
      "（ミーティングルーム1つ　人数上限：15名／画面共有・ビデオ通話：1日90分まで／音声通話：無制限）",
    priceLabel: "5,980円/月",
    priceYen: 5980,
    maxRooms: 1,
    maxPeoplePerRoom: 15,
    screenShareDailyMinutes: 90,
    videoCallDailyMinutes: 90,
    voiceCallDailyMinutes: null,
    roomCreation: "template-only",
    historyRetentionLabel: "1ヶ月",
  },
  pro: {
    label: "プロ",
    subLabel:
      "（ミーティングルーム1つ　人数上限：25名／画面共有・ビデオ通話・音声通話：無制限）",
    priceLabel: "9,800円/月",
    priceYen: 9800,
    maxRooms: 1,
    maxPeoplePerRoom: 25,
    screenShareDailyMinutes: null,
    videoCallDailyMinutes: null,
    voiceCallDailyMinutes: null,
    roomCreation: "template-or-original",
    historyRetentionLabel: "3ヶ月",
  },
};

// 「1人/1日◯分」/「無制限」の表示テキストをPLANSの値から生成する
// (プラン選択画面・契約情報画面の両方でこの関数を使い、表示ロジックの
// 重複を避ける)。
export function formatPlanDailyLimit(minutes: number | null): string {
  return minutes === null ? "無制限" : `1人/1日${minutes}分`;
}

// プラン選択画面・契約情報画面で共通して使うプランの項目一覧
// (「ルーム」の作成方法説明を含む)。
export function formatPlanRoomLabel(
  roomCreation: "template-only" | "template-or-original",
): string {
  return roomCreation === "template-or-original"
    ? "テンプレート＋オリジナル作成可"
    : "テンプレートのみ";
}

export const FREE_TRIAL_DAYS = 7;

// チャットへの画像添付、1日あたりのアップロード上限枚数(全プラン共通)。
export const DAILY_IMAGE_UPLOAD_LIMIT = 30;

// チャット画像添付の制約(サーバー側compress-image route・クライアント側
// バリデーションの両方で参照する単一の情報源)。
// 15MB: iPhoneの高解像度写真(HEIC/JPEG書き出し)を実用上ほぼカバーできる
// 目安として設定。サーバー側の圧縮(sharp)は元ファイルサイズに対して
// 十分高速(23MBのノイズ画像でも約0.4秒)なため、この程度の引き上げでは
// 処理負荷上の懸念はない。生画像はブラウザから直接Supabase Storageへ
// アップロードするため(Vercelサーバーレス関数のボディサイズ上限は
// 経由しない)、Vercel側の制約も受けない。
export const CHAT_IMAGE_MAX_BYTES = 15 * 1024 * 1024; // 15MB
export const CHAT_IMAGE_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

// タブ切替・アプリのバックグラウンド化が続いた際、ルームから自動退室
// させるまでの秒数(永遠入室状態を防ぐため)。将来的に見直す可能性が
// あるため定数として切り出している。
// PC: マイク・ビデオ通話・画面共有のいずれもOFFの場合のみ対象。タブ
// 非アクティブでもすぐには退出させず、8時間の猶予を持たせる(ログイン
// 状態は維持したままルームから退室するだけ。アカウントのログアウトは
// しない)。
export const DESKTOP_AUTO_LOGOUT_SECONDS = 8 * 60 * 60;
// スマホ: 画面オフ・アプリ切替はブラウザ側の仕様上区別できないため、
// どちらも同じ「非表示」として扱う。通話中かどうかに関わらず強制的に
// マイク・ビデオをOFFにしたうえで、10分の猶予後にルームから退室させる
// (2026-09報告によりPCと同じ「退室のみ・ログアウトはしない」挙動に変更。
// 以前はアカウントごとログアウトしていたが、その仕様は廃止した)。
// ブラウザ自体を閉じた場合は別途pagehideイベントで即座に退室させる
// (AvatarSpace.tsx参照。iOS Safariでは発火が保証されない場合がある)。
export const MOBILE_AUTO_LOGOUT_SECONDS = 10 * 60;

export const MAP_WIDTH = 1900;
export const MAP_HEIGHT = 1900;
export const AVATAR_RADIUS = 8.5; // アバターの表示サイズ計算に使う半径(17px×17px表示。当たり判定には使わない)
export const AVATAR_HITBOX_WIDTH = 20; // 当たり判定の幅(px)
export const AVATAR_HITBOX_HEIGHT = 20; // 当たり判定の高さ(px)
export const MOVE_SPEED = 220; // px / sec
export const MESSAGE_MAX_LENGTH = 20; // 吹き出しの最大文字数
export const PROXIMITY_RADIUS = 98; // 近くにいる人だけ会話できる距離(近接ボイスチャット用。E-5で+20px拡大、2026-08-24でさらに+10px拡大)

export type Rect = { x: number; y: number; width: number; height: number };

// マップ上の障害物(机・観葉植物・棚など)。歩いて通り抜けられないようにする。
// rotation: 中心を軸にした回転角度(度数法、時計回り)。未設定/0は回転なし
// (既存データにはこのキーが無いが、読み出し側で ?? 0 として扱うため
// マイグレーション不要)。
export type Obstacle = Rect & { id: string; label: string; rotation?: number };

// ミーティングエリア(複数設置可能。同じエリアIDにいる人同士だけ自動で音声接続される)。
// kind: "meeting"(デフォルト、省略時もこれと同じ扱い)はバーチャル空間内でも
// 枠・背景色・ラベルが見える通常のミーティングエリア。"conference"(会議室)は
// 機能(同エリア内での自動音声接続)は全く同じだが、バーチャル空間内では
// 背景透明・枠なし・ラベル非表示にして、見た目には存在が分からない
// エリアとして使う(テンプレート編集画面でだけ薄緑色+「会議室」と表示される)。
// "announcement"(全体アナウンスエリア)は同エリア内の自動音声接続に加えて、
// このエリア内でマイクONの人の音声だけを、距離・エリアに関わらずルーム内
// 全員に一方的に届ける(詳細はAvatarSpace.tsxのaudioEligiblePeerIds参照)。
// "work"(作業エリア)は音声通話・ビデオ通話・画面共有のいずれも利用不可
// (エリア内では強制的にOFFになり、ONにもできない)にするための専用エリア。
export type MeetingZone = Rect & {
  id: string;
  label: string;
  kind?: "meeting" | "conference" | "announcement" | "work";
};

// ワープポイント(2026-09)。同じchannel("A"/"B"/"C")の2点が1ペアになり、
// 片方の円にアバターが入ったらもう片方の円の座標へ瞬間移動する
// (双方向)。x,yは円の中心座標(Obstacle/MeetingZoneが左上基準なのとは
// 座標系が異なるので注意)。channelごとに最大1ペア(2点)まで。
// label: 丸ごとに個別に付けられる任意の名前(未設定なら空扱い)。ワープの
// 外側(上部)に表示する。同じchannelの2つの丸それぞれに別の名前を
// 付けられるようにするためのもの(channel自体はA/B/C固定でペア判定用)。
export type WarpPoint = { id: string; channel: "A" | "B" | "C"; x: number; y: number; label?: string };
export const WARP_CHANNELS = ["A", "B", "C"] as const;
export const WARP_POINT_RADIUS = 36; // 円の表示半径・当たり判定半径(px)

export const NEW_ITEM_SIZE = 100; // 新規追加時のデフォルトサイズ
export const MIN_ITEM_SIZE = 40; // これより小さくはできない
// 障害物(壁)は幅・高さともに、これまでの最小値からさらに半分の細さ
// まで許容する(幅: 20→10、高さ: 40→20)。自由回転に対応したことで、
// 細く絞った壁を回転させれば見た目上は高さが細い壁にもなるため、幅・
// 高さどちらの最小値も一緒に縮小できるようにしている。
export const MIN_OBSTACLE_WIDTH = 10;
export const MIN_OBSTACLE_HEIGHT = 20;

export const DEFAULT_OBSTACLES: Obstacle[] = [
  {
    id: "obstacle-1",
    x: 700,
    y: 260,
    width: 140,
    height: 60,
    label: "🪑 デスク",
  },
  { id: "obstacle-2", x: 950, y: 480, width: 60, height: 60, label: "🪴" },
  { id: "obstacle-3", x: 480, y: 620, width: 160, height: 40, label: "📚 棚" },
  {
    id: "obstacle-4",
    x: 1100,
    y: 200,
    width: 100,
    height: 50,
    label: "🪑 デスク",
  },
];

export const DEFAULT_MEETING_ZONES: MeetingZone[] = [
  {
    id: "meeting-default",
    x: 120,
    y: 120,
    width: 320,
    height: 220,
    label: "ミーティングエリア",
  },
];

export function randomItemId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

// 座標(x, y)がどのミーティングエリアに含まれているかを判定し、そのIDを返す(なければnull)
export function findMeetingZoneId(
  x: number,
  y: number,
  zones: MeetingZone[],
): string | null {
  const zone = zones.find(
    (z) => x >= z.x && x <= z.x + z.width && y >= z.y && y <= z.y + z.height,
  );
  return zone ? zone.id : null;
}

// 円(アバター)と矩形(障害物・エリア)が重なっているかを判定する
export function circleIntersectsRect(
  cx: number,
  cy: number,
  radius: number,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.width));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.height));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < radius * radius;
}

// 矩形(アバターの当たり判定)と矩形(障害物・エリア)が重なっているかを判定する。
// cx, cyは矩形の中心座標、halfWidth/halfHeightはその半分のサイズ。
export function rectIntersectsRect(
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  const left = cx - halfWidth;
  const right = cx + halfWidth;
  const top = cy - halfHeight;
  const bottom = cy + halfHeight;
  return (
    left < rect.x + rect.width &&
    right > rect.x &&
    top < rect.y + rect.height &&
    bottom > rect.y
  );
}

// 矩形(アバターの当たり判定)と障害物(壁)が重なっているかを判定する。
// 壁が回転している場合はSAT(分離軸定理)で厳密な矩形×矩形判定を行う
// (アバターの当たり判定自体も矩形のため、壁を逆回転させてアバターの
// 中心点だけをAABB判定する近似だと、壁の角付近でアバター側の矩形の
// 傾きを無視してしまいすり抜け/引っかかりが起きうる。壁の枚数は多くても
// 数百枚程度を想定しており、三角関数・内積を数回追加する程度のコストは
// 無視できる)。回転なし(未設定/0)の場合は既存のrectIntersectsRectに
// 委譲し、非回転の壁の挙動を完全に維持する。
export function rectIntersectsObstacle(
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
  obstacle: Obstacle,
): boolean {
  const rotation = obstacle.rotation ?? 0;
  if (rotation === 0) {
    return rectIntersectsRect(cx, cy, halfWidth, halfHeight, obstacle);
  }

  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const obstacleCenterX = obstacle.x + obstacle.width / 2;
  const obstacleCenterY = obstacle.y + obstacle.height / 2;
  const obstacleHalfWidth = obstacle.width / 2;
  const obstacleHalfHeight = obstacle.height / 2;

  const dx = obstacleCenterX - cx;
  const dy = obstacleCenterY - cy;

  // 判定軸4本: アバター側(X軸・Y軸)、壁側(回転後のローカルX軸・Y軸)
  const axes = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: cos, y: sin },
    { x: -sin, y: cos },
  ];

  return axes.every((axis) => {
    const centerDistance = Math.abs(dx * axis.x + dy * axis.y);
    const avatarExtent =
      halfWidth * Math.abs(axis.x) + halfHeight * Math.abs(axis.y);
    const obstacleExtent =
      obstacleHalfWidth * Math.abs(cos * axis.x + sin * axis.y) +
      obstacleHalfHeight * Math.abs(-sin * axis.x + cos * axis.y);
    return centerDistance <= avatarExtent + obstacleExtent;
  });
}

// 指定した位置(x, y)が障害物と重なっていた場合、その障害物の上端のすぐ上へ押し出した位置を返す。
// 重なっていなければそのままの位置を返す。
export function resolveSpawnPosition(
  x: number,
  y: number,
  obstaclesList: Obstacle[],
  halfWidth: number = AVATAR_HITBOX_WIDTH / 2,
  halfHeight: number = AVATAR_HITBOX_HEIGHT / 2,
): { x: number; y: number } {
  const hit = obstaclesList.find((o) =>
    rectIntersectsObstacle(x, y, halfWidth, halfHeight, o),
  );
  if (!hit) return { x, y };
  const adjustedY = Math.max(hit.y - halfHeight, halfHeight);
  return { x, y: adjustedY };
}

// 移動(位置変更)時、幅・高さは変えずにマップの外へ出ないようx,yを制限する。
// mapWidth/mapHeightを省略した場合は既定のMAP_WIDTH/MAP_HEIGHTを使う
// (テンプレートごとにマップサイズを変えられるようにしたため引数化した)。
export function clampPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  mapWidth: number = MAP_WIDTH,
  mapHeight: number = MAP_HEIGHT,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, 0), Math.max(mapWidth - width, 0)),
    y: Math.min(Math.max(y, 0), Math.max(mapHeight - height, 0)),
  };
}

// リサイズ時、x,yは変えずに幅・高さがマップの外へはみ出さないよう、かつ最小サイズを下回らないよう制限する
// minWidth/minHeightを省略した場合はMIN_ITEM_SIZE(通常の最小サイズ)を使う
// (障害物だけ細い壁を作れるようMIN_OBSTACLE_WIDTHを渡せるようにするため引数化した)。
export function clampSize(
  x: number,
  y: number,
  width: number,
  height: number,
  mapWidth: number = MAP_WIDTH,
  mapHeight: number = MAP_HEIGHT,
  minWidth: number = MIN_ITEM_SIZE,
  minHeight: number = MIN_ITEM_SIZE,
): { width: number; height: number } {
  const maxWidth = Math.max(mapWidth - x, minWidth);
  const maxHeight = Math.max(mapHeight - y, minHeight);
  return {
    width: Math.min(Math.max(width, minWidth), maxWidth),
    height: Math.min(Math.max(height, minHeight), maxHeight),
  };
}
