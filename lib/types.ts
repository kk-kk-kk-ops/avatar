// 在席ステータス(通話可能/取込み中/離席中)。参加者一覧の丸アイコンの色に使う。
export type PresenceStatus = "available" | "busy" | "away";

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
  micOn?: boolean; // マイクが現在ONかどうか(相手にも表示する)
  sharingScreen?: boolean; // 画面共有中かどうか(相手にも表示する)
  inCall?: boolean; // ビデオ通話中かどうか(相手にも表示する)
  watchingScreen?: boolean; // 誰かの画面共有を視聴中かどうか(マスター画面の集計用)
  avatarImage?: string; // 選択したアバター画像のパス(例: /avatar/goo.png)
  status?: PresenceStatus; // 在席ステータス(未設定時はavailable扱い)
};

export const PRESENCE_STATUS_COLORS: Record<PresenceStatus, string> = {
  available: "#22c55e", // 緑:通話可能
  busy: "#ef4444", // 赤:取込み中
  away: "#eab308", // 黄:離席中
};

export const PRESENCE_STATUS_LABELS: Record<PresenceStatus, string> = {
  available: "通話可能",
  busy: "取込み中",
  away: "離席中",
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
  width: number;
  height: number;
  // 入室時のアバター初期位置(当たり判定ボックスの中心座標。障害物・
  // エリアの左上座標とは座標系が異なるので注意)。未設定ならマップ中心
  // にスポーンする。
  spawnPoint: { x: number; y: number } | null;
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
      "（ミーティングルーム1つ　人数上限：5名／画面共有・ビデオ通話：1日5分まで／音声通話：1日45分まで）",
    priceLabel: "無料",
    priceYen: 0,
    maxRooms: 1,
    maxPeoplePerRoom: 5,
    screenShareDailyMinutes: 5,
    videoCallDailyMinutes: 5,
    voiceCallDailyMinutes: 45,
    roomCreation: "template-only",
    historyRetentionLabel: "7日",
  },
  light: {
    label: "ライト",
    subLabel:
      "（ミーティングルーム1つ　人数上限：10名／画面共有・ビデオ通話：1日45分まで／音声通話：1日90分まで）",
    priceLabel: "1,980円/月",
    priceYen: 1980,
    maxRooms: 1,
    maxPeoplePerRoom: 10,
    screenShareDailyMinutes: 45,
    videoCallDailyMinutes: 45,
    voiceCallDailyMinutes: 90,
    roomCreation: "template-only",
    historyRetentionLabel: "1ヶ月",
  },
  standard: {
    label: "スタンダード",
    subLabel:
      "（ミーティングルーム1つ　人数上限：15名／画面共有・ビデオ通話：1日90分まで／音声通話：無制限）",
    priceLabel: "4,980円/月",
    priceYen: 4980,
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
    subLabel: "（ミーティングルーム1つ　人数上限：30名／画面共有・ビデオ通話：無制限）",
    priceLabel: "9,800円/月",
    priceYen: 9800,
    maxRooms: 1,
    maxPeoplePerRoom: 30,
    screenShareDailyMinutes: null,
    videoCallDailyMinutes: null,
    voiceCallDailyMinutes: null,
    roomCreation: "template-or-original",
    historyRetentionLabel: "3ヶ月",
  },
};

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

export const MAP_WIDTH = 1900;
export const MAP_HEIGHT = 1900;
export const AVATAR_RADIUS = 8.5; // アバターの表示サイズ計算に使う半径(17px×17px表示。当たり判定には使わない)
export const AVATAR_HITBOX_WIDTH = 20; // 当たり判定の幅(px)
export const AVATAR_HITBOX_HEIGHT = 20; // 当たり判定の高さ(px)
export const MOVE_SPEED = 220; // px / sec
export const MESSAGE_MAX_LENGTH = 20; // 吹き出しの最大文字数
export const PROXIMITY_RADIUS = 68; // 近くにいる人だけ会話できる距離(近接ボイスチャット用。従来の1.5倍)

export type Rect = { x: number; y: number; width: number; height: number };

// マップ上の障害物(机・観葉植物・棚など)。歩いて通り抜けられないようにする。
export type Obstacle = Rect & { id: string; label: string };

// ミーティングエリア(複数設置可能。同じエリアIDにいる人同士だけ自動で音声接続される)。
// kind: "meeting"(デフォルト、省略時もこれと同じ扱い)はバーチャル空間内でも
// 枠・背景色・ラベルが見える通常のミーティングエリア。"conference"(会議室)は
// 機能(同エリア内での自動音声接続)は全く同じだが、バーチャル空間内では
// 背景透明・枠なし・ラベル非表示にして、見た目には存在が分からない
// エリアとして使う(テンプレート編集画面でだけ薄緑色+「会議室」と表示される)。
// "announcement"(全体アナウンスエリア)は同エリア内の自動音声接続に加えて、
// このエリア内でマイクONの人の音声だけを、距離・エリアに関わらずルーム内
// 全員に一方的に届ける(詳細はAvatarSpace.tsxのaudioEligiblePeerIds参照)。
export type MeetingZone = Rect & {
  id: string;
  label: string;
  kind?: "meeting" | "conference" | "announcement";
};

export const NEW_ITEM_SIZE = 100; // 新規追加時のデフォルトサイズ
export const MIN_ITEM_SIZE = 40; // これより小さくはできない

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

// 指定した位置(x, y)が障害物と重なっていた場合、その障害物の上端のすぐ上へ押し出した位置を返す。
// 重なっていなければそのままの位置を返す。
export function resolveSpawnPosition(
  x: number,
  y: number,
  obstaclesList: Rect[],
  halfWidth: number = AVATAR_HITBOX_WIDTH / 2,
  halfHeight: number = AVATAR_HITBOX_HEIGHT / 2,
): { x: number; y: number } {
  const hit = obstaclesList.find((o) =>
    rectIntersectsRect(x, y, halfWidth, halfHeight, o),
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
export function clampSize(
  x: number,
  y: number,
  width: number,
  height: number,
  mapWidth: number = MAP_WIDTH,
  mapHeight: number = MAP_HEIGHT,
): { width: number; height: number } {
  const maxWidth = Math.max(mapWidth - x, MIN_ITEM_SIZE);
  const maxHeight = Math.max(mapHeight - y, MIN_ITEM_SIZE);
  return {
    width: Math.min(Math.max(width, MIN_ITEM_SIZE), maxWidth),
    height: Math.min(Math.max(height, MIN_ITEM_SIZE), maxHeight),
  };
}
