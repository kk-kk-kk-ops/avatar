"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  PlayerState,
  MAP_WIDTH,
  MAP_HEIGHT,
  AVATAR_RADIUS,
  MOVE_SPEED,
  isInMeetingArea,
  OBSTACLES,
  circleIntersectsRect,
  PROXIMITY_RADIUS,
} from "@/lib/types";
import Avatar from "./Avatar";
import TouchControls from "./TouchControls";
import MicButton from "./MicButton";
import RemoteAudio from "./RemoteAudio";

const ROOM_NAME = "avatar-room-main";
const COLORS = [
  "#F97316",
  "#3B82F6",
  "#22C55E",
  "#EC4899",
  "#A855F7",
  "#EAB308",
  "#14B8A6",
];

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
  const [showParticipants, setShowParticipants] = useState(false); // スマホ用:参加者一覧の開閉
  const [viewport, setViewport] = useState({ width: 0, height: 0 }); // カメラ計算用の表示領域サイズ
  const [micEnabled, setMicEnabled] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<
    Record<string, MediaStream>
  >({});

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(
    new Map(),
  );
  const lastTrackedInArea = useRef(false);
  const wasMovingRef = useRef(false);

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

  // ---- WebRTC:音声接続のヘルパー関数群 ----
  const flushPendingCandidates = useCallback(
    async (peerId: string, pc: RTCPeerConnection) => {
      const list = pendingCandidates.current.get(peerId);
      if (!list || list.length === 0) return;
      for (const candidate of list) {
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          // 無効な候補はスキップ
        }
      }
      pendingCandidates.current.delete(peerId);
    },
    [],
  );

  // 接続が不安定になった際、自分がofferを送る側(IDが小さい方)だけが
  // iceRestartオプション付きで再接続を試みる(双方が同時に送ると衝突するため)
  const restartIce = useCallback(async (peerId: string) => {
    const pc = peerConnections.current.get(peerId);
    if (!pc || selfId.current >= peerId) return;
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      channelRef.current?.send({
        type: "broadcast",
        event: "webrtc-offer",
        payload: { from: selfId.current, to: peerId, sdp: offer },
      });
    } catch {
      // 失敗した場合は次回の切断検知時に再度試みる
    }
  }, []);

  const getOrCreatePeerConnection = useCallback(
    (peerId: string) => {
      const existing = peerConnections.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
        ],
      });

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current as MediaStream);
        });
      } else {
        // まだマイクを許可していない場合でも、相手の声だけは聞けるようにしておく
        pc.addTransceiver("audio", { direction: "recvonly" });
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          channelRef.current?.send({
            type: "broadcast",
            event: "webrtc-ice",
            payload: {
              from: selfId.current,
              to: peerId,
              candidate: e.candidate.toJSON(),
            },
          });
        }
      };

      pc.ontrack = (e) => {
        setRemoteStreams((prev) => ({ ...prev, [peerId]: e.streams[0] }));
      };

      // 一時的な回線の乱れで切れた場合、自動で再接続を試みる
      pc.oniceconnectionstatechange = () => {
        if (
          pc.iceConnectionState === "disconnected" ||
          pc.iceConnectionState === "failed"
        ) {
          restartIce(peerId);
        }
      };

      peerConnections.current.set(peerId, pc);
      return pc;
    },
    [restartIce],
  );

  const startCall = useCallback(
    async (peerId: string) => {
      const pc = getOrCreatePeerConnection(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      channelRef.current?.send({
        type: "broadcast",
        event: "webrtc-offer",
        payload: { from: selfId.current, to: peerId, sdp: offer },
      });
    },
    [getOrCreatePeerConnection],
  );

  const closePeerConnection = useCallback((peerId: string) => {
    const pc = peerConnections.current.get(peerId);
    if (pc) {
      pc.close();
      peerConnections.current.delete(peerId);
    }
    pendingCandidates.current.delete(peerId);
    setRemoteStreams((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  // マイクを後から許可した場合に、既に接続済みの相手へ音声トラックを追加して再送信を開始する
  const attachMicToExistingConnections = useCallback(async () => {
    if (!localStreamRef.current) return;
    for (const [peerId, pc] of Array.from(peerConnections.current.entries())) {
      const senders = pc.getSenders();
      localStreamRef.current.getTracks().forEach((track) => {
        const alreadyAttached = senders.some((s) => s.track === track);
        if (!alreadyAttached)
          pc.addTrack(track, localStreamRef.current as MediaStream);
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      channelRef.current?.send({
        type: "broadcast",
        event: "webrtc-offer",
        payload: { from: selfId.current, to: peerId, sdp: offer },
      });
    }
  }, []);

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
      .on("broadcast", { event: "webrtc-offer" }, async ({ payload }) => {
        const { from, to, sdp } = payload as {
          from: string;
          to: string;
          sdp: RTCSessionDescriptionInit;
        };
        if (to !== selfId.current) return;
        const pc = getOrCreatePeerConnection(from);
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await flushPendingCandidates(from, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        channelRef.current?.send({
          type: "broadcast",
          event: "webrtc-answer",
          payload: { from: selfId.current, to: from, sdp: answer },
        });
      })
      .on("broadcast", { event: "webrtc-answer" }, async ({ payload }) => {
        const { from, to, sdp } = payload as {
          from: string;
          to: string;
          sdp: RTCSessionDescriptionInit;
        };
        if (to !== selfId.current) return;
        const pc = peerConnections.current.get(from);
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await flushPendingCandidates(from, pc);
      })
      .on("broadcast", { event: "webrtc-ice" }, async ({ payload }) => {
        const { from, to, candidate } = payload as {
          from: string;
          to: string;
          candidate: RTCIceCandidateInit;
        };
        if (to !== selfId.current) return;
        const pc = peerConnections.current.get(from);
        if (pc && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(candidate);
          } catch {
            // 追加に失敗した候補は無視(接続確立には他の候補が使われる)
          }
        } else {
          const list = pendingCandidates.current.get(from) ?? [];
          list.push(candidate);
          pendingCandidates.current.set(from, list);
        }
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED" && selfState.current) {
          await channel.track(selfState.current);
        }
        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          // Wi-Fiの瞬断などで切れた場合、少し待ってから自動で再購読を試みる
          setTimeout(() => {
            if (channelRef.current === channel) {
              channel.subscribe();
            }
          }, 2000);
        }
      });

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [joined, getOrCreatePeerConnection, flushPendingCandidates]);

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

          const nextX = Math.min(
            Math.max(self.x + dx, AVATAR_RADIUS),
            MAP_WIDTH - AVATAR_RADIUS,
          );
          const nextY = Math.min(
            Math.max(self.y + dy, AVATAR_RADIUS),
            MAP_HEIGHT - AVATAR_RADIUS,
          );

          // 障害物との当たり判定。X軸・Y軸を別々に判定することで、
          // 障害物に斜めから近づいても壁沿いに滑るように移動できる。
          const blockedX = OBSTACLES.some((o) =>
            circleIntersectsRect(nextX, self.y, AVATAR_RADIUS, o),
          );
          const blockedY = OBSTACLES.some((o) =>
            circleIntersectsRect(self.x, nextY, AVATAR_RADIUS, o),
          );

          if (!blockedX) self.x = nextX;
          if (!blockedY) self.y = nextY;

          if (Math.abs(dx) > Math.abs(dy)) {
            self.dir = dx > 0 ? "right" : "left";
          } else if (dy !== 0) {
            self.dir = dy > 0 ? "down" : "up";
          }
        }
        self.moving = moving;

        // ミーティングエリアの出入り判定(音声通話の自動接続に使用)
        const areaNow = isInMeetingArea(self.x, self.y);
        self.inMeetingArea = areaNow;
        if (areaNow !== lastTrackedInArea.current) {
          lastTrackedInArea.current = areaNow;
          // presence情報も更新しておく(入室直後の相手にも最新状態が伝わるように)
          channelRef.current?.track(self);
        }

        // ローカル描画を即時反映
        setPlayers((prev) => ({ ...prev, [self.id]: { ...self } }));

        // 動いた時、および「今まさに止まった瞬間」だけ他プレイヤーへブロードキャスト。
        // 止まった瞬間を送らないと、相手の画面では最後に動いていた位置のまま
        // 止まって見えてしまい、キーを離してから反映されるようなラグに感じられる。
        if ((moving || wasMovingRef.current) && channelRef.current) {
          channelRef.current.send({
            type: "broadcast",
            event: "move",
            payload: self,
          });
        }
        wasMovingRef.current = moving;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [joined]);

  // ---- 表示領域(ビューポート)のサイズを監視(カメラ追従の計算に使用) ----
  useEffect(() => {
    if (!joined) return;
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      setViewport({ width: el.clientWidth, height: el.clientHeight });
    };
    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [joined]);

  // ---- マイクのON/OFF切り替え ----
  // 初回クリック時にブラウザへマイク使用の許可をリクエストする。
  // 実際の音声送受信(WebRTC接続)はミーティングエリアの出入りに応じて
  // 別のeffectが自動的に行う。ここではマイクの取得とミュート切り替えのみ。
  const toggleMic = useCallback(async () => {
    setMicError(null);
    try {
      if (!localStreamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        localStreamRef.current = stream;
        setMicEnabled(true);
        if (selfState.current) {
          selfState.current.micOn = true;
          channelRef.current?.track(selfState.current);
        }
        await attachMicToExistingConnections();
        return;
      }
      const next = !micEnabled;
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = next;
      });
      setMicEnabled(next);
      if (selfState.current) {
        selfState.current.micOn = next;
        channelRef.current?.track(selfState.current);
      }
    } catch (err) {
      setMicError(
        "マイクを使用できませんでした。ブラウザのアドレスバー付近のマイク許可設定を確認してください。",
      );
    }
  }, [micEnabled, attachMicToExistingConnections]);

  // 退室時にマイクを解放(録音状態のまま残らないようにする)
  useEffect(() => {
    if (!joined) return;
    return () => {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    };
  }, [joined]);

  // ---- 音声通話:接続すべき相手を計算 ----
  // 条件は「ミーティングエリアで二人とも一緒にいる」か「一定距離より近い(近接ボイスチャット)」。
  // 距離判定には少し余裕(ヒステリシス)を持たせ、境界線上での接続/切断の
  // チラつきを防いでいる(接続済みの相手は少し離れても切れにくくする)。
  const eligiblePeerIds = useMemo(() => {
    const self = players[selfId.current];
    if (!self) return [] as string[];
    return Object.values(players)
      .filter((p) => {
        if (p.id === selfId.current) return false;
        if (self.inMeetingArea && p.inMeetingArea) return true;
        const dist = Math.hypot(p.x - self.x, p.y - self.y);
        const alreadyConnected = peerConnections.current.has(p.id);
        const threshold = alreadyConnected
          ? PROXIMITY_RADIUS + 20
          : PROXIMITY_RADIUS;
        return dist <= threshold;
      })
      .map((p) => p.id)
      .sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players]);
  const eligibleKey = eligiblePeerIds.join(",");

  // ---- 音声通話:対象の増減に合わせて接続を作成/破棄 ----
  useEffect(() => {
    if (!joined) return;
    const eligibleSet = new Set(eligiblePeerIds);

    eligiblePeerIds.forEach((peerId) => {
      if (peerConnections.current.has(peerId)) return;
      // IDの文字列比較で片方だけがofferを送るようにし、二重接続を防ぐ
      if (selfId.current < peerId) {
        startCall(peerId);
      } else {
        getOrCreatePeerConnection(peerId);
      }
    });

    Array.from(peerConnections.current.keys()).forEach((peerId) => {
      if (!eligibleSet.has(peerId)) {
        closePeerConnection(peerId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleKey, joined]);

  // 退室時にすべての音声接続を閉じる
  useEffect(() => {
    if (!joined) return;
    return () => {
      peerConnections.current.forEach((pc) => pc.close());
      peerConnections.current.clear();
      pendingCandidates.current.clear();
      setRemoteStreams({});
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
    const messageAt = Date.now();

    // selfState自体にもmessageを持たせる。移動ループが毎フレーム
    // selfStateの内容でplayersを上書きするため、ここに含めないと
    // 自分の吹き出しだけ次のフレームで消えてしまう。
    selfState.current.message = message;
    selfState.current.messageAt = messageAt;

    setPlayers((prev) => ({
      ...prev,
      [id]: { ...prev[id], message, messageAt },
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
          <h1 className="mb-1 text-lg font-bold text-slate-800">
            Grovina Officeに入室
          </h1>
          <p className="mb-4 text-sm text-slate-500">
            表示する名前を入力してください
          </p>
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

  // ---- カメラ計算:自分を画面中央に固定し、端では止めてアイコン側が動くようにする ----
  const selfPlayer = players[selfId.current];
  const maxCameraX = Math.max(MAP_WIDTH - viewport.width, 0);
  const maxCameraY = Math.max(MAP_HEIGHT - viewport.height, 0);
  const cameraX = selfPlayer
    ? Math.min(Math.max(selfPlayer.x - viewport.width / 2, 0), maxCameraX)
    : 0;
  const cameraY = selfPlayer
    ? Math.min(Math.max(selfPlayer.y - viewport.height / 2, 0), maxCameraY)
    : 0;

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-800">
      {/* ヘッダー */}
      <div className="flex items-center justify-between border-b border-slate-700 bg-slate-900 px-4 py-2 text-white">
        <span className="text-sm font-semibold">Grovina Office</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-300">
            オンライン: {playerList.length}人
          </span>
          {eligiblePeerIds.length > 0 && (
            <span className="rounded-full bg-emerald-600/80 px-2 py-0.5 text-[10px] font-semibold text-white">
              🎧 音声通話中({eligiblePeerIds.length}人)
            </span>
          )}
          <MicButton enabled={micEnabled} onClick={toggleMic} />
          {/* スマホのみ表示するハンバーガーボタン */}
          <button
            onClick={() => setShowParticipants((v) => !v)}
            className="rounded p-1.5 hover:bg-white/10 sm:hidden"
            aria-label="参加者一覧を開く"
          >
            <span className="mb-1 block h-0.5 w-5 bg-white" />
            <span className="mb-1 block h-0.5 w-5 bg-white" />
            <span className="block h-0.5 w-5 bg-white" />
          </button>
        </div>
      </div>

      {/* マイク許可エラーの通知 */}
      {micError && (
        <div className="bg-red-900/80 px-4 py-2 text-center text-xs text-red-100">
          {micError}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* マップ:表示領域は固定し、中の世界をtransformで動かしてカメラ追従を実現 */}
        <div
          ref={containerRef}
          className="relative flex-1 overflow-hidden bg-slate-700"
        >
          <div
            className="absolute left-0 top-0"
            style={{
              width: MAP_WIDTH,
              height: MAP_HEIGHT,
              transform: `translate(${-cameraX}px, ${-cameraY}px)`,
              backgroundImage: "url('/map-background.png')",
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
              backgroundColor: "#334155",
            }}
          >
            {/* 簡易的なゾーン(会議スペースのイメージ) */}
            <div className="absolute left-[120px] top-[120px] h-[220px] w-[320px] rounded-xl bg-slate-600/60 border border-slate-500 flex items-start p-2">
              <span className="text-[11px] text-slate-300">
                ミーティングエリア
              </span>
            </div>
            <div className="absolute right-[120px] bottom-[100px] h-[180px] w-[260px] rounded-xl bg-slate-600/60 border border-slate-500 flex items-start p-2">
              <span className="text-[11px] text-slate-300">休憩エリア</span>
            </div>

            {/* 障害物(机・観葉植物・棚など) */}
            {OBSTACLES.map((o, i) => (
              <div
                key={i}
                className="absolute flex items-center justify-center rounded-md border border-amber-800/50 bg-amber-900/50 text-[10px] text-amber-100 shadow-inner"
                style={{
                  left: o.x,
                  top: o.y,
                  width: o.width,
                  height: o.height,
                }}
              >
                {o.label}
              </div>
            ))}

            {/* 自分の音声が届く範囲の目安(マイクON時のみ表示) */}
            {selfPlayer && micEnabled && (
              <div
                className="pointer-events-none absolute rounded-full border border-emerald-400/40"
                style={{
                  left: selfPlayer.x - PROXIMITY_RADIUS,
                  top: selfPlayer.y - PROXIMITY_RADIUS,
                  width: PROXIMITY_RADIUS * 2,
                  height: PROXIMITY_RADIUS * 2,
                }}
              />
            )}

            {playerList.map((p) => (
              <Avatar key={p.id} player={p} isSelf={p.id === selfId.current} />
            ))}
          </div>
        </div>

        {/* スマホ表示時の背景オーバーレイ(タップで閉じる) */}
        {showParticipants && (
          <div
            className="fixed inset-0 z-30 bg-black/50 sm:hidden"
            onClick={() => setShowParticipants(false)}
          />
        )}

        {/* サイドバー:オンラインリスト(スマホはドロワー表示) */}
        <div
          className={`${
            showParticipants ? "flex" : "hidden"
          } fixed inset-y-0 right-0 z-40 w-64 flex-col overflow-y-auto border-l border-slate-700 bg-slate-900 p-3 text-white sm:static sm:z-auto sm:flex sm:w-52 sm:shrink-0`}
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-400">参加者</h2>
            <button
              onClick={() => setShowParticipants(false)}
              className="text-slate-400 hover:text-white sm:hidden"
              aria-label="閉じる"
            >
              ✕
            </button>
          </div>
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
      <TouchControls
        onPress={handleTouchPress}
        onRelease={handleTouchRelease}
      />

      {/* 相手の音声を再生する非表示要素(ミーティングエリアで自動接続された分だけ生成) */}
      {Object.entries(remoteStreams).map(([peerId, stream]) => (
        <RemoteAudio key={peerId} stream={stream} />
      ))}
    </div>
  );
}
