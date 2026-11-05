import type { PlayerState } from "./types";

// IndigoPro位置情報WSサーバー(deploy/indigo-position-ws/)への接続を
// 薄くラップするトランスポート層(2026-11追加)。POSITION_TRANSPORT
// ("lib/positionTransport.ts")が"indigo"の場合にのみcomponents/
// AvatarSpace.tsxから使われる。presence・チャット等は一切扱わない
// (このモジュールの関心事はmove/move-batchの送受信のみ)。

// 専用のstateイベント(B案)がまだ配線されていない間の暫定措置として、
// moveにはPlayerState一式(id・巨大になりうるscreenPreviewDataUrlを除く)を
// 乗せる(2026-11、Tech Lead指摘。Supabase側のmove(payload: self)と同じ
// 「状態一式を運ぶ」挙動に合わせる)。stateイベントの配線が完了次第、
// 座標専用の最小ペイロードに縮小する予定(deploy/indigo-position-ws/
// README.md参照)。
export type MovePayload = Omit<PlayerState, "id" | "screenPreviewDataUrl"> & {
  t: number;
  teleport?: boolean;
};

type MoveMessage = MovePayload & { id: string };

// deploy/indigo-position-ws/config.mjsのCLOSE_CODEと必ず一致させること
// (別デプロイのため型を共有できず、ここに複製する)。
const CLOSE_CODE = {
  FORCE_DISCONNECTED: 4001,
  SUPERSEDED: 4002,
  AUTH_FAILED: 4003,
  ROOM_REJECTED: 4004,
  PROTOCOL_ABUSE: 4005,
} as const;

export type TerminalReason =
  | "force-disconnected"
  | "superseded"
  | "protocol-abuse"
  | "room-rejected";

type GetToken = () => Promise<{ token: string; wsUrl: string }>;

export type IndigoPositionClient = {
  connect(roomId: string, getToken: GetToken): void;
  sendMove(payload: MovePayload): void;
  onMove(cb: (id: string, payload: MovePayload) => void): void;
  onMoveBatch(cb: (entries: MoveMessage[]) => void): void;
  // 4001(強制切断)・4002(同一ユーザーの新しい接続に取って代わられた)・
  // 4005(不正メッセージ連打による切断)は自動再接続しない。呼び出し側
  // (AvatarSpace.tsx)にUI表示等の判断を委ねるためのコールバック。
  onTerminal(cb: (reason: TerminalReason) => void): void;
  disconnect(): void;
};

// トークンの有効期限(~30分、app/api/indigo-token/route.ts参照)が切れる
// 前に、接続を維持したまま新しいトークンで再authenticateする(2026-11
// 設計レビュー: 「接続を維持したままのトークン更新」要件)。ぴったり
// 30分ではなく余裕を持って25分で更新する。
const TOKEN_REFRESH_MS = 25 * 60 * 1000;

