"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  PlayerState,
  PresenceStatus,
  PRESENCE_STATUS_COLORS,
  PRESENCE_STATUS_LABELS,
  MAP_WIDTH,
  MAP_HEIGHT,
  AVATAR_HITBOX_WIDTH,
  AVATAR_HITBOX_HEIGHT,
  MOVE_SPEED,
  findMeetingZoneId,
  rectIntersectsRect,
  resolveSpawnPosition,
  PROXIMITY_RADIUS,
  NEW_ITEM_SIZE,
  Obstacle,
  MeetingZone,
  DEFAULT_OBSTACLES,
  DEFAULT_MEETING_ZONES,
  AVATAR_IMAGES,
  Room,
} from "@/lib/types";
import Avatar, { type AvatarHandle } from "./Avatar";
import AvatarPicker from "./AvatarPicker";
import TouchControls from "./TouchControls";
import MicButton from "./MicButton";
import RemoteAudio from "./RemoteAudio";
import RemoteVideo from "./RemoteVideo";
import ScreenShareButton from "./ScreenShareButton";
import VideoCallButton from "./VideoCallButton";
import LogoutButton from "./auth/LogoutButton";

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

type Props = {
  initialName?: string;
  rooms: Room[];
  maxPeoplePerRoom: number;
  isAccountAdmin: boolean;
  isMaster: boolean;
};

