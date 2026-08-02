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
};

export const MAP_WIDTH = 1600;
export const MAP_HEIGHT = 1000;
export const AVATAR_RADIUS = 18;
export const MOVE_SPEED = 220; // px / sec
export const CHAT_BUBBLE_DURATION_MS = 60000; // 1分間表示。新しいメッセージが来ると上書きされる
export const PROXIMITY_RADIUS = 160; // 近くにいる人だけ会話できる目安(将来のボイス/絞り込みチャット用)

// ミーティングエリアの矩形(画面表示のズーンと同じ座標)
export const MEETING_AREA = {
  x: 120,
  y: 120,
  width: 320,
  height: 220,
};

export function isInMeetingArea(x: number, y: number): boolean {
  return (
    x >= MEETING_AREA.x &&
    x <= MEETING_AREA.x + MEETING_AREA.width &&
    y >= MEETING_AREA.y &&
    y <= MEETING_AREA.y + MEETING_AREA.height
  );
}
