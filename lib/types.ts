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
  message?: string; // 直近の発言(吹き出し表示用)
  messageAt?: number; // 発言タイムスタンプ
  meetingZoneId?: string | null; // 現在いるミーティングエリアのID(いなければnull)
  micOn?: boolean; // マイクが現在ONかどうか(相手にも表示する)
  sharingScreen?: boolean; // 画面共有中かどうか(相手にも表示する)
  inCall?: boolean; // ビデオ通話中かどうか(相手にも表示する)
  avatarImage?: string; // 選択したアバター画像のパス(例: /avatar/goo.png)
  status?: PresenceStatus; // 在席ステータス(未設定時はavailable扱い)
};

export const PRESENCE_STATUS_COLORS: Record<PresenceStatus, string> = {
  available: "#22c55e", // 緑:通話可能
  busy: "#ef4444", // 赤:取込み中
  away: "#f97316", // オレンジ:離席中
};

export const PRESENCE_STATUS_LABELS: Record<PresenceStatus, string> = {
  available: "通話可能",
  busy: "取込み中",
  away: "離席中",
};

// public/avatar 内の選択可能なアバター画像一覧
export const AVATAR_IMAGES = [
  "/avatar/goo.png",
  "/avatar/kids1.png",
  "/avatar/kids2.png",
  "/avatar/men.png",
  "/avatar/rabi.png",
  "/avatar/woman.png",
];

export const MAP_WIDTH = 1900;
export const MAP_HEIGHT = 1900;
export const AVATAR_RADIUS = 45; // アバターの表示サイズ計算に使う半径(当たり判定には使わない)
export const AVATAR_HITBOX_WIDTH = 20; // 当たり判定の幅(px)
export const AVATAR_HITBOX_HEIGHT = 20; // 当たり判定の高さ(px)
export const MOVE_SPEED = 220; // px / sec
export const CHAT_BUBBLE_DURATION_MS = 60000; // 1分間表示。新しいメッセージが来ると上書きされる
export const PROXIMITY_RADIUS = 68; // 近くにいる人だけ会話できる距離(近接ボイスチャット用。従来の1.5倍)

export type Rect = { x: number; y: number; width: number; height: number };

// マップ上の障害物(机・観葉植物・棚など)。歩いて通り抜けられないようにする。
export type Obstacle = Rect & { id: string; label: string };

// ミーティングエリア(複数設置可能。同じエリアIDにいる人同士だけ自動で音声接続される)
export type MeetingZone = Rect & { id: string; label: string };

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

// 移動(位置変更)時、幅・高さは変えずにマップの外へ出ないようx,yを制限する
export function clampPosition(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, 0), Math.max(MAP_WIDTH - width, 0)),
    y: Math.min(Math.max(y, 0), Math.max(MAP_HEIGHT - height, 0)),
  };
}

// リサイズ時、x,yは変えずに幅・高さがマップの外へはみ出さないよう、かつ最小サイズを下回らないよう制限する
export function clampSize(
  x: number,
  y: number,
  width: number,
  height: number,
): { width: number; height: number } {
  const maxWidth = Math.max(MAP_WIDTH - x, MIN_ITEM_SIZE);
  const maxHeight = Math.max(MAP_HEIGHT - y, MIN_ITEM_SIZE);
  return {
    width: Math.min(Math.max(width, MIN_ITEM_SIZE), maxWidth),
    height: Math.min(Math.max(height, MIN_ITEM_SIZE), maxHeight),
  };
}
