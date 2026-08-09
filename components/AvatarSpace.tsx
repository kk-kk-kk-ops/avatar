"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RealtimeChannel } from "@supabase/supabase-js";
import {
  Room as LiveKitRoom,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
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
  MESSAGE_MAX_LENGTH,
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

// 画面共有・ビデオ通話の残り時間(秒)を「◯分◯秒」表示に整形する。
function formatRemainingTime(remainingSeconds: number): string {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${minutes}分${seconds}秒`;
}

// DMメッセージ一覧のスクロール位置が最下部付近(閾値px以内)かどうかを判定する。
function isDmScrollNearBottom(el: HTMLDivElement, thresholdPx = 80): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
}

// 画面共有開始時点の最初の1フレームを、選択前プレビュー用の軽量な
// JPEG dataURLとして切り出す。取得に失敗した場合はnullを返す
// (プレビューが出ないだけで、選択視聴自体は引き続き可能)。
async function captureFirstFrame(
  mediaStreamTrack: MediaStreamTrack,
): Promise<string | null> {
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([mediaStreamTrack]);
    await video.play();
    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        video.onloadeddata = () => resolve();
      });
    }
    const targetWidth = 160;
    const scale = targetWidth / (video.videoWidth || targetWidth);
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = Math.round((video.videoHeight || 90) * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.6);
  } catch {
    return null;
  }
}

type Props = {
  initialName?: string;
  rooms: Room[];
  maxPeoplePerRoom: number;
  // プランごとの画面共有1日あたり利用可能時間(分)。nullは無制限。
  // 毎日4:00にリセットされる累積(daily_usageテーブル)と比較して
  // 残り時間を算出する。
  screenShareDailyMinutes: number | null;
  // プランごとのビデオ通話1日あたり利用可能時間(分)。nullは無制限。
  // 画面共有と全く同じ仕組み(daily_usageテーブル、kind='video_call')。
  videoCallDailyMinutes: number | null;
  isAccountAdmin: boolean;
  isMaster: boolean;
  // 他人の招待URL経由で参加しているゲストの場合のみ渡される招待
  // トークン。ログアウト後、管理者用ログイン画面ではなく元の招待URLの
  // ゲスト用ログイン画面に戻すために使う。
  guestInviteToken?: string | null;
  // アバターの表示サイズ(px、正方形)。マスター画面で設定できる
  // app_settings.avatar_size_pxの値。未指定時はAvatar側のデフォルトを使う。
  avatarSizePx?: number;
  // viewOnly(自分のアカウントを持つ人が他人の招待URLを一時閲覧中)の場合
  // だけ渡される招待トークン。LiveKitのToken発行APIへ、通常のRLSでは
  // 証明できないルームアクセス権を伝えるために使う。
  viewOnlyInviteToken?: string;
};

export default function AvatarSpace({
  initialName,
  rooms,
  maxPeoplePerRoom,
  screenShareDailyMinutes,
  videoCallDailyMinutes,
  isAccountAdmin,
  isMaster,
  guestInviteToken,
  avatarSizePx,
  viewOnlyInviteToken,
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
  // ルーム選択画面で各ルームのオンライン人数を表示するための集計。
  // 自分自身はtrack()しない観測者としてpresenceチャンネルを覗くだけ。
  const [roomOnlineCounts, setRoomOnlineCounts] = useState<
    Record<string, number>
  >({});
  const [joined, setJoined] = useState(false);
  const [nameInput, setNameInput] = useState(initialName ?? "");
  const [selectedAvatar, setSelectedAvatar] = useState(AVATAR_IMAGES[0]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsNameInput, setSettingsNameInput] = useState("");
  const [settingsAvatar, setSettingsAvatar] = useState(AVATAR_IMAGES[0]);
  const [settingsStatus, setSettingsStatus] =
    useState<PresenceStatus>("available");
  const [settingsMessageInput, setSettingsMessageInput] = useState("");
  const [settingsShowMessage, setSettingsShowMessage] = useState(false);
  const [players, setPlayers] = useState<Record<string, PlayerState>>({});
  const playersRef = useRef<Record<string, PlayerState>>({});
  // LiveKitのイベントハンドラ(登録時に一度だけクロージャが作られる)から
  // 常に最新のeligiblePeerIdsを読めるようにするための参照。
  const eligiblePeerIdsRef = useRef<string[]>([]);
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
  // 画面共有の「今日の残り利用可能時間(秒)」。nullは「未取得(初回ロード中)」
  // または「プランが無制限」のどちらか(どちらの場合も制限しない、という
  // 挙動は同じなので区別する必要がない)。プランの1日あたり上限
  // (screenShareDailyMinutes)からDB上の本日使用済み秒数(daily_usage、
  // kind='screen_share')を引いて算出する。
  const [screenShareRemainingSeconds, setScreenShareRemainingSeconds] =
    useState<number | null>(null);
  const screenShareRemainingRef = useRef<number | null>(null);
  useEffect(() => {
    screenShareRemainingRef.current = screenShareRemainingSeconds;
  }, [screenShareRemainingSeconds]);
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<
    Record<string, MediaStream>
  >({});
  // 画面共有は「同時に何人でも共有できるが、視聴者は1人だけ選んで見る」
  // モデルのため、通常のAudio/CameraのようにeligiblePeerIdsだけを見て
  // 自動購読はしない。選んだ相手のpublicationだけをsetSubscribed(true)する。
  const [selectedScreenSharerId, setSelectedScreenSharerId] = useState<
    string | null
  >(null);
  const selectedScreenSharerIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedScreenSharerIdRef.current = selectedScreenSharerId;
  }, [selectedScreenSharerId]);
  // 参加者ごとの画面共有publication(未選択の相手も含め、購読切り替えの
  // ためにsetSubscribed()を呼べるよう保持しておく)。
  const screenSharePublicationsRef = useRef<
    Record<string, RemoteTrackPublication>
  >({});
  // 共有開始時点の最初の1フレームを静止画にしたプレビュー(dataURL)。
  // 選択して視聴を始めるまではこちらを表示し、選択後はライブ映像に切り替える。
  const [screenPreviewImages, setScreenPreviewImages] = useState<
    Record<string, string>
  >({});
  const [inCall, setInCall] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  // ビデオ通話の「今日の残り利用可能時間(秒)」。画面共有と全く同じ考え方
  // (null = 未取得中 or プランが無制限)。daily_usageテーブルのkind='video_call'を使う。
  const [videoCallRemainingSeconds, setVideoCallRemainingSeconds] =
    useState<number | null>(null);
  const videoCallRemainingRef = useRef<number | null>(null);
  useEffect(() => {
    videoCallRemainingRef.current = videoCallRemainingSeconds;
  }, [videoCallRemainingSeconds]);
  const [remoteCallStreams, setRemoteCallStreams] = useState<
    Record<string, MediaStream>
  >({});
  const [expandedMedia, setExpandedMedia] = useState<{
    peerId: string;
    kind: "screen" | "camera";
  } | null>(null);

  // ---- チャット(参加者ごとの1対1DM。全プラン共通の標準機能) ----
  type DmMessage = {
    id: string;
    senderUserId: string;
    isSelf: boolean;
    message: string;
    createdAt: string;
  };
  // 会話相手(認証済みユーザーの安定ID)ごとのスレッド。
  const [dmThreads, setDmThreads] = useState<Record<string, DmMessage[]>>({});
  // 現在サイドバーで開いているスレッドの相手。nullなら未選択。
  const [selectedPeerUserId, setSelectedPeerUserId] = useState<string | null>(
    null,
  );
  const selectedPeerUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedPeerUserIdRef.current = selectedPeerUserId;
  }, [selectedPeerUserId]);
  const [dmInput, setDmInput] = useState("");
  const [dmSending, setDmSending] = useState(false);
  const [dmError, setDmError] = useState<string | null>(null);
  // メッセージ一覧のスクロール制御用。dmForceScrollRefがtrueの間に
  // dmThreads(選択中の相手分)が更新されたら、次の描画後に一番下へ
  // スクロールする(自分の送信時・スレッドを開いた時・最下部付近での
  // 新着時)。falseのまま更新された場合は、最下部から離れて過去の
  // メッセージを見ている間の新着なので、自動スクロールせず矢印ボタンを出す。
  const dmScrollRef = useRef<HTMLDivElement | null>(null);
  const dmForceScrollRef = useRef(false);
  const [showDmScrollButton, setShowDmScrollButton] = useState(false);

  // ---- チャット:メッセージのコピー(右クリック/長押しメニュー) ----
  // 各メッセージ本文<p>へのref(Range操作でメッセージ全文選択・選択中の
  // 相手の要素特定に使う)。
  const dmBubbleRefs = useRef<Record<string, HTMLParagraphElement | null>>(
    {},
  );
  // 右クリック(PC)/長押し(スマホ)で開く「コピー・選択コピー」メニュー。
  // selectedTextはメニューを開いた時点で既に選択範囲があった場合の
  // その場コピー用(PCでドラッグ選択→右クリックのケース)。
  const [dmContextMenu, setDmContextMenu] = useState<{
    x: number;
    y: number;
    message: DmMessage;
    selectedText: string;
  } | null>(null);
  // 「選択コピー」を選んだが、その時点でまだ選択範囲が無かった場合に
  // 入る、範囲調整モード。対象メッセージ全文を初期選択した状態にし、
  // ユーザーがブラウザ標準の選択ハンドルでドラッグして範囲を調整できる
  // ようにする(独自の選択ハンドルは描画しない。LINEに寄せつつも
  // ブラウザ/OSネイティブの選択操作に乗せることで端末差異を吸収する)。
  const [dmSelectionModeMessageId, setDmSelectionModeMessageId] = useState<
    string | null
  >(null);
  // 選択範囲の直上に追従表示する「コピー」吹き出しの位置。
  const [dmSelectionBubblePos, setDmSelectionBubblePos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [dmCopyToast, setDmCopyToast] = useState(false);
  // スマホの長押し検出用(contextmenuイベントが発火しないiOS Safari向け)。
  const dmLongPressTimerRef = useRef<number | null>(null);
  const dmLongPressStartRef = useRef<{ x: number; y: number } | null>(null);
  // 相手ごとの未読フラグ。参加者一覧の該当行にマークを出し、
  // そのスレッドを開いたタイミングでfalseに戻す。
  const [unreadFromPeers, setUnreadFromPeers] = useState<
    Record<string, boolean>
  >({});
  // 管理者がプランを切り替えた際、このルームの全員を強制退出させるための
  // 通知("force-leave" broadcast)を受け取ったときに表示するメッセージ。
  // maxPeoplePerRoom等はサーバーから渡されたpropsのままなので、単純な
  // state resetでは新プランの制限に切り替わらない。そのため
  // window.location.reload()で全propsを取得し直す。
  const [forceLeaveMessage, setForceLeaveMessage] = useState<string | null>(
    null,
  );
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

  // 音声・映像・画面共有はLiveKit移行(Phase2〜4)でLiveKit経由に切り替えた
  // ため、自前PeerConnectionメッシュ関連の状態はPhase6で全て廃止した。
  const livekitRoomRef = useRef<LiveKitRoom | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
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
  // 向き(dir)が変わった瞬間だけ即座にplayers stateへ反映するための記録。
  // 位置の同期は0.2秒おきのままで十分だが、向き(スプライト画像)の切り替えは
  // それだと最大0.2秒の遅延に感じられてしまうため、変化した瞬間だけここで
  // 個別に同期する(移動中ずっと発火するわけではなく、向きが変わった時だけ)。
  const lastSyncedDirRef = useRef<PlayerState["dir"] | null>(null);

  const selfId = useRef<string>(randomId());
  const selfState = useRef<PlayerState | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  // DM送受信・オンライン人数カウントに使う、認証済みSupabaseユーザーの
  // 安定ID(selfId.currentはブラウザごとのランダムなゲストIDで別物)。
  // handleJoin()が組み立てるPlayerState.userIdに使うため、入室操作より
  // 前(マウント直後)に取得しておく必要がある。
  const authUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!cancelled) authUserIdRef.current = user?.id ?? null;
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  // playerIdごとにref callbackを1つだけ生成してキャッシュする。以前は
  // JSXのmap内でインライン関数を毎回生成しており、参加者数に比例して
  // 「状態更新のたびに全員分のrefが付け外しされる」無駄が発生していた
  // (memo化されたAvatar自体の再描画はスキップされるが、refの関数参照が
  // 毎回変わるとReactはref付け外しだけは必ず行うため)。
  const avatarRefCallbacks = useRef<
    Map<string, (handle: AvatarHandle | null) => void>
  >(new Map());
  const getAvatarRefCallback = useCallback((id: string) => {
    let cb = avatarRefCallbacks.current.get(id);
    if (!cb) {
      cb = (handle) => {
        if (handle) {
          avatarRefs.current.set(id, handle);
          // 生成された直後、Reactが把握している最新座標を初期位置として
          // 反映しておく(次のrAFフレームまで座標(0,0)に見えてしまうのを
          // 防ぐ)。playersRefから読むことで、キャッシュしたコールバックが
          // 生成時点の古いpの値を参照し続けてしまう問題を避ける。
          if (id === selfId.current && selfState.current) {
            handle.updatePosition(selfState.current.x, selfState.current.y);
          } else {
            const pos = peerPositionsRef.current.get(id);
            const fallback = playersRef.current[id];
            handle.updatePosition(
              pos?.currentX ?? fallback?.x ?? 0,
              pos?.currentY ?? fallback?.y ?? 0,
            );
          }
        } else {
          avatarRefs.current.delete(id);
          avatarRefCallbacks.current.delete(id);
        }
      };
      avatarRefCallbacks.current.set(id, cb);
    }
    return cb;
  }, []);
  // 相手の位置の補間(interpolation)用。broadcastで届いた最新位置をtargetとして持ち、
  // 毎フレーム現在位置(current)をtargetへ滑らかに近づけて描画する。
  const peerPositionsRef = useRef<
    Map<
      string,
      { currentX: number; currentY: number; targetX: number; targetY: number }
    >
  >(new Map());
  const viewportRef = useRef({ width: 0, height: 0 });

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

  useEffect(() => {
    if (!dmError) return;
    const timer = setTimeout(() => setDmError(null), 5000);
    return () => clearTimeout(timer);
  }, [dmError]);

  // playersの最新値をrefにも反映(effect外・イベントハンドラ外から
  // 最新状態を参照したい箇所で使う)
  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    remoteScreenStreamsRef.current = remoteScreenStreams;
  }, [remoteScreenStreams]);

  // ---- チャット:選択中の相手とのDMスレッドを読み込む ----
  // 参加者一覧でクリックされ、selectedPeerUserIdが変わるたびに、その相手との
  // 会話だけを取得する(相手を安定ID=auth.uid()で特定するため、リロード
  // しても同じ相手として履歴が引き継がれる)。
  useEffect(() => {
    if (!joined || !selectedPeerUserId) return;
    dmForceScrollRef.current = true;
    let cancelled = false;
    const myUserId = authUserIdRef.current;
    (async () => {
      // viewOnly(自分のアカウントを持つ人が他人の招待URLを一時閲覧中)の
      // 場合、通常のRLS(profiles.account_id経由)では対象ルームの
      // チャットが見えないため、招待トークンを検証するSECURITY DEFINER
      // 関数経由で取得する(list_rooms_by_invite_tokenと同じ考え方)。
      const { data, error } = viewOnlyInviteToken
        ? await supabase.rpc("list_chat_messages_by_invite_token", {
            token: viewOnlyInviteToken,
            target_room_id: roomId,
            peer_user_id: selectedPeerUserId,
          })
        : await supabase
            .from("chat_messages")
            .select("id, sender_user_id, message, created_at")
            .eq("room_id", roomId)
            .or(
              `and(sender_user_id.eq.${myUserId},recipient_user_id.eq.${selectedPeerUserId}),and(sender_user_id.eq.${selectedPeerUserId},recipient_user_id.eq.${myUserId})`,
            )
            .order("created_at", { ascending: false })
            .limit(50);
      if (cancelled) return;
      if (error) {
        // eslint-disable-next-line no-console
        console.error("チャット履歴の取得に失敗しました", error);
        return;
      }
      const rows = (data ?? []) as Array<{
        id: string;
        sender_user_id: string;
        message: string;
        created_at: string;
      }>;
      const messages: DmMessage[] = (
        viewOnlyInviteToken ? rows : rows.slice().reverse()
      ).map((row) => ({
        id: row.id,
        senderUserId: row.sender_user_id,
        isSelf: row.sender_user_id === myUserId,
        message: row.message,
        createdAt: row.created_at,
      }));
      dmForceScrollRef.current = true;
      setDmThreads((prev) => ({ ...prev, [selectedPeerUserId]: messages }));
      // スレッドを開いたので未読を消す
      setUnreadFromPeers((prev) =>
        prev[selectedPeerUserId] ? { ...prev, [selectedPeerUserId]: false } : prev,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [joined, roomId, supabase, viewOnlyInviteToken, selectedPeerUserId]);

  // ---- チャット:表示中のスレッドが更新されるたびにスクロール位置を制御する ----
  // dmForceScrollRef(送信直後・スレッドを開いた直後・最下部付近での新着)が
  // trueなら一番下へスクロールしてフラグを消費する。falseのまま更新された
  // (=最下部から離れて過去ログを見ている間の新着)場合は自動スクロールせず、
  // 下向き矢印ボタンを表示する。
  useEffect(() => {
    if (!selectedPeerUserId) return;
    const el = dmScrollRef.current;
    if (!el) return;
    if (dmForceScrollRef.current) {
      dmForceScrollRef.current = false;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
      setShowDmScrollButton(false);
    } else {
      setShowDmScrollButton(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeerUserId, dmThreads[selectedPeerUserId ?? ""]]);

  // ---- β版の同時接続数カウント用ハートビート ----
  // 全顧客合計のオンライン人数(online_sessions)を30秒おきに更新する。
  // 上限判定自体はアカウント作成時(app/plan/actions.ts)側で行うため、
  // ここでは自分が「オンライン」であることを記録するだけでよい。
  useEffect(() => {
    if (!joined) return;
    let cancelled = false;
    const heartbeat = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;
      const { error } = await supabase
        .from("online_sessions")
        .upsert({ user_id: user.id, last_seen_at: new Date().toISOString() });
      if (error) {
        // eslint-disable-next-line no-console
        console.error("オンライン人数の記録に失敗しました", error);
      }
    };
    heartbeat();
    const interval = setInterval(heartbeat, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [joined, supabase]);

  const sendDmMessage = useCallback(async () => {
    const trimmed = dmInput.trim();
    const peerUserId = selectedPeerUserId;
    if (!trimmed || !selfState.current || !peerUserId || dmSending) return;
    const senderName = selfState.current.name;
    const myUserId = authUserIdRef.current;
    setDmInput("");
    setDmError(null);
    setDmSending(true);
    try {
      // viewOnlyの場合は通常のRLSでINSERTが拒否されるため、招待トークンを
      // 検証するSECURITY DEFINER関数(send_chat_message_by_invite_token)
      // 経由で送信する。
      const { data, error } = viewOnlyInviteToken
        ? await (async () => {
            const res = await supabase.rpc(
              "send_chat_message_by_invite_token",
              {
                token: viewOnlyInviteToken,
                target_room_id: roomId,
                recipient_user_id: peerUserId,
                sender_name: senderName,
                message: trimmed,
              },
            );
            return { data: res.data?.[0] ?? null, error: res.error };
          })()
        : await supabase
            .from("chat_messages")
            .insert({
              room_id: roomId,
              sender_user_id: myUserId,
              recipient_user_id: peerUserId,
              sender_name: senderName,
              message: trimmed,
            })
            .select("id, created_at")
            .single();
      if (error || !data || !myUserId) {
        // eslint-disable-next-line no-console
        console.error("チャットメッセージの送信に失敗しました", error);
        setDmInput(trimmed);
        setDmError("送信に失敗しました。時間をおいて再度お試しください。");
        return;
      }
      dmForceScrollRef.current = true;
      setDmThreads((prev) => ({
        ...prev,
        [peerUserId]: [
          ...(prev[peerUserId] ?? []),
          {
            id: data.id,
            senderUserId: myUserId,
            isSelf: true,
            message: trimmed,
            createdAt: data.created_at,
          },
        ],
      }));
      channelRef.current?.send({
        type: "broadcast",
        event: "dm",
        payload: {
          id: data.id,
          senderUserId: myUserId,
          recipientUserId: peerUserId,
          senderName,
          message: trimmed,
          createdAt: data.created_at,
        },
      });
    } finally {
      setDmSending(false);
    }
  }, [dmInput, dmSending, roomId, selectedPeerUserId, supabase, viewOnlyInviteToken]);

  // 指定テキストをクリップボードへコピーし、一時的にトーストで知らせる。
  const copyDmText = useCallback((text: string) => {
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setDmCopyToast(true);
        setTimeout(() => setDmCopyToast(false), 1500);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("クリップボードへのコピーに失敗しました", err);
      });
  }, []);

  const closeDmCopyUi = useCallback(() => {
    setDmContextMenu(null);
    setDmSelectionModeMessageId(null);
  }, []);

  const clearDmLongPressTimer = useCallback(() => {
    if (dmLongPressTimerRef.current !== null) {
      window.clearTimeout(dmLongPressTimerRef.current);
      dmLongPressTimerRef.current = null;
    }
  }, []);

  // 右クリック/長押しの発生位置に、対象メッセージのコピーメニューを開く。
  // 既にその場でテキストが選択されていれば(PCでドラッグ選択→右クリック)
  // その選択内容を「選択コピー」のその場コピー用として保持する。
  const openDmContextMenu = useCallback(
    (x: number, y: number, message: DmMessage) => {
      const sel = window.getSelection();
      const bubbleEl = dmBubbleRefs.current[message.id];
      const selectedText =
        sel && !sel.isCollapsed && bubbleEl && sel.anchorNode
          ? bubbleEl.contains(sel.anchorNode)
            ? sel.toString()
            : ""
          : "";
      setDmContextMenu({ x, y, message, selectedText });
    },
    [],
  );

  // タッチ由来の操作が進行中かどうか(contextmenuイベントが本物の右クリック
  // なのか、Android等が長押しで自動発火させたものなのかを区別するために使う)。
  const dmTouchActiveRef = useRef(false);

  const handleDmContextMenu = useCallback(
    (e: React.MouseEvent, m: DmMessage) => {
      if (dmTouchActiveRef.current) {
        // タッチ由来のcontextmenu。ここでpreventDefault()すると、長押しに
        // 連動してブラウザが進めているネイティブのテキスト選択(選択
        // ハンドル)まで巻き込んで中断してしまうことがある(Android/
        // Firefox等で、contextmenuでのpreventDefault()がtouchcancelを
        // 誘発することが報告されている既知の挙動)。独自メニューは
        // touchstart側の長押しタイマーで別途表示するため、ここでは
        // 何もせずネイティブの選択動作をそのまま進行させる。
        return;
      }
      e.preventDefault();
      clearDmLongPressTimer();
      openDmContextMenu(e.clientX, e.clientY, m);
    },
    [openDmContextMenu, clearDmLongPressTimer],
  );

  // iOS Safariはテキスト上の長押しでcontextmenuイベントが発火しないため、
  // touchstart/touchmove/touchendから自前で長押し(500ms・移動量10px以内)を
  // 検出する(Android等でcontextmenuも発火した場合は上のハンドラ側で
  // 無視されるので、こちらのメニュー表示だけが有効になる)。
  const handleDmTouchStart = useCallback(
    (e: React.TouchEvent, m: DmMessage) => {
      dmTouchActiveRef.current = true;
      const touch = e.touches[0];
      if (!touch) return;
      dmLongPressStartRef.current = { x: touch.clientX, y: touch.clientY };
      dmLongPressTimerRef.current = window.setTimeout(() => {
        dmLongPressTimerRef.current = null;
        openDmContextMenu(touch.clientX, touch.clientY, m);
      }, 500);
    },
    [openDmContextMenu],
  );

  const handleDmTouchMove = useCallback((e: React.TouchEvent) => {
    const start = dmLongPressStartRef.current;
    const touch = e.touches[0];
    if (!start || !touch || dmLongPressTimerRef.current === null) return;
    if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) {
      clearDmLongPressTimer();
    }
  }, [clearDmLongPressTimer]);

  const handleDmTouchEnd = useCallback(() => {
    clearDmLongPressTimer();
    // このタッチ操作の直後に発火しうるcontextmenuイベントを「タッチ由来」と
    // 判定できるよう、フラグを少し遅らせてから戻す。
    window.setTimeout(() => {
      dmTouchActiveRef.current = false;
    }, 100);
  }, [clearDmLongPressTimer]);

  // 選択コピーモード:対象メッセージ全文を初期選択し、選択範囲の変化を
  // 監視して直上に「コピー」吹き出しを追従表示する。
  useEffect(() => {
    if (!dmSelectionModeMessageId) return;
    const bubbleEl = dmBubbleRefs.current[dmSelectionModeMessageId];
    if (!bubbleEl) return;

    const updateBubblePos = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setDmSelectionBubblePos(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setDmSelectionBubblePos(null);
        return;
      }
      setDmSelectionBubblePos({ x: rect.left + rect.width / 2, y: rect.top });
    };

    const range = document.createRange();
    range.selectNodeContents(bubbleEl);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    updateBubblePos();

    document.addEventListener("selectionchange", updateBubblePos);
    return () => {
      document.removeEventListener("selectionchange", updateBubblePos);
      window.getSelection()?.removeAllRanges();
      setDmSelectionBubblePos(null);
    };
  }, [dmSelectionModeMessageId]);

  // スレッド切り替え・Escapeキーでコピーメニュー/選択モードを閉じる。
  useEffect(() => {
    closeDmCopyUi();
  }, [selectedPeerUserId, closeDmCopyUi]);

  useEffect(() => {
    if (!dmContextMenu && !dmSelectionModeMessageId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDmCopyUi();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dmContextMenu, dmSelectionModeMessageId, closeDmCopyUi]);

  // ---- LiveKit接続(音声:Phase2、カメラ:Phase3、画面共有:Phase4)----
  // Room参加時のみToken発行APIを叩き、LiveKitのRoomに接続する。近接方式を
  // 維持するため autoSubscribe: false で接続し、実際の購読は下の
  // 「eligiblePeerIdsに応じて購読を切り替える」effectとTrackPublished
  // イベントで個別に制御する。
  useEffect(() => {
    if (!joined) return;
    let cancelled = false;
    const room = new LiveKitRoom({ adaptiveStream: true, dynacast: true });
    livekitRoomRef.current = room;

    const isManagedKind = (publication: RemoteTrackPublication) =>
      publication.kind === Track.Kind.Audio ||
      publication.source === Track.Source.Camera ||
      publication.source === Track.Source.ScreenShare;

    // Audio(近接音声通話)・Camera(ビデオ通話)はこれまで通りeligiblePeerIds
    // (近接判定)に応じて自動購読する。ScreenShareだけは対象外とし、
    // 「選択視聴」effect(selectedScreenSharerId)側で個別に制御する。
    const applySubscription = (
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (
        publication.kind !== Track.Kind.Audio &&
        publication.source !== Track.Source.Camera
      ) {
        return;
      }
      publication.setSubscribed(
        eligiblePeerIdsRef.current.includes(participant.identity),
      );
    };

    const clearScreenShare = (identity: string) => {
      delete screenSharePublicationsRef.current[identity];
      setScreenPreviewImages((prev) => {
        if (!(identity in prev)) return prev;
        const next = { ...prev };
        delete next[identity];
        return next;
      });
      if (selectedScreenSharerIdRef.current === identity) {
        setSelectedScreenSharerId(null);
      }
    };

    const setterFor = (kind: Track.Kind, source: Track.Source) => {
      if (kind === Track.Kind.Audio) return setRemoteStreams;
      if (source === Track.Source.ScreenShare) return setRemoteScreenStreams;
      return setRemoteCallStreams;
    };

    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub, participant) => {
        if (!isManagedKind(pub)) return;
        const stream = new MediaStream([track.mediaStreamTrack]);
        setterFor(track.kind, pub.source)((prev) => ({
          ...prev,
          [participant.identity]: stream,
        }));
      })
      .on(RoomEvent.TrackUnsubscribed, (track, pub, participant) => {
        setterFor(track.kind, pub.source)((prev) => {
          if (!(participant.identity in prev)) return prev;
          const next = { ...prev };
          delete next[participant.identity];
          return next;
        });
      })
      .on(RoomEvent.TrackPublished, (publication, participant) => {
        if (publication.source === Track.Source.ScreenShare) {
          screenSharePublicationsRef.current[participant.identity] =
            publication;
          // 既にこの相手を選択中(共有の終了→再開など)であれば即座に再購読する
          if (selectedScreenSharerIdRef.current === participant.identity) {
            publication.setSubscribed(true);
          }
          return;
        }
        applySubscription(publication, participant);
      })
      .on(RoomEvent.TrackUnpublished, (publication, participant) => {
        if (publication.source === Track.Source.ScreenShare) {
          clearScreenShare(participant.identity);
        }
      })
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        [setRemoteStreams, setRemoteCallStreams, setRemoteScreenStreams].forEach(
          (setter) => {
            setter((prev) => {
              if (!(participant.identity in prev)) return prev;
              const next = { ...prev };
              delete next[participant.identity];
              return next;
            });
          },
        );
        clearScreenShare(participant.identity);
      });

    (async () => {
      try {
        const res = await fetch("/api/livekit-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId,
            identity: selfId.current,
            inviteToken: viewOnlyInviteToken,
          }),
        });
        if (!res.ok) throw new Error("token取得失敗");
        const { token, url } = await res.json();
        if (cancelled) return;
        await room.connect(url, token, { autoSubscribe: false });
      } catch {
        if (!cancelled) {
          setMicError(
            "音声サーバーへの接続に失敗しました。しばらくしてから再度お試しください。",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      room.disconnect();
      if (livekitRoomRef.current === room) livekitRoomRef.current = null;
      screenSharePublicationsRef.current = {};
      setSelectedScreenSharerId(null);
      setScreenPreviewImages({});
    };
  }, [joined, roomId, viewOnlyInviteToken]);

  // ---- 画面共有の選択視聴:選んだ相手のpublicationだけを購読する ----
  // 同時に複数を視聴することはできないため、選択が変わるたびに「選ばれて
  // いる相手だけsubscribed=true、それ以外は全員false」を毎回付け直す。
  useEffect(() => {
    Object.entries(screenSharePublicationsRef.current).forEach(
      ([identity, publication]) => {
        publication.setSubscribed(identity === selectedScreenSharerId);
      },
    );
  }, [selectedScreenSharerId]);

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
  // マイク/ビデオ通話/画面共有のON/OFF表示状態も明示的にリセットする。
  // クリーンアップ側はストリーム(実体)を止めるだけでこれらのReact
  // stateまでは戻さないため、ここでリセットしないと次のルームでも
  // ボタンがONのまま(かつストリームが無いのでOFFに戻せない)表示に
  // なってしまっていた。
  const handleLeaveRoom = useCallback(() => {
    setJoined(false);
    setPlayers({});
    setRoomSelected(false);
    setMicEnabled(false);
    setMicError(null);
    setScreenSharing(false);
    setInCall(false);
    setCallError(null);
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
      userId: authUserIdRef.current ?? undefined,
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
            kind: z.kind ?? "meeting",
          }),
        );
        setMeetingZones(loaded);
      }
    })();
  }, [joined, roomId, rooms, supabase]);

  // ---- 画面共有 ----
  // LiveKit移行Phase4でLiveKit経由に切り替え。screenStreamRefは自分の
  // プレビュー表示専用(LiveKitトラックをラップしたMediaStream)。
  const stopScreenShare = useCallback(async () => {
    screenStreamRef.current = null;
    setScreenSharing(false);
    if (selfState.current) {
      selfState.current.sharingScreen = false;
      channelRef.current?.track(selfState.current);
    }
    const room = livekitRoomRef.current;
    if (room) {
      try {
        await room.localParticipant.setScreenShareEnabled(false);
      } catch {
        // 既に切れている場合などは無視
      }
    }
  }, []);

  const startScreenShare = useCallback(async () => {
    setShareError(null);

    if (
      screenShareRemainingRef.current !== null &&
      screenShareRemainingRef.current <= 0
    ) {
      setShareError(
        "本日の画面共有可能時間の上限に達しています(4:00にリセットされます)。",
      );
      return;
    }

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

    const room = livekitRoomRef.current;
    if (!room) {
      setShareError(
        "音声サーバーに接続していません。少し待ってから再度お試しください。",
      );
      return;
    }

    try {
      const publication = await room.localParticipant.setScreenShareEnabled(true);
      const track = publication?.track;
      if (!track) throw new Error("画面共有トラックを取得できませんでした");
      screenStreamRef.current = new MediaStream([track.mediaStreamTrack]);
      setScreenSharing(true);

      if (selfState.current) {
        selfState.current.sharingScreen = true;
        channelRef.current?.track(selfState.current);
      }

      // ブラウザ標準の「共有を停止」ボタンが押された場合にも終了処理を行う
      track.mediaStreamTrack.addEventListener("ended", () => {
        stopScreenShare();
      });

      // 選択前プレビュー用に、共有開始時点の最初の1フレームだけを
      // 静止画として他の参加者へ配信する(ライブ映像は選択されるまで
      // 誰にも購読させないため、これが無いと共有中かどうかしか分からない)。
      captureFirstFrame(track.mediaStreamTrack).then((dataUrl) => {
        if (dataUrl && selfState.current) {
          channelRef.current?.send({
            type: "broadcast",
            event: "screen-preview",
            payload: { id: selfState.current.id, dataUrl },
          });
        }
      });
    } catch {
      // 選択画面でキャンセルした場合などはここに来る。エラー扱いにはしない。
    }
  }, [stopScreenShare]);

  const toggleScreenShare = useCallback(() => {
    if (screenSharing) {
      stopScreenShare();
    } else {
      startScreenShare();
    }
  }, [screenSharing, stopScreenShare, startScreenShare]);

  // ---- ビデオ通話(LiveKit移行Phase3でLiveKit経由に切り替え) ----
  // カメラの取得・送信はlivekitRoomRef(LiveKit)側が担う。cameraStreamRefは
  // 自分のプレビュー表示用に、LiveKitが発行したトラックをラップした
  // MediaStreamを保持するだけに用途を変えた(自前メッシュへは送らない)。
  const stopVideoCall = useCallback(async () => {
    cameraStreamRef.current = null;
    setInCall(false);
    if (selfState.current) {
      selfState.current.inCall = false;
      channelRef.current?.track(selfState.current);
    }
    const room = livekitRoomRef.current;
    if (room) {
      try {
        await room.localParticipant.setCameraEnabled(false);
      } catch {
        // 既に切れている場合などは無視
      }
    }
  }, []);

  const startVideoCall = useCallback(async () => {
    setCallError(null);
    if (
      videoCallRemainingRef.current !== null &&
      videoCallRemainingRef.current <= 0
    ) {
      setCallError(
        "本日のビデオ通話可能時間の上限に達しています(4:00にリセットされます)。",
      );
      return;
    }
    const room = livekitRoomRef.current;
    if (!room) {
      setCallError(
        "音声サーバーに接続していません。少し待ってから再度お試しください。",
      );
      return;
    }
    try {
      // ビデオ通話のプレビューは横幅128px程度の小窓でしか表示しないため、
      // 発信側のキャプチャ・エンコード自体を低解像度・低ビットレートに
      // 抑え、通信量とCPU負荷を削減する(画面共有は文字が読めることが
      // 重要なため対象外。こちらはsetScreenShareEnabled側で従来通り)。
      // 低解像度1層のみで十分なためsimulcastも無効化する。
      const publication = await room.localParticipant.setCameraEnabled(
        true,
        { resolution: { width: 160, height: 120, frameRate: 15 } },
        {
          videoEncoding: { maxBitrate: 150_000, maxFramerate: 15 },
          simulcast: false,
        },
      );
      const track = publication?.track;
      if (!track) throw new Error("カメラトラックを取得できませんでした");
      cameraStreamRef.current = new MediaStream([track.mediaStreamTrack]);
      setInCall(true);

      if (selfState.current) {
        selfState.current.inCall = true;
        channelRef.current?.track(selfState.current);
      }

      track.mediaStreamTrack.addEventListener("ended", () => {
        stopVideoCall();
      });
    } catch {
      setCallError(
        "カメラを使用できませんでした。ブラウザのカメラ許可設定を確認してください。",
      );
    }
  }, [stopVideoCall]);

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
                current.status !== p.status ||
                current.message !== p.message ||
                current.showMessage !== p.showMessage
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
                  message: p.message,
                  showMessage: p.showMessage,
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
              current.showMessage !== p.showMessage ||
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
        .on("broadcast", { event: "layout-update" }, ({ payload }) => {
          const { obstacles: newObstacles, meetingZones: newZones } =
            payload as {
              obstacles?: Obstacle[];
              meetingZones?: MeetingZone[];
            };
          if (newObstacles) setObstacles(newObstacles);
          if (newZones) setMeetingZones(newZones);
        })
        .on("broadcast", { event: "screen-preview" }, ({ payload }) => {
          const { id, dataUrl } = payload as { id: string; dataUrl: string };
          if (id === selfId.current) return;
          setScreenPreviewImages((prev) => ({ ...prev, [id]: dataUrl }));
        })
        .on("broadcast", { event: "dm" }, ({ payload }) => {
          const msg = payload as {
            id: string;
            senderUserId: string;
            recipientUserId: string;
            senderName: string;
            message: string;
            createdAt: string;
          };
          const myUserId = authUserIdRef.current;
          // 自分が送った分は既にローカルへ追加済み。自分宛てでなければ
          // (別の相手同士のDMは同じルームチャンネルに乗って届くが自分には
          // 関係ないので)無視する。
          if (
            msg.senderUserId === myUserId ||
            msg.recipientUserId !== myUserId
          ) {
            return;
          }
          // 表示中のスレッド宛ての新着なら、届いた時点でのスクロール位置を
          // 見て「既に最下部付近にいたか」を判定し、force-scrollの要否を
          // 決める(state更新・再描画より前に、更新前の位置を見る必要がある)。
          if (selectedPeerUserIdRef.current === msg.senderUserId) {
            const el = dmScrollRef.current;
            dmForceScrollRef.current = el ? isDmScrollNearBottom(el) : true;
          }
          setDmThreads((prev) => ({
            ...prev,
            [msg.senderUserId]: [
              ...(prev[msg.senderUserId] ?? []),
              {
                id: msg.id,
                senderUserId: msg.senderUserId,
                isSelf: false,
                message: msg.message,
                createdAt: msg.createdAt,
              },
            ],
          }));
          if (selectedPeerUserIdRef.current !== msg.senderUserId) {
            setUnreadFromPeers((prev) => ({
              ...prev,
              [msg.senderUserId]: true,
            }));
          }
        })
        .on("broadcast", { event: "force-leave" }, () => {
          setForceLeaveMessage(
            "管理者がプランを変更したため、まもなく退出します...",
          );
          setTimeout(() => window.location.reload(), 1500);
        })
        // webrtc-offer/webrtc-answer/webrtc-iceの自前シグナリングは
        // LiveKit移行(Phase2〜4)により不要になったためPhase6で削除した。
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
  }, [joined, roomId, maxPeoplePerRoom]);

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
      // 自前WebRTC接続の健全性チェックは、音声・映像・画面共有が全て
      // LiveKit移行(Phase2〜4)したことでPhase6で不要になった
      // (再接続はLiveKitクライアントSDKが自動的に行う)。
    }, 2500);

    return () => clearInterval(interval);
  }, [joined]);

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

          if (self.dir !== lastSyncedDirRef.current) {
            lastSyncedDirRef.current = self.dir;
            const dir = self.dir;
            setPlayers((prev) => {
              const current = prev[self.id];
              if (!current || current.dir === dir) return prev;
              return { ...prev, [self.id]: { ...current, dir } };
            });
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

          // 音声・カメラ・画面共有をすべてLiveKit移行した(Phase2〜4)ことで、
          // 「近づいた瞬間にPeerConnectionを作る/離れたら切る」という
          // 自前メッシュ用の即時接続処理はもう不要になった(LiveKitは
          // Room参加時に確立済みの接続に対してsetSubscribedを呼ぶだけで
          // 済み、ICE/DTLSのやり直しが発生しないため、この毎フレーム
          // チェックほどの即時性を保ったまま軽量に行える。実際の購読
          // 切り替えは下のeligibleKey依存effectで行っている)。
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
  }, [joined]);

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

  // ---- マイクのON/OFF切り替え(LiveKit移行Phase2) ----
  // マイクの取得・送信はlivekitRoomRef(LiveKit)側が担う。ここでは
  // setMicrophoneEnabledの呼び出しとUI状態の同期のみ行う。
  const toggleMic = useCallback(async () => {
    setMicError(null);
    const room = livekitRoomRef.current;
    if (!room) {
      setMicError(
        "音声サーバーに接続していません。少し待ってから再度お試しください。",
      );
      return;
    }
    try {
      const next = !micEnabled;
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicEnabled(next);
      if (selfState.current) {
        selfState.current.micOn = next;
        channelRef.current?.track(selfState.current);
      }
    } catch {
      setMicError(
        "マイクを使用できませんでした。ブラウザのアドレスバー付近のマイク許可設定を確認してください。",
      );
    }
  }, [micEnabled]);

  // 退室時、プレビュー表示用のref参照をリセットする。実体(マイク・カメラ・
  // 画面共有のトラック停止)はLiveKit側のroom.disconnect()が担うため、
  // ここで直接track.stop()は呼ばない(LiveKit側のpublication状態と
  // 食い違うため)。
  useEffect(() => {
    if (!joined) return;
    return () => {
      screenStreamRef.current = null;
      cameraStreamRef.current = null;
    };
  }, [joined]);

  // 距離判定に使う値(x, y, meetingZoneId)だけを拾った軽量な文字列。
  // players全体を依存配列にすると、名前・ステータス・マイク状態など
  // 距離と無関係な変化(移動中は方向転換のたびにも発生する)でまで
  // 全員分の距離計算が再実行されてしまっていたため、実際に距離判定へ
  // 影響する値だけを比較対象にする。
  const positionSignature = useMemo(
    () =>
      Object.values(players)
        .map((p) => `${p.id}:${p.x}:${p.y}:${p.meetingZoneId ?? ""}`)
        .join("|"),
    [players],
  );

  // ---- 音声・映像・画面共有:LiveKit購読対象を計算 ----
  // 条件は「同じミーティングエリアに二人ともいる」か「一定距離より近い(近接ボイスチャット)」。
  // 距離判定には余裕(ヒステリシス)を持たせ、境界線上での購読ON/OFFの
  // チラつきを防いでいる。特に「前回すでに対象だった相手」は、少し動いた
  // だけで音声通話や画面共有が切れてしまわないよう、対象から外れる距離を
  // 大きく広げている(実際にその場を離れるまでは繋がったままにする)。
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
        const wasEligible = eligiblePeerIdsRef.current.includes(p.id);
        const threshold = wasEligible
          ? PROXIMITY_RADIUS + 20
          : PROXIMITY_RADIUS;
        return dist <= threshold;
      })
      .map((p) => p.id)
      .sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionSignature]);
  const eligibleKey = eligiblePeerIds.join(",");

  useEffect(() => {
    eligiblePeerIdsRef.current = eligiblePeerIds;
  }, [eligiblePeerIds]);

  // ---- LiveKit(音声・カメラ・画面共有):近接方式に合わせて購読を切り替える ----
  // 接続そのものはLiveKitのRoom(SFU)へ1本だけなので、ここでは相手ごとの
  // トラック購読(setSubscribed)をオン/オフするだけで済む
  // (以前のPeerConnectionメッシュのような接続の作成/破棄は不要)。
  useEffect(() => {
    if (!joined) return;
    const room = livekitRoomRef.current;
    if (!room) return;
    const eligibleSet = new Set(eligiblePeerIds);
    room.remoteParticipants.forEach((participant) => {
      const shouldSubscribe = eligibleSet.has(participant.identity);
      participant.audioTrackPublications.forEach((pub) => {
        if (pub.isSubscribed !== shouldSubscribe) {
          pub.setSubscribed(shouldSubscribe);
        }
      });
      participant.videoTrackPublications.forEach((pub) => {
        // ScreenShareは近接判定ではなく「選択視聴」effectが個別に制御する
        // ため、ここでは対象外とする。
        if (pub.source !== Track.Source.Camera) return;
        if (pub.isSubscribed !== shouldSubscribe) {
          pub.setSubscribed(shouldSubscribe);
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleKey, joined]);

  // 選択中の相手が画面共有をやめた・近接範囲外に出た場合は選択を解除する
  useEffect(() => {
    if (!selectedScreenSharerId) return;
    const stillSharingNearby =
      eligiblePeerIds.includes(selectedScreenSharerId) &&
      players[selectedScreenSharerId]?.sharingScreen;
    if (!stillSharingNearby) {
      setSelectedScreenSharerId(null);
    }
  }, [selectedScreenSharerId, eligiblePeerIds, players]);

  // ---- 誰かの画面共有を視聴中かどうかをpresenceに反映する ----
  // マスター画面の「画面共有視聴中」人数集計のために使う。実際に映像を
  // 受信できているか(remoteScreenStreamsに実体があるか)まで見て判定する。
  const isWatchingScreenRef = useRef(false);
  useEffect(() => {
    if (!joined) return;
    const eligibleSet = new Set(eligiblePeerIds);
    const isWatching = Object.values(players).some(
      (p) =>
        p.id !== selfId.current &&
        p.sharingScreen &&
        eligibleSet.has(p.id) &&
        !!remoteScreenStreams[p.id],
    );
    isWatchingScreenRef.current = isWatching;
    if (selfState.current && selfState.current.watchingScreen !== isWatching) {
      selfState.current.watchingScreen = isWatching;
      channelRef.current?.track(selfState.current);
    }
  }, [players, eligiblePeerIds, remoteScreenStreams, joined]);

  // ---- 画面共有の視聴累積時間をDBへ記録する(マスター画面の集計用) ----
  // 30秒おきに、その時点で視聴中であれば30秒分を加算する(視聴者ごとに
  // クライアントがそれぞれ加算するため、5人が同時に見ていれば5人分×時間が
  // 積み上がる)。短時間の視聴の端数(30秒未満)は切り捨てられる。
  useEffect(() => {
    if (!joined) return;
    const interval = setInterval(() => {
      if (!isWatchingScreenRef.current) return;
      supabase.rpc("increment_screen_watch_seconds", { seconds: 30 }).then(
        ({ error }) => {
          if (error) {
            // eslint-disable-next-line no-console
            console.error("画面共有視聴累積時間の記録に失敗しました", error);
          }
        },
      );
    }, 30000);
    return () => clearInterval(interval);
  }, [joined, supabase]);

  // ---- 画面共有の「1日あたり利用時間」上限管理 ----
  // プランが無制限(null)の場合は、そもそも上限管理自体が不要なので
  // DBへの読み書きを一切行わない(remainingSecondsはnullのまま=無制限扱い)。
  // 有限の場合、入室時に本日ここまでの使用済み秒数を取得し、プラン上限
  // との差分を残り時間として保持する(4:00リセット・日付キーの算出は
  // DB側で行う)。
  const screenShareDailyLimitSeconds =
    screenShareDailyMinutes === null ? null : screenShareDailyMinutes * 60;
  useEffect(() => {
    if (!joined || screenShareDailyLimitSeconds === null) return;
    let cancelled = false;
    supabase
      .rpc("get_daily_usage_used_seconds", { p_kind: "screen_share" })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // eslint-disable-next-line no-console
          console.error("画面共有利用時間の取得に失敗しました", error);
          return;
        }
        setScreenShareRemainingSeconds(
          Math.max(0, screenShareDailyLimitSeconds - (data ?? 0)),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [joined, supabase, screenShareDailyLimitSeconds]);

  // 共有中は30秒おきに実利用時間をDBへ加算し、返ってきた本日合計から
  // 残り時間を再計算する(サーバー側の値を正として同期する)。残り時間が
  // 尽きたら共有を強制終了する。
  useEffect(() => {
    if (!joined || screenShareDailyLimitSeconds === null) return;
    const interval = setInterval(() => {
      if (!screenSharing) return;
      supabase
        .rpc("increment_daily_usage_seconds", {
          p_kind: "screen_share",
          seconds: 30,
        })
        .then(({ data, error }) => {
          if (error) {
            // eslint-disable-next-line no-console
            console.error("画面共有利用時間の記録に失敗しました", error);
            return;
          }
          const remaining = Math.max(
            0,
            screenShareDailyLimitSeconds - (data ?? 0),
          );
          setScreenShareRemainingSeconds(remaining);
          if (remaining <= 0) {
            setShareError(
              "本日の画面共有可能時間の上限に達したため、共有を終了しました。",
            );
            stopScreenShare();
          }
        });
    }, 30000);
    return () => clearInterval(interval);
  }, [
    joined,
    screenSharing,
    supabase,
    screenShareDailyLimitSeconds,
    stopScreenShare,
  ]);

  // 共有中は表示用に1秒おきでローカルカウントダウンする(サーバー同期は
  // 上の30秒ハートビートに任せ、ここは見た目の滑らかさのためだけの近似値)。
  useEffect(() => {
    if (!screenSharing || screenShareDailyLimitSeconds === null) return;
    const interval = setInterval(() => {
      setScreenShareRemainingSeconds((prev) =>
        prev === null ? prev : Math.max(0, prev - 1),
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [screenSharing, screenShareDailyLimitSeconds]);

  // ---- ビデオ通話の「1日あたり利用時間」上限管理(画面共有と同じ仕組み) ----
  const videoCallDailyLimitSeconds =
    videoCallDailyMinutes === null ? null : videoCallDailyMinutes * 60;
  useEffect(() => {
    if (!joined || videoCallDailyLimitSeconds === null) return;
    let cancelled = false;
    supabase
      .rpc("get_daily_usage_used_seconds", { p_kind: "video_call" })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // eslint-disable-next-line no-console
          console.error("ビデオ通話利用時間の取得に失敗しました", error);
          return;
        }
        setVideoCallRemainingSeconds(
          Math.max(0, videoCallDailyLimitSeconds - (data ?? 0)),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [joined, supabase, videoCallDailyLimitSeconds]);

  useEffect(() => {
    if (!joined || videoCallDailyLimitSeconds === null) return;
    const interval = setInterval(() => {
      if (!inCall) return;
      supabase
        .rpc("increment_daily_usage_seconds", {
          p_kind: "video_call",
          seconds: 30,
        })
        .then(({ data, error }) => {
          if (error) {
            // eslint-disable-next-line no-console
            console.error("ビデオ通話利用時間の記録に失敗しました", error);
            return;
          }
          const remaining = Math.max(
            0,
            videoCallDailyLimitSeconds - (data ?? 0),
          );
          setVideoCallRemainingSeconds(remaining);
          if (remaining <= 0) {
            setCallError(
              "本日のビデオ通話可能時間の上限に達したため、通話を終了しました。",
            );
            stopVideoCall();
          }
        });
    }, 30000);
    return () => clearInterval(interval);
  }, [joined, inCall, supabase, videoCallDailyLimitSeconds, stopVideoCall]);

  useEffect(() => {
    if (!inCall || videoCallDailyLimitSeconds === null) return;
    const interval = setInterval(() => {
      setVideoCallRemainingSeconds((prev) =>
        prev === null ? prev : Math.max(0, prev - 1),
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [inCall, videoCallDailyLimitSeconds]);

  // 退室時、位置補間用の記録とAvatar DOM参照をクリアする。音声・映像・
  // 画面共有はLiveKit側のroom.disconnect()が担当するが、念のため
  // remoteStreams/remoteCallStreams/remoteScreenStreamsもここで
  // 確実にリセットしておく。
  useEffect(() => {
    if (!joined) return;
    return () => {
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

  // ---- 入室後の設定変更(名前・アバター画像・在席ステータス・吹き出し) ----
  const openSettings = useCallback(() => {
    setSettingsNameInput(selfState.current?.name ?? "");
    setSettingsAvatar(selfState.current?.avatarImage ?? AVATAR_IMAGES[0]);
    setSettingsStatus(selfState.current?.status ?? "available");
    setSettingsMessageInput(selfState.current?.message ?? "");
    setSettingsShowMessage(selfState.current?.showMessage ?? false);
    setSettingsOpen(true);
  }, []);

  const saveSettings = useCallback(() => {
    if (!selfState.current) return;
    const name =
      settingsNameInput.trim() || `ゲスト${selfId.current.slice(0, 4)}`;
    selfState.current.name = name;
    selfState.current.avatarImage = settingsAvatar;
    selfState.current.status = settingsStatus;
    selfState.current.message = settingsMessageInput
      .trim()
      .slice(0, MESSAGE_MAX_LENGTH);
    selfState.current.showMessage = settingsShowMessage;
    const updated = selfState.current;
    setPlayers((prev) => ({ ...prev, [updated.id]: { ...updated } }));
    channelRef.current?.track(updated);
    setSettingsOpen(false);
  }, [
    settingsNameInput,
    settingsAvatar,
    settingsStatus,
    settingsMessageInput,
    settingsShowMessage,
  ]);

  // ルーム選択画面にいる間だけ、各ルームのRealtimeチャンネルにpresence
  // 観測者として接続し、オンライン人数を取得する(入室後は不要なので
  // roomSelectedになったら購読解除する)。
  useEffect(() => {
    if (roomSelected || rooms.length === 0) return;
    const channels = rooms.map((room) => {
      const channel = supabase.channel(`avatar-room-${room.id}`, {
        config: { presence: { key: `observer-${randomId()}` } },
      });
      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState();
          setRoomOnlineCounts((prev) => ({
            ...prev,
            [room.id]: Object.keys(state).length,
          }));
        })
        .subscribe();
      return channel;
    });

    return () => {
      channels.forEach((channel) => supabase.removeChannel(channel));
    };
  }, [roomSelected, rooms, supabase]);

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
                <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                  <p className="truncate text-xs font-semibold text-slate-700">
                    {room.name}
                  </p>
                  <span className="shrink-0 text-[10px] font-semibold text-slate-500">
                    {roomOnlineCounts[room.id] ?? 0}/{maxPeoplePerRoom}名
                  </span>
                </div>
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

          <LogoutButton
            className="mt-2 w-full rounded-lg bg-red-50 py-2 text-sm font-semibold text-red-600 hover:bg-red-100"
            redirectTo={guestInviteToken ? `/?invite=${guestInviteToken}` : "/"}
          />
        </div>
      </div>
    );
  }

  // ---- 入室前:名前入力・アバター選択モーダル ----
  if (!joined) {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-hidden bg-slate-900 px-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
          <div className="mb-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRoomSelected(false)}
              aria-label="ルーム選択に戻る"
              className="shrink-0 text-lg text-slate-500 hover:text-slate-800"
            >
              ←
            </button>
            <h1 className="text-lg font-bold text-slate-800">
              {roomName}に入室
            </h1>
          </div>
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
            確定
          </button>
        </div>
      </div>
    );
  }

  const playerList = Object.values(players);

  // 近く(音声通話が繋がっている相手)にいて、かつ画面共有中の人の一覧。
  // 選択視聴モデルのため、ライブ映像(remoteScreenStreams)を持っているのは
  // このうち選択中の1人だけで、それ以外は静止画プレビューのみ持ちうる。
  const eligibleSetForScreen = new Set(eligiblePeerIds);
  const visibleScreenShares = playerList.filter(
    (p) =>
      p.id !== selfId.current &&
      p.sharingScreen &&
      eligibleSetForScreen.has(p.id),
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
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-slate-800">
      {/* ヘッダー */}
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-slate-700 bg-slate-900 px-4 py-2 text-white">
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Globy"
              className="h-5 w-5 object-contain"
            />
          </div>
          <span className="hidden text-sm font-semibold sm:inline">
            Globy
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
            <div className="flex shrink-0 flex-col items-center">
              <ScreenShareButton
                enabled={screenSharing}
                onClick={toggleScreenShare}
              />
              {screenShareRemainingSeconds !== null && (
                <span
                  className={`mt-0.5 hidden text-[9px] leading-none sm:inline ${
                    screenShareRemainingSeconds <= 0
                      ? "text-red-400"
                      : "text-slate-400"
                  }`}
                  title="画面共有の本日の残り利用可能時間(4:00にリセット)"
                >
                  残{formatRemainingTime(screenShareRemainingSeconds)}
                </span>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-center">
              <VideoCallButton enabled={inCall} onClick={toggleVideoCall} />
              {videoCallRemainingSeconds !== null && (
                <span
                  className={`mt-0.5 hidden text-[9px] leading-none sm:inline ${
                    videoCallRemainingSeconds <= 0
                      ? "text-red-400"
                      : "text-slate-400"
                  }`}
                  title="ビデオ通話の本日の残り利用可能時間(4:00にリセット)"
                >
                  残{formatRemainingTime(videoCallRemainingSeconds)}
                </span>
              )}
            </div>
            {/* チャットは左サイドバーの参加者一覧に統合したため、ここには
                アイコンを置かない(未読の有無はハンバーガーボタン側に
                表示する)。設定アイコンはサイドバーの「自分」欄に移動した */}
            {/* スマホのみ表示するハンバーガーボタン(未読DMがあれば赤丸を表示) */}
            <div className="relative shrink-0 sm:hidden">
              <button
                onClick={() => setShowParticipants((v) => !v)}
                className="rounded p-1.5 hover:bg-white/10"
                aria-label="参加者一覧を開く"
              >
                <span className="mb-1 block h-0.5 w-5 bg-white" />
                <span className="mb-1 block h-0.5 w-5 bg-white" />
                <span className="block h-0.5 w-5 bg-white" />
              </button>
              {Object.values(unreadFromPeers).some(Boolean) && (
                <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-red-500" />
              )}
            </div>
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

          {/* 画面共有は同時に何人でも共有できるが、視聴は1人だけ選ぶ方式。
              選択中の相手だけライブ映像、それ以外は共有開始時点の静止画
              プレビュー(無ければ「共有中」の簡易表示)を出す。 */}
          {visibleScreenShares.map((p) => {
            const isSelected = selectedScreenSharerId === p.id;
            const liveStream = isSelected ? remoteScreenStreams[p.id] : null;
            return (
              <button
                key={`screen-${p.id}`}
                onClick={() =>
                  isSelected
                    ? setExpandedMedia({ peerId: p.id, kind: "screen" })
                    : setSelectedScreenSharerId(p.id)
                }
                className="relative"
                aria-label={
                  isSelected
                    ? `${p.name}の画面を全画面表示`
                    : `${p.name}の画面共有を視聴する`
                }
              >
                {liveStream ? (
                  <RemoteVideo
                    stream={liveStream}
                    className="h-20 w-32 rounded-md border border-emerald-400 bg-black object-contain"
                  />
                ) : screenPreviewImages[p.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={screenPreviewImages[p.id]}
                    alt={`${p.name}の画面共有プレビュー`}
                    className="h-20 w-32 rounded-md border border-slate-500 bg-black object-contain"
                  />
                ) : (
                  <div className="flex h-20 w-32 items-center justify-center rounded-md border border-slate-500 bg-black text-[10px] text-slate-300">
                    共有中
                  </div>
                )}
                <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
                  {p.name}の画面{!isSelected && "(視聴する)"}
                </span>
              </button>
            );
          })}

          {/* ビデオ通話のプレビューは全画面表示を廃止(通信量削減のため。
              全画面にするとLiveKitのadaptiveStreamが高解像度を要求してしまう)。 */}
          {visibleVideoCalls.map((p) => (
            <div key={`call-${p.id}`} className="relative">
              <RemoteVideo
                stream={remoteCallStreams[p.id]}
                className="h-20 w-32 rounded-md border border-slate-500 bg-black object-cover"
              />
              <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
                {p.name}
              </span>
            </div>
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
                (ルーム内での編集は廃止)。「会議室」(kind: "conference")は機能は
                同じ(同エリア内での自動音声接続)だが、見た目には存在が分からない
                よう背景・枠・ラベルを一切出さない透明なエリアとして扱う。 */}
            {meetingZones.map((zone) =>
              zone.kind === "conference" ? (
                <div
                  key={zone.id}
                  className="absolute bg-transparent"
                  style={{
                    left: zone.x,
                    top: zone.y,
                    width: zone.width,
                    height: zone.height,
                  }}
                />
              ) : (
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
              ),
            )}

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
                sizePx={avatarSizePx}
                ref={getAvatarRefCallback(p.id)}
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

        {/* サイドバー:オンラインリスト+DM(スマホはドロワー表示) */}
        <div
          className={`${
            showParticipants ? "flex" : "hidden"
          } fixed inset-y-0 left-0 z-40 w-64 flex-col border-r border-slate-700 bg-slate-900 text-white sm:static sm:z-auto sm:order-first sm:flex sm:w-56 sm:shrink-0`}
        >
          {/* 上半分:自分+参加者一覧(スクロール可能) */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
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

            <h2 className="mb-2 text-xs font-semibold text-slate-400">
              参加者(クリックでチャット)
            </h2>
            <ul className="space-y-1">
              {playerList
                .filter((p) => p.id !== selfId.current)
                .map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => p.userId && setSelectedPeerUserId(p.userId)}
                      disabled={!p.userId}
                      className={`flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        p.userId && selectedPeerUserId === p.userId
                          ? "bg-white/10"
                          : "hover:bg-white/5"
                      }`}
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            PRESENCE_STATUS_COLORS[p.status ?? "available"],
                        }}
                      />
                      {p.userId && unreadFromPeers[p.userId] && (
                        <span
                          className="shrink-0 text-xs"
                          title="未読メッセージがあります"
                        >
                          💬
                        </span>
                      )}
                      <span className="truncate">{p.name}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>

          {/* 下半分:選択中の相手とのDM */}
          <div className="flex h-64 shrink-0 flex-col border-t border-slate-700">
            {(() => {
              const peer = selectedPeerUserId
                ? playerList.find((p) => p.userId === selectedPeerUserId)
                : null;
              if (!selectedPeerUserId) {
                return (
                  <div className="flex flex-1 items-center justify-center px-3 text-center text-[11px] text-slate-500">
                    参加者を選択してチャットを開始してください
                  </div>
                );
              }
              const thread = dmThreads[selectedPeerUserId] ?? [];
              return (
                <>
                  <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
                    <h2 className="truncate text-xs font-semibold text-slate-300">
                      {peer?.name ?? "退出したユーザー"}
                    </h2>
                    <button
                      onClick={() => setSelectedPeerUserId(null)}
                      className="shrink-0 text-slate-400 hover:text-white"
                      aria-label="チャットを閉じる"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="relative min-h-0 flex-1">
                    <div
                      ref={dmScrollRef}
                      onScroll={(e) => {
                        if (isDmScrollNearBottom(e.currentTarget)) {
                          setShowDmScrollButton(false);
                        }
                        closeDmCopyUi();
                      }}
                      className="h-full space-y-2 overflow-y-auto px-3 py-2"
                    >
                      {thread.length === 0 && (
                        <p className="mt-4 text-center text-[11px] text-slate-500">
                          まだメッセージはありません
                        </p>
                      )}
                      {thread.map((m) => (
                        <div
                          key={m.id}
                          onContextMenu={(e) => handleDmContextMenu(e, m)}
                          onTouchStart={(e) => handleDmTouchStart(e, m)}
                          onTouchMove={handleDmTouchMove}
                          onTouchEnd={handleDmTouchEnd}
                          onTouchCancel={handleDmTouchEnd}
                          className={`dm-selectable max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs ${
                            m.isSelf
                              ? "ml-auto bg-emerald-600 text-white"
                              : "bg-slate-700 text-slate-100"
                          }`}
                        >
                          <p
                            ref={(el) => {
                              dmBubbleRefs.current[m.id] = el;
                            }}
                            className="whitespace-pre-wrap break-words"
                          >
                            {m.message}
                          </p>
                        </div>
                      ))}
                    </div>
                    {showDmScrollButton && (
                      <button
                        type="button"
                        onClick={() => {
                          const el = dmScrollRef.current;
                          if (el) el.scrollTop = el.scrollHeight;
                          setShowDmScrollButton(false);
                        }}
                        aria-label="最新メッセージへ移動"
                        title="最新メッセージへ移動"
                        className="absolute bottom-2 left-1/2 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full bg-slate-600 text-white shadow-lg hover:bg-slate-500"
                      >
                        ↓
                      </button>
                    )}
                  </div>
                  {dmError && (
                    <p className="border-t border-slate-700 bg-red-900/80 px-3 py-1.5 text-[11px] text-red-100">
                      {dmError}
                    </p>
                  )}
                  <div className="flex gap-1.5 border-t border-slate-700 p-2">
                    <input
                      value={dmInput}
                      onChange={(e) => setDmInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                          sendDmMessage();
                        }
                      }}
                      maxLength={500}
                      placeholder="メッセージを入力"
                      className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs text-white outline-none focus:border-slate-400"
                    />
                    <button
                      onClick={sendDmMessage}
                      disabled={!dmInput.trim() || dmSending}
                      className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      送信
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* DMメッセージのコピーメニュー/選択コピー用の背景(外側タップで閉じる) */}
      {(dmContextMenu || dmSelectionModeMessageId) && (
        <div className="fixed inset-0 z-40" onClick={closeDmCopyUi} />
      )}

      {/* DMメッセージの右クリック/長押しメニュー */}
      {dmContextMenu && (
        <div
          className="fixed z-50 min-w-[128px] overflow-hidden rounded-lg bg-slate-800 text-xs font-semibold text-white shadow-xl"
          style={{ left: dmContextMenu.x, top: dmContextMenu.y }}
        >
          <button
            type="button"
            onClick={() => {
              copyDmText(dmContextMenu.message.message);
              closeDmCopyUi();
            }}
            className="block w-full px-3 py-2 text-left hover:bg-slate-700"
          >
            コピー
          </button>
          <button
            type="button"
            onClick={() => {
              if (dmContextMenu.selectedText) {
                copyDmText(dmContextMenu.selectedText);
                closeDmCopyUi();
              } else {
                setDmSelectionModeMessageId(dmContextMenu.message.id);
                setDmContextMenu(null);
              }
            }}
            className="block w-full border-t border-slate-700 px-3 py-2 text-left hover:bg-slate-700"
          >
            選択コピー
          </button>
        </div>
      )}

      {/* 選択コピーモード中、選択範囲の直上に追従表示する「コピー」吹き出し */}
      {dmSelectionModeMessageId && dmSelectionBubblePos && (
        <button
          type="button"
          onClick={() => {
            copyDmText(window.getSelection()?.toString() ?? "");
            closeDmCopyUi();
          }}
          style={{
            left: dmSelectionBubblePos.x,
            top: dmSelectionBubblePos.y,
            transform: "translate(-50%, calc(-100% - 8px))",
          }}
          className="fixed z-50 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-xl"
        >
          コピー
        </button>
      )}

      {/* DMメッセージコピー成功時のトースト通知 */}
      {dmCopyToast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg">
          ✅ コピーしました
        </div>
      )}

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

      {/* プラン変更による強制退出の通知(最前面に表示し、少ししてから
          window.location.reload()で新プランの制限を反映し直す) */}
      {forceLeaveMessage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-xl">
            <p className="text-sm font-semibold text-slate-800">
              {forceLeaveMessage}
            </p>
          </div>
        </div>
      )}

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

            <div className="mb-4 flex gap-4">
              <div>
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

              <div className="min-w-0 flex-1">
                <p className="mb-2 text-xs font-semibold text-slate-500">
                  吹き出し
                </p>
                <label className="mb-2 flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={settingsShowMessage}
                    onChange={(e) => setSettingsShowMessage(e.target.checked)}
                  />
                  表示する
                </label>
                <input
                  value={settingsMessageInput}
                  onChange={(e) =>
                    setSettingsMessageInput(
                      e.target.value.slice(0, MESSAGE_MAX_LENGTH),
                    )
                  }
                  maxLength={MESSAGE_MAX_LENGTH}
                  placeholder="吹き出しの内容"
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500"
                />
                <p className="mt-1 text-[10px] text-slate-400">
                  {settingsMessageInput.length}/{MESSAGE_MAX_LENGTH}文字
                </p>
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
              <button
                onClick={() => {
                  setSettingsOpen(false);
                  handleLeaveRoom();
                }}
                className="w-full rounded-lg bg-red-50 py-2 text-sm font-semibold text-red-600 hover:bg-red-100"
              >
                退出
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