export default function AvatarSpace({
  initialName,
  rooms,
  maxPeoplePerRoom,
  isAccountAdmin,
  isMaster,
}: Props) {
  // ログインセッションを持つSupabaseクライアント。map_layoutテーブルのRLSを
  // 「認証済みユーザーのみ」に絞れるよう、認証操作(ログイン/ログアウト)と
  // 同じクライアント生成関数を使う(以前は素のcreateClientを使っており、
  // auth.uid()がRLS側で常にnullになっていた)。useStateの遅延初期化で
  // マウント時に一度だけ生成する。
  const [supabase] = useState(() => createClient());
  // ---- ルーム選択(Googleログイン後、最初に必ずここへ遷移する) ----
  const [roomSelected, setRoomSelected] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState(rooms[0]?.id ?? "");
  // roomIdはRealtimeチャンネル名・map_layoutの検索キーに使う「確定した」ID。
  // roomNameは表示用(ヘッダー・入室モーダルのタイトル)。
  const [roomId, setRoomId] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomJoinError, setRoomJoinError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [nameInput, setNameInput] = useState(initialName ?? "");
  const [selectedAvatar, setSelectedAvatar] = useState(AVATAR_IMAGES[0]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsNameInput, setSettingsNameInput] = useState("");
  const [settingsAvatar, setSettingsAvatar] = useState(AVATAR_IMAGES[0]);
  const [settingsStatus, setSettingsStatus] =
    useState<PresenceStatus>("available");
  const [chatInput, setChatInput] = useState("");
  const [players, setPlayers] = useState<Record<string, PlayerState>>({});
  const playersRef = useRef<Record<string, PlayerState>>({});
  const remoteScreenStreamsRef = useRef<Record<string, MediaStream>>({});
  const [showParticipants, setShowParticipants] = useState(false); // スマホ用:参加者一覧の開閉
  const [viewport, setViewport] = useState({ width: 0, height: 0 }); // カメラ計算用の表示領域サイズ
  const [micEnabled, setMicEnabled] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<
    Record<string, MediaStream>
  >({});
  const [screenSharing, setScreenSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<
    Record<string, MediaStream>
  >({});
  const [inCall, setInCall] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [remoteCallStreams, setRemoteCallStreams] = useState<
    Record<string, MediaStream>
  >({});
  const [expandedMedia, setExpandedMedia] = useState<{
    peerId: string;
    kind: "screen" | "camera";
  } | null>(null);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(
    "/map-background.webp",
  );
  const [obstacles, setObstacles] = useState<Obstacle[]>(DEFAULT_OBSTACLES);
  const [meetingZones, setMeetingZones] = useState<MeetingZone[]>(
    DEFAULT_MEETING_ZONES,
  );

  const obstaclesRef = useRef<Obstacle[]>(DEFAULT_OBSTACLES);
  const meetingZonesRef = useRef<MeetingZone[]>(DEFAULT_MEETING_ZONES);

  // マップの広さ(テンプレートごとに変更可能)。デフォルトは従来通りの
  // MAP_WIDTH/MAP_HEIGHTだが、テンプレート側で個別サイズが設定されて
  // いればそちらを使う。
  const [mapSize, setMapSize] = useState({ width: MAP_WIDTH, height: MAP_HEIGHT });
  const mapSizeRef = useRef({ width: MAP_WIDTH, height: MAP_HEIGHT });

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  // 相手から届く映像トラックが「画面共有」か「ビデオ通話」かを見分けるための対応表。
  // trackのidをキーに、送信側から知らされた種類を記録する(相手ごとに保持)。
  const peerVideoPurposes = useRef<
    Map<string, Record<string, "screen" | "camera">>
  >(new Map());
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(
    new Map(),
  );
  // 相手ごとに「今offerを作成・送信している最中か」を記録する。ほぼ同時に
  // 双方からofferが届く交渉の衝突(グレア)を検知するために使う。
  const makingOffer = useRef<Map<string, boolean>>(new Map());
  const lastTrackedZoneId = useRef<string | null>(null);
  // 定期同期(下記)で「前回同期した時の値」を覚えておくための記録。
  // selfState.currentとplayers[自分のID]が同じオブジェクト参照になって
  // いることがあり(入室直後など)、その場合next[self.id]とself自体を
  // 比較しても常に「変化なし」判定になってしまうため、別途この記録と
  // 比較することで参照の別名(エイリアス)状態に左右されないようにする。
  const lastSelfSyncRef = useRef<{
    x: number;
    y: number;
    dir: PlayerState["dir"];
  } | null>(null);
  const wasMovingRef = useRef(false);
  const lastMoveSentAt = useRef(0);

  const selfId = useRef<string>(randomId());
  const selfState = useRef<PlayerState | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const keysDown = useRef<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const proximityCircleRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameTime = useRef<number>(performance.now());

  // ---- 位置の描画をReactのstateから切り離すための仕組み ----
  // 毎フレームsetPlayersを呼ぶと画面全体が再描画され、複数人が同時に動くと
  // 負荷が高くなり通信が不安定になりやすい。そのため位置(x, y)の「見た目上の
  // 描画」はDOM操作で直接行い、Reactのstateは名前・アバター画像・マイク状態
  // など「頻繁には変わらない情報」だけを持つようにする。
  // avatarRefs: 各プレイヤーのAvatar DOM操作ハンドルを保持
  const avatarRefs = useRef<Map<string, AvatarHandle>>(new Map());
  // 相手の位置の補間(interpolation)用。broadcastで届いた最新位置をtargetとして持ち、
  // 毎フレーム現在位置(current)をtargetへ滑らかに近づけて描画する。
  const peerPositionsRef = useRef<
    Map<
      string,
      { currentX: number; currentY: number; targetX: number; targetY: number }
    >
  >(new Map());
  const viewportRef = useRef({ width: 0, height: 0 });
  // TURNサーバーの認証情報(サーバー経由で取得。取得できるまではSTUNのみで動作する)
  const turnServersRef = useRef<RTCIceServer[]>([]);

  // 画面共有・ビデオ通話のエラーメッセージは5秒で自動的に消す
  useEffect(() => {
    if (!shareError) return;
    const timer = setTimeout(() => setShareError(null), 5000);
    return () => clearTimeout(timer);
  }, [shareError]);

  useEffect(() => {
    if (!callError) return;
    const timer = setTimeout(() => setCallError(null), 5000);
    return () => clearTimeout(timer);
  }, [callError]);

  // playersの最新値をrefにも反映(ontrackなど、effect外から最新状態を
  // 参照したい箇所で使う。getOrCreatePeerConnectionをplayers変更のたびに
  // 作り直さずに済むようにするため)
  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    remoteScreenStreamsRef.current = remoteScreenStreams;
  }, [remoteScreenStreams]);

  // ---- TURNサーバーの認証情報を取得(取得できるまではSTUNのみで動作する) ----
  useEffect(() => {
    if (!joined) return;
    (async () => {
      try {
        const res = await fetch("/api/turn-credentials");
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.iceServers)) {
          turnServersRef.current = data.iceServers;
        }
      } catch {
        // 取得できなくてもSTUNのみで動作を続ける
      }
    })();
  }, [joined]);

  // ---- ルーム選択:選んだルームを確定してアバター選択画面へ進む ----
  const handleSelectRoom = useCallback(() => {
    const room = rooms.find((r) => r.id === selectedRoomId) ?? rooms[0];
    if (!room) return; // ルームが1つも無い(管理者がまだ作成していない)場合
    setRoomId(room.id);
    setRoomName(room.name);
    setRoomSelected(true);
  }, [rooms, selectedRoomId]);

  // ---- 退出:バーチャル空間から抜けてルーム選択画面に戻る ----
  // joinedをfalseにすることで、Realtimeチャンネルの購読解除・マイクや
  // 画面共有ストリームの解放・WebRTC接続のクローズなど、既存の
  // 「joined依存のエフェクトのクリーンアップ」が一通り走る。playersは
  // ここで明示的に空にしておかないと、次に入室した際に前のルームの
  // 参加者が残ったまま表示されてしまう。
  const handleLeaveRoom = useCallback(() => {
    setJoined(false);
    setPlayers({});
    setRoomSelected(false);
  }, []);

  // ---- 入室処理 ----
  const handleJoin = useCallback(() => {
    setRoomJoinError(null);
    const name = nameInput.trim() || `ゲスト${selfId.current.slice(0, 4)}`;
    // マップ中央が障害物と重なっていたら、その障害物の上端のすぐ上へ押し出す
    const spawn = resolveSpawnPosition(
      mapSizeRef.current.width / 2,
      mapSizeRef.current.height / 2,
      obstacles,
    );
    const initial: PlayerState = {
      id: selfId.current,
      name,
      color: randomColor(),
      avatarImage: selectedAvatar,
      status: "available",
      x: spawn.x,
      y: spawn.y,
      dir: "down",
      moving: false,
    };
    selfState.current = initial;
    setPlayers((prev) => ({ ...prev, [initial.id]: initial }));
    setSettingsNameInput(name);
    setSettingsAvatar(selectedAvatar);
    setJoined(true);
  }, [nameInput, selectedAvatar, obstacles]);

  // ---- マップレイアウト:refをstateと同期(移動ループなど、effect外から常に最新値を読むため) ----
  useEffect(() => {
    obstaclesRef.current = obstacles;
  }, [obstacles]);
  useEffect(() => {
    meetingZonesRef.current = meetingZones;
  }, [meetingZones]);
  useEffect(() => {
    mapSizeRef.current = mapSize;
  }, [mapSize]);

  // ---- マップレイアウト:選んだルームのテンプレートから読み込む ----
  // マップの編集はマスターがテンプレートに対して行う運用に一本化した
  // ため、ルーム側では読み込みのみ(保存・追加・削除・ドラッグ編集は
  // 廃止)。テンプレートは全ルーム共通のマスターデータなので、
  // 各ルームで個別に保存する必要がない。
  useEffect(() => {
    if (!joined) return;
    const room = rooms.find((r) => r.id === roomId);
    if (!room?.templateId) return;
    (async () => {
      const { data } = await supabase
        .from("templates")
        .select("background_image_url, obstacles, meeting_area, map_width, map_height")
        .eq("id", room.templateId)
        .maybeSingle();
      if (!data) return;

      if (data.background_image_url) {
        setBackgroundImageUrl(data.background_image_url);
      }

      if (data.map_width && data.map_height) {
        setMapSize({ width: data.map_width, height: data.map_height });
      }

      if (Array.isArray(data.obstacles)) {
        const loaded = (data.obstacles as Array<Partial<Obstacle>>).map(
          (o, i) => ({
            id: o.id ?? `obstacle-${i}`,
            x: o.x ?? 0,
            y: o.y ?? 0,
            width: o.width ?? NEW_ITEM_SIZE,
            height: o.height ?? NEW_ITEM_SIZE,
            label: o.label ?? "🧱 障害物",
          }),
        );
        setObstacles(loaded);

        // 保存済みの障害物と自分の初期位置が重なっていたら、上端のすぐ上へ押し出す
        if (selfState.current) {
          const resolved = resolveSpawnPosition(
            selfState.current.x,
            selfState.current.y,
            loaded,
          );
          if (
            resolved.x !== selfState.current.x ||
            resolved.y !== selfState.current.y
          ) {
            selfState.current.x = resolved.x;
            selfState.current.y = resolved.y;
            const updated = selfState.current;
            setPlayers((prev) => ({ ...prev, [updated.id]: { ...updated } }));
            channelRef.current?.track(updated);
          }
        }
      }

      const rawZones = data.meeting_area;
      if (rawZones) {
        const zonesArray = Array.isArray(rawZones) ? rawZones : [rawZones];
        const loaded = (zonesArray as Array<Partial<MeetingZone>>).map(
          (z, i) => ({
            id: z.id ?? `meeting-${i}`,
            x: z.x ?? 0,
            y: z.y ?? 0,
            width: z.width ?? NEW_ITEM_SIZE,
            height: z.height ?? NEW_ITEM_SIZE,
            label: z.label ?? "ミーティングエリア",
          }),
        );
        setMeetingZones(loaded);
      }
    })();
  }, [joined, roomId, rooms, supabase]);

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

  // 現在自分が送っている映像トラック(画面共有・カメラ)の種類を、
  // トラックIDをキーにしたマップとして組み立てる。相手側へofferと一緒に
  // 送ることで、相手は届いた映像が「画面共有」か「ビデオ通話」かを区別できる。
  const buildVideoTrackPurposes = useCallback((): Record<
    string,
    "screen" | "camera"
  > => {
    const map: Record<string, "screen" | "camera"> = {};
    screenStreamRef.current?.getVideoTracks().forEach((t) => {
      map[t.id] = "screen";
    });
    cameraStreamRef.current?.getVideoTracks().forEach((t) => {
      map[t.id] = "camera";
    });
    return map;
  }, []);

  // offerを作成し、setLocalDescriptionしてから相手へ送信する共通処理。
  // (以前は7箇所前後で同じ3行がほぼそのまま重複していた)
  // 送信中はmakingOfferをtrueにしておき、ほぼ同時に相手からもofferが
  // 届いた場合の衝突(グレア)判定にwebrtc-offerハンドラ側で使う。
  const sendOffer = useCallback(
    async (
      peerId: string,
      pc: RTCPeerConnection,
      offerOptions?: RTCOfferOptions,
    ) => {
      makingOffer.current.set(peerId, true);
      try {
        const offer = await pc.createOffer(offerOptions);
        await pc.setLocalDescription(offer);
        channelRef.current?.send({
          type: "broadcast",
          event: "webrtc-offer",
          payload: {
            from: selfId.current,
            to: peerId,
            sdp: offer,
            videoTrackPurposes: buildVideoTrackPurposes(),
          },
        });
      } finally {
        makingOffer.current.set(peerId, false);
      }
    },
    [buildVideoTrackPurposes],
  );

  // 接続がすでにできている相手に対して、自分が今送っているはずのトラック
  // (マイク・画面共有・カメラ)がまだ正しく乗っていなければ、追加して
  // 再送信する。接続する順番やタイミングによっては、最初のofferの時点では
  // まだ反映されないケースがあるため、offer/answerのやり取りが一段落する
  // たびに毎回確認する。
  const ensureLocalVideoAttached = useCallback(
    async (peerId: string) => {
      const pc = peerConnections.current.get(peerId);
      if (!pc) return;

      // 別の交渉(offer/answer)がまだ進行中のタイミングで割り込むと、
      // createOffer/setLocalDescriptionが失敗し、それっきり再試行されなく
      // なることがあった。交渉が落ち着いている("stable")時だけ実行する。
      if (pc.signalingState !== "stable") return;

      // 「senderとしてtrackが付いているか」ではなく「実際にoffer/answerの
      // やり取りでネゴシエーション済み(mid = m-lineが割り当て済み)か」で
      // 判定する。相手(offer送信側)がその時点で映像を持っていなかった場合、
      // 最初のofferには映像用のm-line自体が無く、こちらがaddTrackしていても
      // answerには乗らない(WebRTCの仕様上、answerはofferに無いm-lineを
      // 追加できない)。以前はsenderの存在だけを見ていたため、この
      // 「track はあるが未ネゴシエーション」の状態を「対応済み」と誤判定し、
      // 再送信(renegotiation)が行われないままになっていた。
      const negotiatedTrackIds = new Set(
        pc
          .getTransceivers()
          .filter((t) => t.mid !== null && t.sender.track)
          .map((t) => t.sender.track!.id),
      );
      const myStreams = [
        localStreamRef.current,
        screenStreamRef.current,
        cameraStreamRef.current,
      ].filter((s): s is MediaStream => !!s);
      let needsRenegotiation = false;
      const addedTracks: MediaStreamTrack[] = [];
      myStreams.forEach((stream) => {
        stream.getTracks().forEach((track) => {
          if (negotiatedTrackIds.has(track.id)) return;
          // trackを送るsender自体は既にある場合、addTrackし直すと重複
          // senderになってしまうため、無い場合だけ追加する。
          const existingSender = pc.getSenders().find((s) => s.track === track);
          if (!existingSender) {
            pc.addTrack(track, stream);
            addedTracks.push(track);
          }
          needsRenegotiation = true;
        });
      });
      if (!needsRenegotiation) return;

      try {
        await sendOffer(peerId, pc);
      } catch {
        // 失敗した場合、追加したトラックをsenderから外し、次回のチェックで
        // 「まだ乗っていない」と判定させて再試行できるようにする
        addedTracks.forEach((track) => {
          const sender = pc.getSenders().find((s) => s.track === track);
          if (sender) {
            try {
              pc.removeTrack(sender);
            } catch {
              // 無視(次回の判定が多少ズレる程度で致命的ではない)
            }
          }
        });
      }
    },
    [sendOffer],
  );

  // 一時的な回線の乱れで切れた場合、自動で再接続を試みる
  // 接続が不安定になった際、自分がofferを送る側(IDが小さい方)だけが
  // iceRestartオプション付きで再接続を試みる(双方が同時に送ると衝突するため)
  const restartIce = useCallback(
    async (peerId: string) => {
      const pc = peerConnections.current.get(peerId);
      if (!pc || selfId.current >= peerId) return;
      try {
        await sendOffer(peerId, pc, { iceRestart: true });
      } catch {
        // 失敗した場合は次回の切断検知時に再度試みる
      }
    },
    [sendOffer],
  );

  const getOrCreatePeerConnection = useCallback(
    (peerId: string) => {
      const existing = peerConnections.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
          ...turnServersRef.current,
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

      // すでに画面共有中の場合は、新しく繋がる相手にもその映像を含める
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, screenStreamRef.current as MediaStream);
        });
      }

      // すでにビデオ通話中の場合も同様に含める
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, cameraStreamRef.current as MediaStream);
        });
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
        if (e.track.kind === "video") {
          const purposes = peerVideoPurposes.current.get(peerId) || {};
          let purpose = purposes[e.track.id];
          if (!purpose) {
            // 目印(videoTrackPurposes)がまだ届いていない場合の保険。
            // 相手の在室情報(presence)から種類を推測する。
            // 「すでに画面共有の映像を受信済み」であれば、今回届いた別の
            // トラックはビデオ通話である可能性が高いと判断する
            // (画面共有とビデオ通話を両方ONにしている場合の誤判定を防ぐ)。
            const peerState = playersRef.current[peerId];
            const alreadyHasScreen = !!remoteScreenStreamsRef.current[peerId];
            if (
              peerState?.inCall &&
              (alreadyHasScreen || !peerState?.sharingScreen)
            ) {
              purpose = "camera";
            } else {
              purpose = "screen";
            }
          }
          const setter =
            purpose === "camera"
              ? setRemoteCallStreams
              : setRemoteScreenStreams;
          setter((prev) => ({ ...prev, [peerId]: e.streams[0] }));
          e.track.onended = () => {
            setter((prev) => {
              if (!(peerId in prev)) return prev;
              const next = { ...prev };
              delete next[peerId];
              return next;
            });
          };
        } else {
          setRemoteStreams((prev) => ({ ...prev, [peerId]: e.streams[0] }));
        }
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
      await sendOffer(peerId, pc);
    },
    [getOrCreatePeerConnection, sendOffer],
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
    setRemoteScreenStreams((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
    setRemoteCallStreams((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
    peerVideoPurposes.current.delete(peerId);
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
      await sendOffer(peerId, pc);
    }
  }, [sendOffer]);

  // ---- 画面共有 ----
  // 開始:すでに接続中の相手へ映像トラックを追加して再送信を開始する
  const attachScreenToExistingConnections = useCallback(async () => {
    if (!screenStreamRef.current) return;
    for (const [peerId, pc] of Array.from(peerConnections.current.entries())) {
      const senders = pc.getSenders();
      screenStreamRef.current.getTracks().forEach((track) => {
        const alreadyAttached = senders.some((s) => s.track === track);
        if (!alreadyAttached)
          pc.addTrack(track, screenStreamRef.current as MediaStream);
      });
      await sendOffer(peerId, pc);
    }
  }, [sendOffer]);

  const stopScreenShare = useCallback(async () => {
    const stream = screenStreamRef.current;
    if (!stream) return;
    const trackIds = new Set(stream.getTracks().map((t) => t.id));
    stream.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setScreenSharing(false);

    if (selfState.current) {
      selfState.current.sharingScreen = false;
      channelRef.current?.track(selfState.current);
    }

    // 各接続から「画面共有の」映像トラックだけを外す(ビデオ通話中の映像は残す)
    for (const [peerId, pc] of Array.from(peerConnections.current.entries())) {
      const targetSenders = pc
        .getSenders()
        .filter((s) => s.track && trackIds.has(s.track.id));
      targetSenders.forEach((s) => pc.removeTrack(s));
      if (targetSenders.length === 0) continue;
      await sendOffer(peerId, pc);
    }
  }, [sendOffer]);

  const startScreenShare = useCallback(async () => {
    setShareError(null);

    // スマホ(特にiPhoneのSafari)は画面共有API自体に対応していないため、
    // 呼び出す前に判定して分かりやすいメッセージを出す
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getDisplayMedia !== "function"
    ) {
      setShareError(
        "この端末・ブラウザは画面共有に対応していません。PCのブラウザからお試しください。",
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      screenStreamRef.current = stream;
      setScreenSharing(true);

      if (selfState.current) {
        selfState.current.sharingScreen = true;
        channelRef.current?.track(selfState.current);
      }

      // ブラウザ標準の「共有を停止」ボタンが押された場合にも終了処理を行う
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        stopScreenShare();
      });

      await attachScreenToExistingConnections();
    } catch {
      // 選択画面でキャンセルした場合などはここに来る。エラー扱いにはしない。
    }
  }, [attachScreenToExistingConnections, stopScreenShare]);

  const toggleScreenShare = useCallback(() => {
    if (screenSharing) {
      stopScreenShare();
    } else {
      startScreenShare();
    }
  }, [screenSharing, stopScreenShare, startScreenShare]);

  // ---- ビデオ通話(画面共有と同じ仕組みで、カメラ映像を使う) ----
  const attachCameraToExistingConnections = useCallback(async () => {
    if (!cameraStreamRef.current) return;
    for (const [peerId, pc] of Array.from(peerConnections.current.entries())) {
      const senders = pc.getSenders();
      cameraStreamRef.current.getTracks().forEach((track) => {
        const alreadyAttached = senders.some((s) => s.track === track);
        if (!alreadyAttached)
          pc.addTrack(track, cameraStreamRef.current as MediaStream);
      });
      await sendOffer(peerId, pc);
    }
  }, [sendOffer]);

  const stopVideoCall = useCallback(async () => {
    const stream = cameraStreamRef.current;
    if (!stream) return;
    const trackIds = new Set(stream.getTracks().map((t) => t.id));
    stream.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setInCall(false);

    if (selfState.current) {
      selfState.current.inCall = false;
      channelRef.current?.track(selfState.current);
    }

    // 各接続から「ビデオ通話の」映像トラックだけを外す(画面共有中の映像は残す)
    for (const [peerId, pc] of Array.from(peerConnections.current.entries())) {
      const targetSenders = pc
        .getSenders()
        .filter((s) => s.track && trackIds.has(s.track.id));
      targetSenders.forEach((s) => pc.removeTrack(s));
      if (targetSenders.length === 0) continue;
      await sendOffer(peerId, pc);
    }
  }, [sendOffer]);

  const startVideoCall = useCallback(async () => {
    setCallError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      cameraStreamRef.current = stream;
      setInCall(true);

      if (selfState.current) {
        selfState.current.inCall = true;
        channelRef.current?.track(selfState.current);
      }

      stream.getVideoTracks()[0].addEventListener("ended", () => {
        stopVideoCall();
      });

      await attachCameraToExistingConnections();
    } catch {
      setCallError(
        "カメラを使用できませんでした。ブラウザのカメラ許可設定を確認してください。",
      );
    }
  }, [attachCameraToExistingConnections, stopVideoCall]);

  const toggleVideoCall = useCallback(() => {
    if (inCall) {
      stopVideoCall();
    } else {
      startVideoCall();
    }
  }, [inCall, stopVideoCall, startVideoCall]);

  // ---- Supabase Realtimeチャンネルの接続 ----
  useEffect(() => {
    if (!joined) return;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectChannel = () => {
      if (cancelled) return;

      const channel = supabase.channel(`avatar-room-${roomId}`, {
        config: { presence: { key: selfId.current } },
      });
      channelRef.current = channel;

      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState<PlayerState>();

          // syncイベントは複数人が同時に在室状況を更新した際、瞬間的に
          // 不完全なスナップショットが届くことがある。そのタイミングで
          // 「いなくなった」と判断して消してしまうと、実際にはまだ在室している
          // 相手を誤って消してしまうことがあるため、ここでは削除は行わない
          // (削除は正確な情報が来るleaveイベントと、下の定期的な自己修復に任せる)。
          //
          // ただし、名前・アバター画像・マイク状態などは track() が呼ばれた
          // 瞬間にしか更新されないため、既に把握している相手であっても
          // これらの「見た目」情報だけは反映する。位置情報(x, y, 向きなど)は
          // 移動のbroadcastの方が新しいので、そちらは上書きしない。
          setPlayers((prev) => {
            let changed = false;
            const next = { ...prev };
            Object.values(state).forEach((entries) => {
              const p = entries[0] as PlayerState;
              if (p.id === selfId.current) return;
              const current = next[p.id];
              if (!current) {
                next[p.id] = p;
                changed = true;
                return;
              }
              if (
                current.name !== p.name ||
                current.color !== p.color ||
                current.avatarImage !== p.avatarImage ||
                current.micOn !== p.micOn ||
                current.sharingScreen !== p.sharingScreen ||
                current.inCall !== p.inCall ||
                current.status !== p.status
              ) {
                next[p.id] = {
                  ...current,
                  name: p.name,
                  color: p.color,
                  avatarImage: p.avatarImage,
                  micOn: p.micOn,
                  sharingScreen: p.sharingScreen,
                  inCall: p.inCall,
                  status: p.status,
                };
                changed = true;
              }
            });
            // 自分の最新状態は selfState を優先(presence syncのタイムラグ対策)
            if (
              selfState.current &&
              next[selfState.current.id] !== selfState.current
            ) {
              next[selfState.current.id] = selfState.current;
              changed = true;
            }
            return changed ? next : prev;
          });
        })
        .on("presence", { event: "leave" }, ({ key }) => {
          peerPositionsRef.current.delete(key);
          setPlayers((prev) => {
            const copy = { ...prev };
            delete copy[key];
            return copy;
          });
        })
        .on("broadcast", { event: "move" }, ({ payload }) => {
          const p = payload as PlayerState;
          if (p.id === selfId.current) return;

          // 位置(見た目)はReactのstateを介さず、補間(interpolation)用の
          // target座標だけを更新する。実際の描画は毎フレームのrAFループで行う。
          const posEntry = peerPositionsRef.current.get(p.id);
          if (posEntry) {
            posEntry.targetX = p.x;
            posEntry.targetY = p.y;
          } else {
            peerPositionsRef.current.set(p.id, {
              currentX: p.x,
              currentY: p.y,
              targetX: p.x,
              targetY: p.y,
            });
          }

          // 名前・アバター画像・マイク状態など「見た目以外の情報」が変わった場合、
          // または初めて見る相手の場合だけReactのstateを更新する。位置(x, y)の
          // 変化だけでは再描画を起こさない(近接判定などロジック用には、下の
          // 定期的な同期処理で低頻度に反映する)。
          setPlayers((prev) => {
            const current = prev[p.id];
            if (!current) {
              return { ...prev, [p.id]: p };
            }
            if (
              current.name !== p.name ||
              current.color !== p.color ||
              current.avatarImage !== p.avatarImage ||
              current.micOn !== p.micOn ||
              current.sharingScreen !== p.sharingScreen ||
              current.inCall !== p.inCall ||
              current.meetingZoneId !== p.meetingZoneId ||
              current.message !== p.message ||
              current.dir !== p.dir ||
              current.status !== p.status
            ) {
              return {
                ...prev,
                [p.id]: { ...current, ...p, x: current.x, y: current.y },
              };
            }
            return prev;
          });
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
        .on("broadcast", { event: "layout-update" }, ({ payload }) => {
          const { obstacles: newObstacles, meetingZones: newZones } =
            payload as {
              obstacles?: Obstacle[];
              meetingZones?: MeetingZone[];
            };
          if (newObstacles) setObstacles(newObstacles);
          if (newZones) setMeetingZones(newZones);
        })
        .on("broadcast", { event: "webrtc-offer" }, async ({ payload }) => {
          const { from, to, sdp, videoTrackPurposes } = payload as {
            from: string;
            to: string;
            sdp: RTCSessionDescriptionInit;
            videoTrackPurposes?: Record<string, "screen" | "camera">;
          };
          if (to !== selfId.current) return;
          // ontrackが発火する前に、映像の種類を判定できるようにしておく。
          // 上書きではなく追記(マージ)することで、タイミングによって
          // 一部の情報が抜けたメッセージが来ても、以前分かっていた情報を
          // 失わないようにする。
          if (videoTrackPurposes) {
            const existing = peerVideoPurposes.current.get(from) || {};
            peerVideoPurposes.current.set(from, {
              ...existing,
              ...videoTrackPurposes,
            });
          }
          const pc = getOrCreatePeerConnection(from);

          // 交渉の衝突(グレア)対策:自分もちょうどofferを送ろうとしている
          // 最中に相手からofferが届くことがある(例:こちらが画面共有を
          // ONにした直後に、相手側の未ネゴシエーションtrackの再送信が
          // 重なる等)。IDの大小で固定した「polite(譲る側)」だけが自分の
          // offerを取り消して相手のofferを受け入れ、politeでない側は
          // 自分のofferを優先して届いたofferを無視する。これをしないと
          // 片方のsetRemoteDescriptionが失敗し、次の再試行まで映像/音声が
          // 更新されないことがあった。
          const polite = selfId.current >= from;
          const offerCollision =
            makingOffer.current.get(from) === true ||
            pc.signalingState !== "stable";
          if (offerCollision && !polite) return;

          try {
            if (offerCollision) {
              await pc.setLocalDescription({ type: "rollback" });
            }
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            // awaitで待っている間に、相手が離れて再度近づく等でこの接続が
            // 破棄・作り直しされていた場合、もうこのpcは無関係なので中断する
            // (再接続時に古いofferの処理が新しい接続へ混ざるのを防ぐ)。
            if (peerConnections.current.get(from) !== pc) return;
            await flushPendingCandidates(from, pc);
            const answer = await pc.createAnswer();
            if (peerConnections.current.get(from) !== pc) return;
            await pc.setLocalDescription(answer);
            channelRef.current?.send({
              type: "broadcast",
              event: "webrtc-answer",
              payload: {
                from: selfId.current,
                to: from,
                sdp: answer,
                videoTrackPurposes: buildVideoTrackPurposes(),
              },
            });
            // 自分がすでに画面共有/ビデオ通話中なら、この接続にもきちんと乗っているか確認する
            await ensureLocalVideoAttached(from);
          } catch {
            // pcが既に閉じられている等で失敗した場合は無視する(再度近づいた際の
            // 次のoffer/answerのやり取りに任せる)
          }
        })
        .on("broadcast", { event: "webrtc-answer" }, async ({ payload }) => {
          const { from, to, sdp, videoTrackPurposes } = payload as {
            from: string;
            to: string;
            sdp: RTCSessionDescriptionInit;
            videoTrackPurposes?: Record<string, "screen" | "camera">;
          };
          if (to !== selfId.current) return;
          // ontrackが発火する前に、映像の種類を判定できるようにしておく(こちらも追記)
          if (videoTrackPurposes) {
            const existing = peerVideoPurposes.current.get(from) || {};
            peerVideoPurposes.current.set(from, {
              ...existing,
              ...videoTrackPurposes,
            });
          }
          const pc = peerConnections.current.get(from);
          if (!pc) return;
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            if (peerConnections.current.get(from) !== pc) return;
            await flushPendingCandidates(from, pc);
            // 自分がすでに画面共有/ビデオ通話中なら、この接続にもきちんと乗っているか確認する
            await ensureLocalVideoAttached(from);
          } catch {
            // pcが既に閉じられている等で失敗した場合は無視する
          }
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
            // 人数上限チェック(プランごとのルーム定員)。presenceの状態は
            // SUBSCRIBED時点で既にサーバーから受け取っているものを見る。
            // 複数人が全く同時に入室した場合の厳密な排他制御まではできない
            // (クライアント側のベストエフォートな制限)。
            const currentCount = Object.keys(channel.presenceState()).length;
            if (currentCount >= maxPeoplePerRoom) {
              cancelled = true;
              channel.unsubscribe();
              if (channelRef.current === channel) channelRef.current = null;
              setRoomJoinError(
                `このルームは満員です(最大${maxPeoplePerRoom}人)。しばらくしてから再度お試しください。`,
              );
              setJoined(false);
              return;
            }
            await channel.track(selfState.current);
          }
          if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            // このチャンネルインスタンスはもう使えないため、同じインスタンスに
            // 再度subscribe()するのではなく、少し待ってから新しいチャンネルを
            // 作り直して再接続する(同一インスタンスへの2回目のsubscribe()は
            // 「tried to join multiple times」エラーになるため避ける)。
            if (channelRef.current !== channel) return; // すでに別の接続に置き換わっている
            if (reconnectTimer) return; // 予約は1つだけにする
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              if (cancelled) return;
              channel.unsubscribe();
              connectChannel();
            }, 1500);
          }
        });
    };

    connectChannel();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      channelRef.current?.unsubscribe();
      channelRef.current = null;
    };
  }, [
    joined,
    roomId,
    maxPeoplePerRoom,
    getOrCreatePeerConnection,
    flushPendingCandidates,
    ensureLocalVideoAttached,
  ]);

  // ---- 在室状況の自己修復 ----
  // 何らかの理由でpresenceのsync/leaveイベントを取りこぼした場合に備え、
  // 数秒おきに実際の在室状況と突き合わせて、いない人を消す・見えていない人を
  // 追加する。既存の位置情報(broadcastで得た最新の座標)は上書きしない。
  // 「いない」判定は瞬間的な取得タイミングのズレで誤検知することがあるため、
  // 2回連続で確認できてから削除する(1回だけの不在は様子見)。
  const suspectedGoneRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!joined) return;
    const interval = setInterval(() => {
      const channel = channelRef.current;
      if (!channel) return;
      const state = channel.presenceState<PlayerState>();
      const presentIds = new Set<string>();
      Object.values(state).forEach((entries) => {
        const p = entries[0] as PlayerState;
        presentIds.add(p.id);
      });

      setPlayers((prev) => {
        let changed = false;
        const next = { ...prev };
        const stillSuspected = new Set<string>();

        Object.keys(next).forEach((id) => {
          if (id === selfId.current || presentIds.has(id)) return;
          if (suspectedGoneRef.current.has(id)) {
            // 前回に続き2回連続で不在を確認できたので削除する
            delete next[id];
            peerPositionsRef.current.delete(id);
            changed = true;
          } else {
            // 今回が初めての不在確認。次回も不在なら削除する
            stillSuspected.add(id);
          }
        });
        suspectedGoneRef.current = stillSuspected;

        // 実際には在室しているのに、こちらで把握できていない相手を追加
        Object.values(state).forEach((entries) => {
          const p = entries[0] as PlayerState;
          if (p.id !== selfId.current && !next[p.id]) {
            next[p.id] = p;
            changed = true;
          }
        });

        return changed ? next : prev;
      });

      // 壊れた・古くなったWebRTC接続を検知して閉じる。
      // 「片方の画面では繋がったままになっているのに、もう片方はすでに
      // 接続を作り直している」というズレが起きると、再接続してもプレビューが
      // 出ないことがあるため、定期的に接続状態を確認し、正常でないものは
      // 一度閉じて次の機会に作り直せるようにする。
      peerConnections.current.forEach((pc, peerId) => {
        const isEligibleNow = presentIds.has(peerId);
        const unhealthy =
          pc.connectionState === "failed" ||
          pc.connectionState === "closed" ||
          (pc.connectionState === "disconnected" && !isEligibleNow);
        if (unhealthy) {
          closePeerConnection(peerId);
          return;
        }
        // 接続自体は生きていても、画面共有・ビデオ通話の映像トラックが
        // 何らかの理由でうまく乗っていないことがある。手動でON/OFFし
        // 直さなくても直るよう、定期的に確認して足りなければ補う。
        ensureLocalVideoAttached(peerId);
      });
    }, 2500);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, closePeerConnection, ensureLocalVideoAttached]);

  // ---- ブラウザを閉じる/タブを閉じる際、明示的に退室を通知する ----
  // 何もしないと、Supabase側が「切断された」と気づくまで数十秒かかることがあり、
  // その間は「もう存在しない古い自分」が在室したまま残ってしまう
  // (再度入室すると、実際には1人なのに2人分見えてしまう原因になる)。
  // ページを離れる瞬間にできる範囲でチャンネルの購読を解除し、素早く
  // 「退室」を伝える。ブラウザのクラッシュなど、必ず届くとは限らない点は
  // 限界として残る。
  useEffect(() => {
    if (!joined) return;
    const handleLeave = () => {
      channelRef.current?.unsubscribe();
    };
    window.addEventListener("beforeunload", handleLeave);
    window.addEventListener("pagehide", handleLeave);
    return () => {
      window.removeEventListener("beforeunload", handleLeave);
      window.removeEventListener("pagehide", handleLeave);
    };
  }, [joined]);

  // ---- タブがバックグラウンドから復帰した際、即座に再同期する ----
  // スマホでアプリを切り替えたりロック画面から戻った際、requestAnimationFrameが
  // 一時停止するため、その間の位置更新が相手に届いていないことがある。
  // 復帰した瞬間にpresenceの再trackと最新位置の送信を行い、素早く復旧させる。
  useEffect(() => {
    if (!joined) return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (selfState.current && channelRef.current) {
        channelRef.current.track(selfState.current);
        channelRef.current.send({
          type: "broadcast",
          event: "move",
          payload: selfState.current,
        });
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [joined]);

  // ---- キーボード入力 ----
  useEffect(() => {
    if (!joined) return;

    // ブラウザ標準のスクロール等を発火させたくないキーの一覧
    const SCROLL_KEYS = new Set([
      "arrowup",
      "arrowdown",
      "arrowleft",
      "arrowright",
      " ", // スペースキー(押しっぱなしでページが下スクロールされるのを防ぐ)
    ]);

    const onKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "INPUT") return;
      const key = e.key.toLowerCase();

      // 矢印キー・スペースキーによる「ページ自体のスクロール」を止める。
      // これを止めないと、アバターの移動と同時にブラウザがヘッダーや
      // サイドバーを含む画面全体をスクロールさせてしまい、
      // レイアウトごと動いて見えてしまう。
      if (SCROLL_KEYS.has(key) || SCROLL_KEYS.has(e.key)) {
        e.preventDefault();
      }

      keysDown.current.add(key);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysDown.current.delete(e.key.toLowerCase());
    };
    // passive: false にしないと preventDefault() が効かないブラウザがあるため明示する
    window.addEventListener("keydown", onKeyDown, { passive: false });
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

          const halfW = AVATAR_HITBOX_WIDTH / 2;
          const halfH = AVATAR_HITBOX_HEIGHT / 2;

          const nextX = Math.min(
            Math.max(self.x + dx, halfW),
            mapSizeRef.current.width - halfW,
          );
          const nextY = Math.min(
            Math.max(self.y + dy, halfH),
            mapSizeRef.current.height - halfH,
          );

          // 障害物との当たり判定(矩形どうし)。X軸・Y軸を別々に判定することで、
          // 障害物に斜めから近づいても壁沿いに滑るように移動できる。
          const blockedX = obstaclesRef.current.some((o) =>
            rectIntersectsRect(nextX, self.y, halfW, halfH, o),
          );
          const blockedY = obstaclesRef.current.some((o) =>
            rectIntersectsRect(self.x, nextY, halfW, halfH, o),
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
        const zoneId = findMeetingZoneId(
          self.x,
          self.y,
          meetingZonesRef.current,
        );
        self.meetingZoneId = zoneId;
        if (zoneId !== lastTrackedZoneId.current) {
          lastTrackedZoneId.current = zoneId;
          // presence情報も更新しておく(入室直後の相手にも最新状態が伝わるように)
          channelRef.current?.track(self);
        }

        // 自分のアバターの見た目の位置は、Reactのstateを介さずDOM操作で
        // 直接更新する(毎フレーム呼んでも画面全体の再描画が起きない)。
        avatarRefs.current.get(self.id)?.updatePosition(self.x, self.y);

        // マイクの音声が届く範囲の目安の円も、アバターと同じく毎フレーム
        // DOM操作で位置を更新する(Reactのstate経由だと追従が遅れて見える)。
        if (proximityCircleRef.current) {
          proximityCircleRef.current.style.transform = `translate(${
            self.x - PROXIMITY_RADIUS
          }px, ${self.y - PROXIMITY_RADIUS}px)`;
        }

        // カメラ(マップ全体の表示位置)もDOM操作で直接更新する。
        // 画面中央に自分を固定し、端では止めてアイコン側が動くようにする。
        // スマホ(画面幅が狭い)場合は少し縮小(ズームアウト)して周囲が見えるようにする。
        const viewport = viewportRef.current;
        const mapScale = viewport.width > 0 && viewport.width < 640 ? 0.7 : 1;
        const effectiveViewportWidth = viewport.width / mapScale;
        const effectiveViewportHeight = viewport.height / mapScale;
        const maxCameraX = Math.max(
          mapSizeRef.current.width - effectiveViewportWidth,
          0,
        );
        const maxCameraY = Math.max(
          mapSizeRef.current.height - effectiveViewportHeight,
          0,
        );
        const cameraX = Math.min(
          Math.max(self.x - effectiveViewportWidth / 2, 0),
          maxCameraX,
        );
        const cameraY = Math.min(
          Math.max(self.y - effectiveViewportHeight / 2, 0),
          maxCameraY,
        );
        if (worldRef.current) {
          worldRef.current.style.transform = `scale(${mapScale}) translate(${-cameraX}px, ${-cameraY}px)`;
        }

        // 相手の位置は補間(interpolation)しながら描画する。broadcastで届いた
        // target座標へ、フレームレートに依存しない速度で滑らかに近づけていく。
        const EASE_RATE = 12; // 大きいほど素早くtargetへ追いつく
        const easeFactor = 1 - Math.exp(-EASE_RATE * dt);
        peerPositionsRef.current.forEach((pos, peerId) => {
          pos.currentX += (pos.targetX - pos.currentX) * easeFactor;
          pos.currentY += (pos.targetY - pos.currentY) * easeFactor;
          avatarRefs.current
            .get(peerId)
            ?.updatePosition(pos.currentX, pos.currentY);

          // 近接ボイスチャットの接続開始・終了は、Reactのstate更新(最大0.2秒おき+
          // エフェクトの実行タイミング)を待たず、毎フレームその場でチェックする。
          // 開始を早めることで実際に近づいた時点までに接続を完了させやすくし、
          // 終了も同じ頻度でチェックすることで「離れてもしばらく繋がったまま」
          // に見える遅延をなくす(以前は開始だけここで即座に行い、終了はReactの
          // eligiblePeerIdsエフェクト任せだったため、体感で数秒のズレが出ていた)。
          const dist = Math.hypot(pos.targetX - self.x, pos.targetY - self.y);
          const peerZone = playersRef.current[peerId]?.meetingZoneId;
          const sameZone = !!(
            self.meetingZoneId &&
            peerZone &&
            self.meetingZoneId === peerZone
          );
          const connected = peerConnections.current.has(peerId);
          if (!connected) {
            if (sameZone || dist <= PROXIMITY_RADIUS) {
              if (selfId.current < peerId) {
                startCall(peerId);
              } else {
                getOrCreatePeerConnection(peerId);
              }
            }
          } else if (!sameZone && dist > PROXIMITY_RADIUS + 20) {
            // eligiblePeerIdsと同じヒステリシス幅(+20)を使い、境界線上での
            // 接続/切断のチラつきを防ぎつつ、ここでも即座に切断する。
            closePeerConnection(peerId);
          }
        });

        // 動いた時、および「今まさに止まった瞬間」だけ他プレイヤーへブロードキャスト。
        // 止まった瞬間を送らないと、相手の画面では最後に動いていた位置のまま
        // 止まって見えてしまい、キーを離してから反映されるようなラグに感じられる。
        // 移動中の送信は約14回/秒に間引く(複数人が同時に動いても送信上限に
        // 余裕を持たせ、回線が不安定になって再接続が走るのを防ぐ)。止まった
        // 瞬間だけは間引かずに必ず送る。さらに、静止中でも3秒おきに現在位置を
        // 送る(ハートビート)。何らかの理由で相手に届いていなかった場合でも、
        // 数秒以内に自然と復旧するようにするため。
        const justStopped = !moving && wasMovingRef.current;
        const heartbeatDue = !moving && time - lastMoveSentAt.current >= 3000;
        const intervalElapsed = time - lastMoveSentAt.current >= 70; // 約14回/秒
        if ((moving && intervalElapsed) || justStopped || heartbeatDue) {
          if (channelRef.current) {
            channelRef.current.send({
              type: "broadcast",
              event: "move",
              payload: self,
            });
            lastMoveSentAt.current = time;
          }
        }
        wasMovingRef.current = moving;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [joined, startCall, getOrCreatePeerConnection, closePeerConnection]);

  // ---- 位置情報をロジック用に低頻度でReactのstateへ同期する ----
  // 見た目の描画はDOM操作で毎フレーム行っているが、近接判定(eligiblePeerIds)
  // などのロジックは`players`のx, yを見て計算しているため、0.2秒おき程度の
  // 頻度でここに反映しておく。毎フレーム同期しないことで再描画の回数を大幅に
  // 減らしつつ、ロジックが極端に古い座標を参照し続けることも防ぐ。
  useEffect(() => {
    if (!joined) return;
    const interval = setInterval(() => {
      setPlayers((prev) => {
        let changed = false;
        const next = { ...prev };

        const self = selfState.current;
        if (self && next[self.id]) {
          const last = lastSelfSyncRef.current;
          if (
            !last ||
            last.x !== self.x ||
            last.y !== self.y ||
            last.dir !== self.dir
          ) {
            lastSelfSyncRef.current = { x: self.x, y: self.y, dir: self.dir };
            next[self.id] = {
              ...next[self.id],
              x: self.x,
              y: self.y,
              dir: self.dir,
            };
            changed = true;
          }
        }

        peerPositionsRef.current.forEach((pos, peerId) => {
          const current = next[peerId];
          if (
            current &&
            (current.x !== pos.targetX || current.y !== pos.targetY)
          ) {
            next[peerId] = { ...current, x: pos.targetX, y: pos.targetY };
            changed = true;
          }
        });

        return changed ? next : prev;
      });
    }, 200);
    return () => clearInterval(interval);
  }, [joined]);

  // ---- 表示領域(ビューポート)のサイズを監視(カメラ追従の計算に使用) ----
  useEffect(() => {
    if (!joined) return;
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const size = { width: el.clientWidth, height: el.clientHeight };
      viewportRef.current = size;
      setViewport(size);
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
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    };
  }, [joined]);

  // ---- 音声通話:接続すべき相手を計算 ----
  // 条件は「同じミーティングエリアに二人ともいる」か「一定距離より近い(近接ボイスチャット)」。
  // 距離判定には余裕(ヒステリシス)を持たせ、境界線上での接続/切断のチラつきを
  // 防いでいる。特に「接続済みの相手」は、少し動いただけで音声通話や画面共有が
  // 切れてしまわないよう、切断までの距離を大きく広げている(実際にその場を
  // 離れるまでは繋がったままにする)。
  const eligiblePeerIds = useMemo(() => {
    const self = players[selfId.current];
    if (!self) return [] as string[];
    return Object.values(players)
      .filter((p) => {
        if (p.id === selfId.current) return false;
        if (
          self.meetingZoneId &&
          p.meetingZoneId &&
          self.meetingZoneId === p.meetingZoneId
        )
          return true;
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
      peerVideoPurposes.current.clear();
      peerPositionsRef.current.clear();
      avatarRefs.current.clear();
      setRemoteStreams({});
      setRemoteScreenStreams({});
      setRemoteCallStreams({});
    };
  }, [joined]);

  // 相手から離れて映像が届かなくなったら、開いていた全画面表示も自動的に閉じる
  useEffect(() => {
    if (!expandedMedia) return;
    const streamMap =
      expandedMedia.kind === "screen" ? remoteScreenStreams : remoteCallStreams;
    if (!streamMap[expandedMedia.peerId]) {
      setExpandedMedia(null);
    }
  }, [expandedMedia, remoteScreenStreams, remoteCallStreams]);

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

  // ---- 入室後の設定変更(名前・アバター画像・在席ステータス) ----
  const openSettings = useCallback(() => {
    setSettingsNameInput(selfState.current?.name ?? "");
    setSettingsAvatar(selfState.current?.avatarImage ?? AVATAR_IMAGES[0]);
    setSettingsStatus(selfState.current?.status ?? "available");
    setSettingsOpen(true);
  }, []);

  const saveSettings = useCallback(() => {
    if (!selfState.current) return;
    const name =
      settingsNameInput.trim() || `ゲスト${selfId.current.slice(0, 4)}`;
    selfState.current.name = name;
    selfState.current.avatarImage = settingsAvatar;
    selfState.current.status = settingsStatus;
    const updated = selfState.current;
    setPlayers((prev) => ({ ...prev, [updated.id]: { ...updated } }));
    channelRef.current?.track(updated);
    setSettingsOpen(false);
  }, [settingsNameInput, settingsAvatar, settingsStatus]);

  // ---- ルーム選択画面(Googleログイン後、最初に必ずここへ来る) ----
  if (!roomSelected) {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-hidden bg-slate-900 px-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
          <h1 className="mb-1 text-lg font-bold text-slate-800">
            ルームを選択
          </h1>
          <p className="mb-4 text-sm text-slate-500">
            入室するルームを選んでください
          </p>

          {rooms.length === 0 && (
            <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              まだルームがありません。管理画面からルームを作成してください。
            </p>
          )}

          <div className="mb-4 grid grid-cols-2 gap-2">
            {rooms.map((room) => (
              <button
                key={room.id}
                type="button"
                onClick={() => setSelectedRoomId(room.id)}
                className={`overflow-hidden rounded-lg border-2 bg-slate-100 text-left transition-colors ${
                  selectedRoomId === room.id
                    ? "border-slate-900"
                    : "border-transparent hover:border-slate-300"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={room.previewImage}
                  alt={room.name}
                  className="aspect-video w-full object-cover"
                />
                <p className="truncate px-2 py-1.5 text-xs font-semibold text-slate-700">
                  {room.name}
                </p>
              </button>
            ))}
          </div>

          <button
            onClick={handleSelectRoom}
            disabled={rooms.length === 0}
            className="w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
          >
            入室
          </button>
        </div>
      </div>
    );
  }

  // ---- 入室前:名前入力・アバター選択モーダル ----
  if (!joined) {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-hidden bg-slate-900 px-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
          <h1 className="mb-1 text-lg font-bold text-slate-800">
            {roomName}に入室
          </h1>
          <p className="mb-4 text-sm text-slate-500">
            アバターを選んで、表示する名前を入力してください(空欄の場合はゲスト表示になります)
          </p>

          {roomJoinError && (
            <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
              {roomJoinError}
            </p>
          )}

          <div className="mb-4">
            <AvatarPicker
              selected={selectedAvatar}
              onSelect={setSelectedAvatar}
            />
          </div>

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

  // 近く(音声通話が繋がっている相手)にいて、かつ画面共有中の人の一覧
  const eligibleSetForScreen = new Set(eligiblePeerIds);
  const visibleScreenShares = playerList.filter(
    (p) =>
      p.id !== selfId.current &&
      p.sharingScreen &&
      eligibleSetForScreen.has(p.id) &&
      remoteScreenStreams[p.id],
  );

  // 近くにいて、かつビデオ通話中の人の一覧
  const visibleVideoCalls = playerList.filter(
    (p) =>
      p.id !== selfId.current &&
      p.inCall &&
      eligibleSetForScreen.has(p.id) &&
      remoteCallStreams[p.id],
  );

  // ---- カメラ計算:自分を画面中央に固定し、端では止めてアイコン側が動くようにする ----
  // スマホ(画面幅が狭い)場合は少し縮小(ズームアウト)して周囲が見えるようにする。
  const selfPlayer = players[selfId.current];
  const mapScale = viewport.width > 0 && viewport.width < 640 ? 0.7 : 1;
  const effectiveViewportWidth = viewport.width / mapScale;
  const effectiveViewportHeight = viewport.height / mapScale;
  const maxCameraX = Math.max(mapSize.width - effectiveViewportWidth, 0);
  const maxCameraY = Math.max(mapSize.height - effectiveViewportHeight, 0);
  const cameraX = selfPlayer
    ? Math.min(
        Math.max(selfPlayer.x - effectiveViewportWidth / 2, 0),
        maxCameraX,
      )
    : 0;
  const cameraY = selfPlayer
    ? Math.min(
        Math.max(selfPlayer.y - effectiveViewportHeight / 2, 0),
        maxCameraY,
      )
    : 0;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-slate-800">
      {/* ヘッダー */}
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-slate-700 bg-slate-900 px-4 py-2 text-white">
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Grovina"
              className="h-5 w-5 object-contain"
            />
          </div>
          <span className="hidden text-sm font-semibold sm:inline">
            {roomName}
          </span>
        </div>

        {/* 右側:テキスト情報(幅が足りない時だけ横スクロールで隠れてよい)と、
      操作アイコン(常に全部見える必要がある)を別グループに分ける。
      同じスクロール領域に入れてしまうと、幅が足りない時にアイコンごと
      スクロール範囲の外に出てしまい、⚙️などが見えなくなることがあったため。 */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <div className="no-scrollbar min-w-0 overflow-x-auto whitespace-nowrap">
            <span className="hidden shrink-0 text-xs text-slate-300 md:inline">
              オンライン: {playerList.length}人
            </span>
            {eligiblePeerIds.length > 0 && (
              <span className="ml-2 hidden shrink-0 rounded-full bg-emerald-600/80 px-2 py-0.5 text-[10px] font-semibold text-white sm:inline-block">
                🎧 音声通話中({eligiblePeerIds.length}人)
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="shrink-0">
              <MicButton enabled={micEnabled} onClick={toggleMic} />
            </div>
            <div className="shrink-0">
              <ScreenShareButton
                enabled={screenSharing}
                onClick={toggleScreenShare}
              />
            </div>
            <div className="shrink-0">
              <VideoCallButton enabled={inCall} onClick={toggleVideoCall} />
            </div>
            {/* 設定アイコンはサイドバーの「自分」欄に移動した */}
            {/* スマホのみ表示するハンバーガーボタン */}
            <button
              onClick={() => setShowParticipants((v) => !v)}
              className="shrink-0 rounded p-1.5 hover:bg-white/10 sm:hidden"
              aria-label="参加者一覧を開く"
            >
              <span className="mb-1 block h-0.5 w-5 bg-white" />
              <span className="mb-1 block h-0.5 w-5 bg-white" />
              <span className="block h-0.5 w-5 bg-white" />
            </button>
          </div>
        </div>
      </div>

      {/* マイク許可エラーの通知 */}
      {micError && (
        <div className="bg-red-900/80 px-4 py-2 text-center text-xs text-red-100">
          {micError}
        </div>
      )}
      {shareError && (
        <div className="bg-red-900/80 px-4 py-2 text-center text-xs text-red-100">
          {shareError}
        </div>
      )}
      {callError && (
        <div className="bg-red-900/80 px-4 py-2 text-center text-xs text-red-100">
          {callError}
        </div>
      )}

      {/* 画面共有・ビデオ通話のプレビュー(自分・近くにいる相手)を画面上部に並べて表示 */}
      {(screenSharing ||
        inCall ||
        visibleScreenShares.length > 0 ||
        visibleVideoCalls.length > 0) && (
        <div className="flex flex-wrap gap-2 bg-slate-900/80 px-3 py-2">
          {screenSharing && screenStreamRef.current && (
            <div className="relative">
              <RemoteVideo
                stream={screenStreamRef.current}
                className="h-20 w-32 rounded-md border border-emerald-400 bg-black object-contain"
              />
              <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
                あなたの画面
              </span>
              <button
                onClick={stopScreenShare}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[10px] text-white shadow hover:bg-red-500"
                aria-label="画面共有を終了"
              >
                ✕
              </button>
            </div>
          )}

          {inCall && cameraStreamRef.current && (
            <div className="relative">
              <RemoteVideo
                stream={cameraStreamRef.current}
                className="h-20 w-32 rounded-md border border-emerald-400 bg-black object-cover"
              />
              <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
                あなたのカメラ
              </span>
              <button
                onClick={stopVideoCall}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[10px] text-white shadow hover:bg-red-500"
                aria-label="ビデオ通話を終了"
              >
                ✕
              </button>
            </div>
          )}

          {visibleScreenShares.map((p) => (
            <button
              key={`screen-${p.id}`}
              onClick={() => setExpandedMedia({ peerId: p.id, kind: "screen" })}
              className="relative"
              aria-label={`${p.name}の画面を全画面表示`}
            >
              <RemoteVideo
                stream={remoteScreenStreams[p.id]}
                className="h-20 w-32 rounded-md border border-slate-500 bg-black object-contain"
              />
              <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
                {p.name}の画面
              </span>
            </button>
          ))}

          {visibleVideoCalls.map((p) => (
            <button
              key={`call-${p.id}`}
              onClick={() => setExpandedMedia({ peerId: p.id, kind: "camera" })}
              className="relative"
              aria-label={`${p.name}とのビデオ通話を全画面表示`}
            >
              <RemoteVideo
                stream={remoteCallStreams[p.id]}
                className="h-20 w-32 rounded-md border border-slate-500 bg-black object-cover"
              />
              <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
                {p.name}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* マップ:表示領域は固定し、中の世界をtransformで動かしてカメラ追従を実現。
            transformの更新は毎フレームDOM操作で行うため、ここでは初期値のみ指定する。
            flexアイテムはデフォルトでmin-width/min-height: autoになり、中身が
            大きいと縮まず親を押し広げてしまうことがあるため、min-w-0/min-h-0で
            明示的に「縮んでよい」ことを指定しておく(中身のworldRefはposition:
            absoluteなので通常は影響しないはずだが、念のための保険)。 */}
        <div
          ref={containerRef}
          className="relative min-w-0 flex-1 overflow-hidden bg-slate-700"
        >
          <div
            ref={worldRef}
            className="absolute left-0 top-0"
            style={{
              width: mapSize.width,
              height: mapSize.height,
              transformOrigin: "0 0",
              transform: `scale(${mapScale}) translate(${-cameraX}px, ${-cameraY}px)`,
              backgroundImage: `url('${backgroundImageUrl}')`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
              backgroundColor: "#334155",
            }}
          >
            {/* ミーティングエリア(複数設置可能)。配置はマスターがテンプレート側で編集する
                (ルーム内での編集は廃止)。 */}
            {meetingZones.map((zone) => (
              <div
                key={zone.id}
                className="absolute flex items-start rounded-xl border border-slate-500 bg-slate-600/60 p-2"
                style={{
                  left: zone.x,
                  top: zone.y,
                  width: zone.width,
                  height: zone.height,
                }}
              >
                <span className="text-[11px] text-slate-300">{zone.label}</span>
              </div>
            ))}

            {/* 障害物(机・観葉植物・棚など)。見た目には出さず、当たり判定だけの
                透明な壁として機能する。配置はマスターがテンプレート側で編集する。 */}
            {obstacles.map((o) => (
              <div
                key={o.id}
                className="absolute border-none bg-transparent"
                style={{
                  left: o.x,
                  top: o.y,
                  width: o.width,
                  height: o.height,
                }}
              />
            ))}

            {/* 自分の音声が届く範囲の目安(マイクON時のみ表示。位置は毎フレームDOM操作で更新) */}
            <div
              ref={proximityCircleRef}
              className={`pointer-events-none absolute left-0 top-0 rounded-full border border-emerald-400/40 ${
                micEnabled ? "" : "hidden"
              }`}
              style={{
                width: PROXIMITY_RADIUS * 2,
                height: PROXIMITY_RADIUS * 2,
              }}
            />

            {playerList.map((p) => (
              <Avatar
                key={p.id}
                player={p}
                isSelf={p.id === selfId.current}
                ref={(handle) => {
                  if (handle) {
                    avatarRefs.current.set(p.id, handle);
                    // 生成された直後、Reactが把握している最新座標を初期位置として反映しておく
                    // (次のrAFフレームまで座標(0,0)に見えてしまうのを防ぐ)
                    if (p.id === selfId.current && selfState.current) {
                      handle.updatePosition(
                        selfState.current.x,
                        selfState.current.y,
                      );
                    } else {
                      const pos = peerPositionsRef.current.get(p.id);
                      handle.updatePosition(
                        pos?.currentX ?? p.x,
                        pos?.currentY ?? p.y,
                      );
                    }
                  } else {
                    avatarRefs.current.delete(p.id);
                  }
                }}
              />
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
            <h2 className="text-xs font-semibold text-slate-400">自分</h2>
            <button
              onClick={() => setShowParticipants(false)}
              className="text-slate-400 hover:text-white sm:hidden"
              aria-label="閉じる"
            >
              ✕
            </button>
          </div>
          {selfPlayer && (
            <div className="mb-3 flex items-center justify-between gap-2 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      PRESENCE_STATUS_COLORS[selfPlayer.status ?? "available"],
                  }}
                />
                <span className="truncate">{selfPlayer.name}</span>
                <span className="shrink-0 text-[10px] text-slate-400">
                  (あなた)
                </span>
              </div>
              <button
                onClick={openSettings}
                className="shrink-0 rounded p-1 text-sm hover:bg-white/10"
                aria-label="アバター・名前の設定"
                title="アバター・名前を変更"
              >
                ⚙️
              </button>
            </div>
          )}

          <h2 className="mb-2 text-xs font-semibold text-slate-400">参加者</h2>
          <ul className="space-y-1">
            {playerList
              .filter((p) => p.id !== selfId.current)
              .map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        PRESENCE_STATUS_COLORS[p.status ?? "available"],
                    }}
                  />
                  <span className="truncate">{p.name}</span>
                </li>
              ))}
          </ul>

          {/* 退出:ルーム選択画面へ戻る
              (マップ編集はマスターのテンプレート編集に一本化したため、
              ここにあった「マップを編集」ボタンは撤去した) */}
          <div className="mt-4 border-t border-slate-700 pt-3">
            <button
              onClick={handleLeaveRoom}
              className="w-full rounded-lg bg-red-900/60 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-900"
            >
              🚪 退出
            </button>
          </div>

          {/* チャット入力(以前は画面下部にあったが、サイドバー最下部へ移動した) */}
          <div className="mt-auto border-t border-slate-700 pt-3">
            <p className="mb-2 text-[10px] leading-relaxed text-slate-400">
              移動:PCは WASD / 矢印キー、スマホは左下のボタン
            </p>
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendChat()}
              placeholder="メッセージを入力してEnter"
              className="mb-2 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-slate-400"
            />
            <button
              onClick={sendChat}
              className="w-full rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600"
            >
              送信
            </button>
          </div>
        </div>
      </div>

      {/* スマホ用移動ボタン(sm以上の画面では非表示) */}
      <TouchControls
        onPress={handleTouchPress}
        onRelease={handleTouchRelease}
      />

      {/* 相手の音声を再生する非表示要素(自動接続された分だけ生成) */}
      {Object.entries(remoteStreams).map(([peerId, stream]) => (
        <RemoteAudio key={peerId} stream={stream} />
      ))}

      {/* 画面共有・ビデオ通話:全画面表示 */}
      {expandedMedia &&
        (() => {
          const streamMap =
            expandedMedia.kind === "screen"
              ? remoteScreenStreams
              : remoteCallStreams;
          const stream = streamMap[expandedMedia.peerId];
          if (!stream) return null;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
              <RemoteVideo
                stream={stream}
                className={`h-full w-full ${
                  expandedMedia.kind === "screen"
                    ? "object-contain"
                    : "object-cover"
                }`}
              />
              <button
                onClick={() => setExpandedMedia(null)}
                className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-lg text-white hover:bg-black/80"
                aria-label="全画面表示を閉じる"
              >
                ✕
              </button>
            </div>
          );
        })()}

      {/* アバター・名前の変更モーダル */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-base font-bold text-slate-800">
              アバター・名前の変更
            </h2>

            <div className="mb-4">
              <AvatarPicker
                selected={settingsAvatar}
                onSelect={setSettingsAvatar}
              />
            </div>

            <input
              value={settingsNameInput}
              onChange={(e) => setSettingsNameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveSettings()}
              placeholder="例:みく"
              className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />

            <div className="mb-4">
              <p className="mb-2 text-xs font-semibold text-slate-500">
                ステータス
              </p>
              <div className="flex flex-col gap-2">
                {(
                  Object.keys(PRESENCE_STATUS_LABELS) as PresenceStatus[]
                ).map((status) => (
                  <label
                    key={status}
                    className="flex items-center gap-2 text-sm text-slate-700"
                  >
                    <input
                      type="radio"
                      name="presence-status"
                      value={status}
                      checked={settingsStatus === status}
                      onChange={() => setSettingsStatus(status)}
                    />
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: PRESENCE_STATUS_COLORS[status] }}
                    />
                    {PRESENCE_STATUS_LABELS[status]}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setSettingsOpen(false)}
                className="flex-1 rounded-lg bg-slate-200 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300"
              >
                キャンセル
              </button>
              <button
                onClick={saveSettings}
                className="flex-1 rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              >
                保存する
              </button>
            </div>

            <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
              {isAccountAdmin && (
                <Link
                  href="/admin"
                  className="block w-full rounded-lg bg-slate-100 py-2 text-center text-sm font-semibold text-slate-700 hover:bg-slate-200"
                >
                  管理画面へ
                </Link>
              )}
              {isMaster && (
                <Link
                  href="/master"
                  className="block w-full rounded-lg bg-emerald-50 py-2 text-center text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  マスター画面へ
                </Link>
              )}
              <LogoutButton className="w-full rounded-lg bg-red-50 py-2 text-sm font-semibold text-red-600 hover:bg-red-100" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
