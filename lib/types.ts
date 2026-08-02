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
};

export const MAP_WIDTH = 1600;
export const MAP_HEIGHT = 1000;
export const AVATAR_RADIUS = 18;
export const MOVE_SPEED = 220; // px / sec
export const CHAT_BUBBLE_DURATION_MS = 60000; // 1分間表示。新しいメッセージが来ると上書きされる
export const PROXIMITY_RADIUS = 160; // 近くにいる人だけ会話できる目安(将来のボイス/絞り込みチャット用)
