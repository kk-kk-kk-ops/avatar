// 在席ステータス(通話可能/取込み中/離席中)。参加者一覧の丸アイコンの色に使う。
export type PresenceStatus = "available" | "busy" | "away";

export type PlayerState = {
  id: string; // ブラウザごとのランダムID(ゲストID)
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
// 表し、front/back/left/right.pngを向きに応じて出し分ける
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
];

// 向き(dir)ごとのファイル名
const AVATAR_DIR_FILENAMES: Record<PlayerState["dir"], string> = {
  up: "back",
  down: "front",
  left: "left",
  right: "right",
};

// アバター選択一覧やプレビューで使う「代表画像」。フォルダ形式ならfront.png、
// 1枚絵ならそのままの画像を返す。
export function getAvatarThumbnail(avatarImage: string): string {
  return isAvatarFolder(avatarImage)
    ? `${avatarImage}/front.png`
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
  return `${avatarImage}/${AVATAR_DIR_FILENAMES[dir]}.png`;
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

export type PlanId = "free" | "light" | "standard" | "pro" | "master";

// 各プランの上限(ルーム数、ルームごとの同時接続人数)と表示用ラベル。
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
  }
> = {
  free: {
    label: "無料お試し（7日間）",
    subLabel: "(スタンダードプラン)",
    priceLabel: "無料",
    priceYen: 0,
    maxRooms: 3,
    maxPeoplePerRoom: 20,
  },
  light: {
    label: "ライト",
    subLabel: "（ルーム数：1　1ルーム当たり人数上限：10名）",
    priceLabel: "980円/月",
    priceYen: 980,
    maxRooms: 1,
    maxPeoplePerRoom: 10,
  },
  standard: {
    label: "スタンダード",
    subLabel: "（ルーム数：2　1ルーム当たり人数上限：20名）",
    priceLabel: "3,980円/月",
    priceYen: 3980,
    maxRooms: 2,
    maxPeoplePerRoom: 20,
  },
  pro: {
    label: "プロ",
    subLabel: "（ルーム数：3　1ルーム当たり人数上限：30名）",
    priceLabel: "10,800円/月",
    priceYen: 10800,
    maxRooms: 3,
    maxPeoplePerRoom: 30,
  },
  // マスター権限を持つユーザー(運用担当者)自身のアカウント専用のプラン。
  // 課金対象ではないため、通常のプラン選択画面(/plan)には絶対に
  // 出さないこと(PLAN_ORDERに含めない)。マスター権限付与時にSQLで
  // accounts.planへ直接設定する(migrate_existing_owner.sql等)。
  master: {
    label: "マスター",
    subLabel: "（ルーム数：10　1ルーム当たり人数上限：30名）",
    priceLabel: "-",
    priceYen: 0,
    maxRooms: 10,
    maxPeoplePerRoom: 30,
  },
};

export const FREE_TRIAL_DAYS = 7;

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
export type MeetingZone = Rect & {
  id: string;
  label: string;
  kind?: "meeting" | "conference";
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