// selfIdはcomponents/AvatarSpace.tsx側が既に持っている値(selfId.current)を
// 生成時に一度渡すだけでよい(接続中に変わることはないため)。
export function createIndigoPositionClient(selfId: string): IndigoPositionClient {
  let ws: WebSocket | null = null;
  let getToken: GetToken | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  // AUTH_FAILEDが連続する異常系(鍵の設定ミス等でトークンが恒久的に
  // 拒否され続ける場合)に、delay=0の即時再接続を無限に繰り返して
  // サーバー・トークン発行APIを叩き続けないための歯止め(2026-11、
  // レビューで発見)。正常系(期限切れによる単発のAUTH_FAILED)では
  // openイベントでリセットされるため、数回のうちに正常接続できれば
  // 即時再接続の体感は変わらない。
  let consecutiveAuthFailures = 0;
  const MAX_IMMEDIATE_AUTH_RETRIES = 3;
  let disposed = false;
  let roomId: string | null = null;

  let onMoveCb: ((id: string, payload: MovePayload) => void) | null = null;
  let onMoveBatchCb: ((entries: MoveMessage[]) => void) | null = null;
  let onTerminalCb: ((reason: TerminalReason) => void) | null = null;

  function clearTimers() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(immediate = false) {
    if (disposed || reconnectTimer) return;
    // 指数バックオフ+ジッター(基準1秒、上限30秒、±20%)。
    const base = Math.min(1000 * 2 ** reconnectAttempt, 30_000);
    const jitter = base * (0.8 + Math.random() * 0.4);
    const delay = immediate ? 0 : jitter;
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openConnection();
    }, delay);
  }

  async function openConnection() {
    if (disposed || !getToken || !roomId) return;
    let auth: { token: string; wsUrl: string };
    try {
      auth = await getToken();
    } catch (err) {
      console.warn("[indigoPositionClient] トークン取得に失敗しました", err);
      scheduleReconnect();
      return;
    }
    if (disposed) return;

    const socket = new WebSocket(auth.wsUrl);
    ws = socket;

    let stableTimer: ReturnType<typeof setTimeout> | null = null;
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "authenticate", token: auth.token }));
      reconnectAttempt = 0;
      scheduleTokenRefresh();
      // 認証の成否はopen直後には分からない(サーバーはauthenticate
      // メッセージを受け取って初めて検証する)ため、「open」ではなく
      // 「しばらく閉じずに生きていた」ことをもって接続が安定したとみなし、
      // AUTH_FAILED連続カウンタをリセットする。これが無いと、連続失敗時に
      // 毎回open→close(AUTH_FAILED)の1サイクルで即座にリセットされて
      // しまい、歯止めとして機能しない。
      stableTimer = setTimeout(() => {
        consecutiveAuthFailures = 0;
      }, 3000);
    });

    socket.addEventListener("message", (event) => {
      let msg: unknown;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (typeof msg !== "object" || msg === null || !("type" in msg)) return;
      const typed = msg as {
        type: string;
        id?: string;
        players?: MoveMessage[];
      } & Partial<MoveMessage>;
      if (typed.type === "move" && typed.id) {
        if (typed.id === selfId) return; // 自分自身の分は無視
        const { id, type: _type, players: _players, ...payload } = typed;
        onMoveCb?.(id, payload as MovePayload);
      } else if (typed.type === "move-batch" && Array.isArray(typed.players)) {
        // tick集約時は自分のIDを無視する(2026-11設計レビューの要件:
        // 自分のアバターが過去の位置に引き戻されないようにする)。
        const filtered = typed.players.filter((p) => p.id !== selfId);
        if (filtered.length > 0) onMoveBatchCb?.(filtered);
      }
    });

    socket.addEventListener("close", (event) => {
      if (ws === socket) ws = null;
      clearTimers();
      if (stableTimer) {
        clearTimeout(stableTimer);
        stableTimer = null;
      }
      if (disposed) return;

      switch (event.code) {
        case CLOSE_CODE.FORCE_DISCONNECTED:
          onTerminalCb?.("force-disconnected");
          return;
        case CLOSE_CODE.SUPERSEDED:
          onTerminalCb?.("superseded");
          return;
        case CLOSE_CODE.PROTOCOL_ABUSE:
          // 自動再接続しない(こちらの不具合か不正な挙動のいずれかのため、
          // 即座に再接続すると同じ検知を再トリガーするだけになる)。
          console.warn(
            "[indigoPositionClient] 不正メッセージ連打によりサーバーから切断されました(自動再接続しません)",
          );
          onTerminalCb?.("protocol-abuse");
          return;
        case CLOSE_CODE.ROOM_REJECTED:
          onTerminalCb?.("room-rejected");
          return;
        case CLOSE_CODE.AUTH_FAILED: {
          // トークン期限切れ・検証失敗。同じトークンを使い回さず、
          // 必ず新しいトークンを取得してから再接続する(getTokenを
          // openConnection内で毎回呼び直す設計のため、何もしなくても
          // 次のopenConnectionで新しいトークンが取られる)。ただし鍵の
          // 設定ミス等でトークンが恒久的に拒否され続ける異常系では、
          // 即時再接続(delay=0)を無限に繰り返してサーバー・トークン
          // 発行APIを叩き続けてしまうため、連続失敗がMAX_IMMEDIATE_
          // AUTH_RETRIES回を超えたら通常の指数バックオフに切り替える
          // (2026-11レビューで発見)。
          consecutiveAuthFailures += 1;
          scheduleReconnect(consecutiveAuthFailures <= MAX_IMMEDIATE_AUTH_RETRIES);
          return;
        }
        default:
          // 通常の切断(ネットワーク瞬断・サーバー再起動等)。指数
          // バックオフで再接続する。
          scheduleReconnect();
          return;
      }
    });

    socket.addEventListener("error", () => {
      // closeイベントが追って発火するため、ここでは何もしない
      // (二重に再接続をスケジュールしないため)。
    });
  }

  function scheduleTokenRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      if (disposed || !getToken || !ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        const auth = await getToken();
        ws.send(JSON.stringify({ type: "authenticate", token: auth.token }));
        scheduleTokenRefresh();
      } catch (err) {
        console.warn(
          "[indigoPositionClient] トークン更新に失敗しました(現在の接続は維持します)",
          err,
        );
        // 更新に失敗しても今の接続は維持する(元のトークンのexpが来れば
        // サーバー側のハートビート巡回で自然に切断され、AUTH_FAILEDの
        // 扱いで再接続される。deploy/indigo-position-ws/server.mjs参照)。
      }
    }, TOKEN_REFRESH_MS);
  }

  return {
    connect(newRoomId, newGetToken) {
      disposed = false;
      roomId = newRoomId;
      getToken = newGetToken;
      reconnectAttempt = 0;
      openConnection();
    },
    sendMove(payload) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "move", ...payload }));
    },
    onMove(cb) {
      onMoveCb = cb;
    },
    onMoveBatch(cb) {
      onMoveBatchCb = cb;
    },
    onTerminal(cb) {
      onTerminalCb = cb;
    },
    disconnect() {
      disposed = true;
      clearTimers();
      ws?.close();
      ws = null;
    },
  };
}
