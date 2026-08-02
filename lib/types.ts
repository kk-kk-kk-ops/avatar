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
  inMeetingArea?: boolean; // ミーティングエリア内にいるか(音声通話の自動接続判定に使用)
  micOn?: boolean; // マイクが現在ONかどうか(相手にも表示する)
};

export const MAP_WIDTH = 2500;
export const MAP_HEIGHT = 2500;
export const AVATAR_RADIUS = 18;
export const MOVE_SPEED = 220; // px / sec
export const CHAT_BUBBLE_DURATION_MS = 60000; // 1分間表示。新しいメッセージが来ると上書きされる
export const PROXIMITY_RADIUS = 45; // 近くにいる人だけ会話できる距離(近接ボイスチャット用。マス目=40pxの約1マス分)

// ミーティングエリアの矩形(画面表示のズーンと同じ座標)
export const MEETING_AREA = {
  x: 120,
  y: 120,
  width: 320,
  height: 220,
};

export function isInMeetingArea(
  x: number,
  y: number,
  area: { x: number; y: number; width: number; height: number } = MEETING_AREA,
): boolean {
  return (
    x >= area.x &&
    x <= area.x + area.width &&
    y >= area.y &&
    y <= area.y + area.height
  );
}

// マップ上の障害物(机・観葉植物・棚など)。歩いて通り抜けられないようにする。
export type Obstacle = {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
};

export const OBSTACLES: Obstacle[] = [
  { x: 700, y: 260, width: 140, height: 60, label: "🪑 デスク" },
  { x: 950, y: 480, width: 60, height: 60, label: "🪴" },
  { x: 480, y: 620, width: 160, height: 40, label: "📚 棚" },
  { x: 1100, y: 200, width: 100, height: 50, label: "🪑 デスク" },
];

// 円(アバター)と矩形(障害物)が重なっているかを判定する
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
