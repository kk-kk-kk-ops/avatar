"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  PlayerState,
  MAP_WIDTH,
  MAP_HEIGHT,
  AVATAR_RADIUS,
  MOVE_SPEED,
} from "@/lib/types";
import Avatar from "./Avatar";
import TouchControls from "./TouchControls";

const ROOM_NAME = "avatar-room-main";
const COLORS = ["#F97316", "#3B82F6", "#22C55E", "#EC4899", "#A855F7", "#EAB308", "#14B8A6"];

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

export default function AvatarSpace() {
  const [joined, setJoined] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [players, setPlayers] = useState<Record<string, PlayerState>>({});

  const selfId = useRef<string>(randomId());
  const selfState = useRef<PlayerState | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const keysDown = useRef<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameTime = useRef<number>(performance.now());

  // ---- 入室処理 ----
  const handleJoin = useCallback(() => {
    const name = nameInput.trim() || `ゲスト${selfId.current.slice(0, 4)}`;
    const initial: PlayerState = {
      id: selfId.current,
      name,
      color: randomColor(),
      x: MAP_WIDTH / 2,
      y: MAP_HEIGHT / 2,
      dir: "down",
      moving: false,
    };
    selfState.current = initial;
    setPlayers((prev) => ({ ...prev, [initial.id]: initial }));
    setJoined(true);
  }, [nameInput]);

  // ---- Supabase Realtimeチャンネルの接続 ----
  useEffect(() => {
    if (!joined) return;

    const channel = supabase.channel(ROOM_NAME, {
      config: { presence: { key: selfId.current } },
    });
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PlayerState>();
        const next: Record<string, PlayerState> = {};
        Object.values(state).forEach((entries) => {
          const p = entries[0] as unknown as PlayerState;
          next[p.id] = p;
        });
        // 自分の最新状態は selfState を優先(presence syncのタイムラグ対策)
        if (selfState.current) next[selfState.current.id] = selfState.current;
        setPlayers(next);
      })
      .on("presence", { event: "leave" }, ({ key }) => {
        setPlayers((prev) => {
          const copy = { ...prev };
          delete copy[key];
          return copy;
        });
      })
      .on("broadcast", { event: "move" }, ({ payload }) => {
        const p = payload as PlayerState;
        if (p.id === selfId.current) return;
        setPlayers((prev) => ({ ...prev, [p.id]: p }));
      })
      .on("broadcast", { event: "chat" }, ({ payload }) => {
        const { id, message } = payload as { id: string; message: string };
        setPlayers((prev) => {
          if (!prev[id]) return prev;
          return {
            ...prev,
            [id]: { ...prev[id], message, messageAt: Date.now() },
          };
        });
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED" && selfState.current) {
          await channel.track(selfState.current);
        }
      });

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [joined]);

  // ---- キーボード入力 ----
  useEffect(() => {
    if (!joined) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "INPUT") return;
      keysDown.current.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysDown.current.delete(e.key.toLowerCase());
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [joined]);

  // ---- 移動ループ(requestAnimationFrame) ----
  useEffect(() => {
    if (!joined) return;

    const loop = (time: number) => {
      const dt = Math.min((time - lastFrameTime.current) / 1000, 0.05);
      lastFrameTime.current = time;

      const self = selfState.current;
      if (self) {
        let dx = 0;
        let dy = 0;
        const keys = keysDown.current;
        if (keys.has("arrowup") || keys.has("w")) dy -= 1;
        if (keys.has("arrowdown") || keys.has("s")) dy += 1;
        if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
        if (keys.has("arrowright") || keys.has("d")) dx += 1;

        const moving = dx !== 0 || dy !== 0;

        if (moving) {
          const len = Math.hypot(dx, dy) || 1;
          dx = (dx / len) * MOVE_SPEED * dt;
          dy = (dy / len) * MOVE_SPEED * dt;

          self.x = Math.min(Math.max(self.x + dx, AVATAR_RADIUS), MAP_WIDTH - AVATAR_RADIUS);
          self.y = Math.min(Math.max(self.y + dy, AVATAR_RADIUS), MAP_HEIGHT - AVATAR_RADIUS);

          if (Math.abs(dx) > Math.abs(dy)) {
            self.dir = dx > 0 ? "right" : "left";
          } else if (dy !== 0) {
            self.dir = dy > 0 ? "down" : "up";
          }
        }
        self.moving = moving;

        // ローカル描画を即時反映
        setPlayers((prev) => ({ ...prev, [self.id]: { ...self } }));

        // 動いた時だけ他プレイヤーへブロードキャスト(通信量を抑制)
        if (moving && channelRef.current) {
          channelRef.current.send({
            type: "broadcast",
            event: "move",
            payload: self,
          });
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [joined]);

  // ---- スマホ用タッチ操作(既存のkeysDownセットに仮想キーを追加/削除するだけ) ----
  const handleTouchPress = useCallback((key: string) => {
    keysDown.current.add(key);
  }, []);
  const handleTouchRelease = useCallback((key: string) => {
    keysDown.current.delete(key);
  }, []);

  // ---- チャット送信 ----
  const sendChat = useCallback(() => {
    const message = chatInput.trim();
    if (!message || !selfState.current) return;
    const id = selfState.current.id;

    setPlayers((prev) => ({
      ...prev,
      [id]: { ...prev[id], message, messageAt: Date.now() },
    }));

    channelRef.current?.send({
      type: "broadcast",
      event: "chat",
      payload: { id, message },
    });

    setChatInput("");
    // 吹き出しの自動非表示は移動ループの再描画(毎フレーム)で判定されるため、
    // ここでタイマーを持つ必要はない。次のメッセージ送信時は上のsetPlayersが
    // messageAt を上書きするので、自動的に「新しいメッセージで上書き」される。
  }, [chatInput]);

  // ---- 入室前:名前入力モーダル ----
  if (!joined) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-900">
        <div className="w-80 rounded-xl bg-white p-6 shadow-xl">
          <h1 className="mb-1 text-lg font-bold text-slate-800">アバタースペースに入室</h1>
          <p className="mb-4 text-sm text-slate-500">表示する名前を入力してください</p>
          <input
            autoFocus
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            placeholder="例:みく"
            className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <button
            onClick={handleJoin}
            className="w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            入室する
          </button>
        </div>
      </div>
    );
  }

  const playerList = Object.values(players);

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-800">
      {/* ヘッダー */}
      <div className="flex items-center justify-between border-b border-slate-700 bg-slate-900 px-4 py-2 text-white">
        <span className="text-sm font-semibold">アバタースペース</span>
        <span className="text-xs text-slate-300">オンライン: {playerList.length}人</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* マップ */}
        <div
          ref={containerRef}
          className="relative flex-1 overflow-auto bg-slate-700"
        >
          <div
            className="relative"
            style={{
              width: MAP_WIDTH,
              height: MAP_HEIGHT,
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
              backgroundColor: "#334155",
            }}
          >
            {/* 簡易的なゾーン(会議スペースのイメージ) */}
            <div className="absolute left-[120px] top-[120px] h-[220px] w-[320px] rounded-xl bg-slate-600/60 border border-slate-500 flex items-start p-2">
              <span className="text-[11px] text-slate-300">ミーティングエリア</span>
            </div>
            <div className="absolute right-[120px] bottom-[100px] h-[180px] w-[260px] rounded-xl bg-slate-600/60 border border-slate-500 flex items-start p-2">
              <span className="text-[11px] text-slate-300">休憩エリア</span>
            </div>

            {playerList.map((p) => (
              <Avatar key={p.id} player={p} isSelf={p.id === selfId.current} />
            ))}
          </div>
        </div>

        {/* サイドバー:オンラインリスト */}
        <div className="w-52 shrink-0 border-l border-slate-700 bg-slate-900 p-3 text-white overflow-y-auto">
          <h2 className="mb-2 text-xs font-semibold text-slate-400">参加者</h2>
          <ul className="space-y-1">
            {playerList.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-sm">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                {p.name}
                {p.id === selfId.current && (
                  <span className="text-[10px] text-slate-400">(あなた)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* チャット入力 */}
      <div className="flex items-center gap-2 border-t border-slate-700 bg-slate-900 px-4 py-2">
        <input
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendChat()}
          placeholder="メッセージを入力してEnter(PCは WASD / 矢印キー、スマホは左下のボタンで移動)"
          className="flex-1 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-slate-400"
        />
        <button
          onClick={sendChat}
          className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600"
        >
          送信
        </button>
      </div>

      {/* スマホ用移動ボタン(sm以上の画面では非表示) */}
      <TouchControls onPress={handleTouchPress} onRelease={handleTouchRelease} />
    </div>
  );
}
