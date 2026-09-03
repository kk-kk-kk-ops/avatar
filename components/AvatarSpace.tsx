"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RealtimeChannel } from "@supabase/supabase-js";
import {
  DisconnectReason,
  Room as LiveKitRoom,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import { createClient } from "@/lib/supabase/client";
import { applyNoiseFilterProcessor } from "@/lib/audio/noiseFilterProcessor";
import {
  PlayerState,
  PresenceStatus,
  PRESENCE_STATUS_COLORS,
  PRESENCE_STATUS_LABELS,
  MAP_WIDTH,
  MAP_HEIGHT,
  AVATAR_HITBOX_WIDTH,
  AVATAR_HITBOX_HEIGHT,
  DESKTOP_AUTO_LOGOUT_SECONDS,
  MOBILE_AUTO_LOGOUT_SECONDS,
  MOVE_SPEED,
  MESSAGE_MAX_LENGTH,
  findMeetingZoneId,
  rectIntersectsObstacle,
  rectIntersectsRect,
  resolveSpawnPosition,
  PROXIMITY_RADIUS,
  AVATAR_RADIUS,
  NEW_ITEM_SIZE,
  Obstacle,
  MeetingZone,
  WarpPoint,
  WARP_POINT_RADIUS,
  DEFAULT_OBSTACLES,
  DEFAULT_MEETING_ZONES,
  AVATAR_IMAGES,
  Room,
  getAvatarSpritePath,
} from "@/lib/types";
import Avatar, { type AvatarHandle } from "./Avatar";
import AvatarPicker from "./AvatarPicker";
import TouchControls from "./TouchControls";
import MicButton from "./MicButton";
import RemoteAudio from "./RemoteAudio";
import RemoteVideo from "./RemoteVideo";
import ScreenShareButton from "./ScreenShareButton";
import VideoCallButton from "./VideoCallButton";
import LeaveRoomButton from "./LeaveRoomButton";
import {
  uploadRawChatImageWithProgress,
  validateChatImageFile,
} from "./uploadChatImage";
import { DAILY_IMAGE_UPLOAD_LIMIT } from "@/lib/types";

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

// サイドバーのタブ切替(参加者/チャット/通知/設定)用の線画アイコン。
// アイコンフォント等のライブラリは使わず、白線(currentColor)のみの
// シンプルなインラインSVGで揃える。
function TabIconBell({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 3a5 5 0 0 0-5 5v3.5c0 .9-.35 1.76-.98 2.4L4.7 15.2a1 1 0 0 0 .7 1.7h13.2a1 1 0 0 0 .7-1.7l-1.32-1.3a3.4 3.4 0 0 1-.98-2.4V8a5 5 0 0 0-5-5Z" />
      <path d="M9.5 18.5a2.5 2.5 0 0 0 5 0" />
    </svg>
  );
}

function TabIconPerson({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="8" r="3.3" />
      <path d="M5 19.5c0-3.5 3-5.8 7-5.8s7 2.3 7 5.8" />
    </svg>
  );
}

function TabIconChat({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3.2V16H6a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

// 手描きの単一pathだと中心がずれやすいため、歯を(12,12)中心の回転
// transformで均等配置する方式にし、確実に歯車の中心と丸の中心が
// 揃うようにしている。
const GEAR_TOOTH_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

function TabIconGear({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {GEAR_TOOTH_ANGLES.map((deg) => (
        <rect
          key={deg}
          x="10.9"
          y="1.6"
          width="2.2"
          height="3.2"
          rx="0.6"
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

// ワープのチャンネル(A/B/C)ごとの表示色(半透明)。app/master/
// TemplateEditor.tsxにも同じ内容を別途持たせている(lib/types.tsは
// Tailwindのcontentスキャン対象外のため、クラス文字列はcomponents/**・
// app/**の中にそのまま書く必要がある)。
function warpChannelClasses(channel: "A" | "B" | "C"): string {
  switch (channel) {
    case "A":
      return "border-red-400 bg-red-500/30";
    case "B":
      return "border-yellow-400 bg-yellow-400/30";
    case "C":
      return "border-blue-400 bg-blue-500/30";
  }
}

// チャットの固定絵文字リアクション(5種類)。DB側のcheck制約
// (chat_message_reactions_emoji_check)と同じ値を維持すること。
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "👏"] as const;

type ChatReaction = { userId: string; emoji: string };

// トークに付いた複数人分のリアクション(1人1件)を、絵文字ごとに
// 件数集計する(誰が押したかはUIに出さないため、集計後の形だけ持てば
// 十分)。
type GroupedReaction = { emoji: string; count: number; mine: boolean };
function groupChatReactions(
  reactions: ChatReaction[],
  myUserId: string | null,
): GroupedReaction[] {
  const order: string[] = [];
  const counts = new Map<string, { count: number; mine: boolean }>();
  for (const r of reactions) {
    const entry = counts.get(r.emoji);
    if (entry) {
      entry.count += 1;
      if (r.userId === myUserId) entry.mine = true;
    } else {
      counts.set(r.emoji, { count: 1, mine: r.userId === myUserId });
      order.push(r.emoji);
    }
  }
  return order.map((emoji) => ({ emoji, ...counts.get(emoji)! }));
}

// renderTextWithMentionsと対になる、送信テキストからのメンション対象抽出。
// 判定条件(直後が空白or文字列終端)を完全に揃えることで、「表示上ハイライト
// された@メンションと、実際に通知が作られる@メンションが食い違う」ことが
// 無いようにしている。
function extractGroupMentions(
  text: string,
  members: { userId: string; displayName: string }[],
): { everyone: boolean; userIds: string[] } {
  const everyone = /@全員(?=\s|$)/.test(text);
  const userIds = new Set<string>();
  for (const m of members) {
    const escaped = m.displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`@${escaped}(?=\\s|$)`).test(text)) {
      userIds.add(m.userId);
    }
  }
  return { everyone, userIds: Array.from(userIds) };
}

// グループチャットの@メンション表示用。テキスト中の「@全員」「@<メンバー
// 表示名>」を紫色でハイライトする(入力中のオーバーレイ・送信済み
// メッセージの吹き出し表示、両方で共有する)。表示名の直後が空白または
// 文字列終端の場合のみマッチさせることで、「@k.k」の後に文字を続けて
// 打った場合(例: 「@k.kさん」)は途中まで一致させずデフォルト色に戻す
// (仕様上の要件)。表示名が別の表示名の接頭辞になっているケースを誤って
// 短い方でマッチさせないよう、長い名前から先に試す。
function renderTextWithMentions(
  text: string,
  mentionNames: string[],
): React.ReactNode {
  if (!text || mentionNames.length === 0) return text;
  const escaped = mentionNames
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`@(?:${escaped.join("|")})(?=\\s|$)`, "g");
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={key++} className="text-blue-400">
        {match[0]}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
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

// 参加者一覧の最終メッセージ時刻表示用に「HH:MM」形式へ整形する。
function formatDmClockTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// チャットタブの一覧用。当日なら時刻のみ、それ以前は日付(M/D)を表示する
// (ログインをまたいで数日〜数ヶ月前の履歴も並ぶため、時刻だけでは
// いつのやり取りか分からなくなるのを防ぐ)。
function formatDmListTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isSameDay) return formatDmClockTime(iso);
  return date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

// 個々のトーク(メッセージ吹き出し)の送信時刻表示用。当日なら今まで通り
// 時刻のみ、それより前の日付なら「9/1(火) 23:30」のように日付・曜日を
// 添える(2026-09報告: 日付をまたいだ履歴を見返す際、時刻だけだと
// いつのメッセージか分からなかったため)。
const WEEKDAY_LABELS_JA = ["日", "月", "火", "水", "木", "金", "土"];
function formatDmMessageTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isSameDay) return formatDmClockTime(iso);
  const weekday = WEEKDAY_LABELS_JA[date.getDay()];
  return `${date.getMonth() + 1}/${date.getDate()}(${weekday}) ${formatDmClockTime(iso)}`;
}

// 通知一覧のメンション本文プレビュー用。30文字を超える場合は30文字+「...」
// に省略する。
function truncateForPreview(text: string, maxLength = 30): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
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
  // プランごとの音声通話1日あたり利用可能時間(分)。nullは無制限。
  // 画面共有・ビデオ通話と全く同じ仕組み(daily_usageテーブル、
  // kind='voice_call')。「音声通話中」はマイクON かつ 近くに人がいる
  // (eligiblePeerIds.length > 0)状態として計測する。
  voiceCallDailyMinutes: number | null;
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
  voiceCallDailyMinutes,
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

  // 一時的なモバイルデバッグ用。URLに?debugConsole=1が付いている場合のみ、
  // erudaという軽量なオンページデバッグコンソール(コンソールログ・
  // ネットワークタブを画面上に表示するツール)を読み込む。Macを使った
  // リモートデバッグ環境が無いスマホ実機でも、その場でログを直接
  // 確認できるようにするための一時的な調査用コードで、通常利用には
  // 一切影響しない(パラメータが無ければ何もしない)。原因調査が終わり
  // 次第この節ごと削除する想定。
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!new URLSearchParams(window.location.search).has("debugConsole")) {
      return;
    }
    if (document.getElementById("eruda-debug-script")) return;
    const script = document.createElement("script");
    script.id = "eruda-debug-script";
    script.src = "https://cdn.jsdelivr.net/npm/eruda";
    script.onload = () => {
      (window as unknown as { eruda?: { init: () => void } }).eruda?.init();
    };
    document.body.appendChild(script);
  }, []);

  // ---- ルーム(F-2でルーム選択画面を廃止。アカウントにつきルームは1つの
  // 前提のため、rooms[0]をそのまま「確定した」ルームとして扱う) ----
  // Realtimeチャンネル名・map_layoutの検索キーに使う。
  const [roomId] = useState(rooms[0]?.id ?? "");
  const [roomJoinError, setRoomJoinError] = useState<string | null>(null);
  // 入室前のプレビューに表示するオンライン人数の集計。
  // 自分自身はtrack()しない観測者としてpresenceチャンネルを覗くだけ。
  const [roomOnlineCounts, setRoomOnlineCounts] = useState<
    Record<string, number>
  >({});
  const [joined, setJoined] = useState(false);
  // 入室直後のアバター向き別スプライトのプリロードが完了したかどうか。
  // 完了するまでローディング画面を表示し、移動・向き変更操作をロックする。
  const [assetsReady, setAssetsReady] = useState(false);
  const [nameInput, setNameInput] = useState(initialName ?? "");
  const [selectedAvatar, setSelectedAvatar] = useState(AVATAR_IMAGES[0]);
  // サイドバーの3タブ(参加者/チャット/設定)。設定は以前は別画面の
  // モーダルだったが、サイドバー内のタブへ埋め込む形に変更した。
  const [sidebarTab, setSidebarTab] = useState<
    "participants" | "chat" | "notifications" | "settings"
  >("participants");
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

  // ---- サイドバーの幅可変(PC版のみ)。リロードで既定幅に戻るシンプルな
  // 実装(永続化はしない)。下限は既存の固定幅、上限は画面幅の50%。 ----
  const SIDEBAR_MIN_WIDTH = 274; // 既存のPC版固定幅(sm:w-[274px]だった値)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_MIN_WIDTH);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );
  const handleSidebarResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      sidebarResizeRef.current = { startX: e.clientX, startWidth: sidebarWidth };
    },
    [sidebarWidth],
  );
  const handleSidebarResizeMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = sidebarResizeRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const maxWidth = window.innerWidth * 0.5;
      const next = Math.min(
        Math.max(drag.startWidth + dx, SIDEBAR_MIN_WIDTH),
        maxWidth,
      );
      setSidebarWidth(next);
    },
    [],
  );
  const handleSidebarResizeEnd = useCallback(() => {
    sidebarResizeRef.current = null;
  }, []);
  const [viewport, setViewport] = useState({ width: 0, height: 0 }); // カメラ計算用の表示領域サイズ
  const [micEnabled, setMicEnabled] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  // LiveKitの意図しない切断→自力再接続時に、ミュート状態を復元するための
  // 参照(RoomEventハンドラのクロージャから常に最新値を読みたいため)。
  const micEnabledRef = useRef(false);
  useEffect(() => {
    micEnabledRef.current = micEnabled;
  }, [micEnabled]);
  // 音声通話の「今日の残り利用可能時間(秒)」。画面共有・ビデオ通話と全く
  // 同じ考え方(null = 未取得中 or プランが無制限)。daily_usageテーブルの
  // kind='voice_call'を使う。
  const [voiceCallRemainingSeconds, setVoiceCallRemainingSeconds] =
    useState<number | null>(null);
  const voiceCallRemainingRef = useRef<number | null>(null);
  useEffect(() => {
    voiceCallRemainingRef.current = voiceCallRemainingSeconds;
  }, [voiceCallRemainingSeconds]);
  const [remoteStreams, setRemoteStreams] = useState<
    Record<string, MediaStream>
  >({});
  const [screenSharing, setScreenSharing] = useState(false);
  const screenSharingRef = useRef(false);
  useEffect(() => {
    screenSharingRef.current = screenSharing;
  }, [screenSharing]);
  // スマホの画面オフ中、相手のマイク・カメラ・画面共有を受信(購読)しない
  // ようにするためのフラグ(2026-09報告: 画面オフでも近くの人の音声が
  // スマホから鳴り続けていたため)。送信側の強制ミュートとは別に、
  // 受信側の購読も止める必要がある。
  const [receptionSuspended, setReceptionSuspended] = useState(false);
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
  // D-1の「購読直後に一度だけキーフレーム再要求のトグルを行う」処理を、
  // 同じtrackSidに対して二重に予約しないようにするための記録
  // (trackSid単位。キーとして使うのは、共有を一度止めて再開すると新しい
  // trackSidになるため「本当に新しい配信」だけを対象にできるため)。
  const kickedScreenShareTrackSidsRef = useRef<Set<string>>(new Set());
  // 共有開始時点の最初の1フレームを静止画にしたプレビュー(dataURL)。
  // 選択して視聴を始めるまではこちらを表示し、選択後はライブ映像に切り替える。
  const [screenPreviewImages, setScreenPreviewImages] = useState<
    Record<string, string>
  >({});
  const [inCall, setInCall] = useState(false);
  const inCallRef = useRef(false);
  useEffect(() => {
    inCallRef.current = inCall;
  }, [inCall]);
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
  // I-2: 相手の画面共有を全画面視聴している間、自分のビデオ通話を一時停止
  // して負荷を下げる。videoPausedForScreenViewはUI表示切り替え用、
  // pausedVideoBeforeExpandedRefは「一時停止する直前、自分の意思で
  // ビデオ通話をONにしていたか」を覚えておき、全画面を閉じた時に
  // 再開すべきかどうかの判定に使う。
  const [videoPausedForScreenView, setVideoPausedForScreenView] =
    useState(false);
  const pausedVideoBeforeExpandedRef = useRef(false);

  // ---- チャット(参加者ごとの1対1DM。全プラン共通の標準機能) ----
  type DmMessage = {
    id: string;
    senderUserId: string;
    isSelf: boolean;
    message: string;
    createdAt: string;
    editedAt: string | null;
    deletedAt: string | null;
    imagePath: string | null;
    reactions: ChatReaction[];
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
  // 「チャット」タブ上部に出す、やり取りした相手ごとの最新メッセージ一覧
  // (LINEのトーク一覧のようなもの)。list_chat_threads RPCでサーバー側に
  // 集計させる(未読数はログインをまたいでも保持するため、chat_read_state
  // テーブルの既読位置と突き合わせてサーバー側で計算している)。
  type ChatThreadSummary = {
    threadId: string; // 1対1: 相手のuserId、グループ: グループID
    isGroup: boolean;
    threadName: string;
    lastMessage: string;
    lastMessageAt: string;
    unreadCount: number;
  };
  const [chatThreads, setChatThreads] = useState<ChatThreadSummary[]>([]);
  // 自分が所属しているグループIDの集合。ルームchannelのbroadcastは
  // グループメンバー以外にも届いてしまう(broadcast自体はRLSの対象外の
  // ため)ため、受信側でメンバーかどうかをこれで判定して弾く。
  // chatThreads取得のたびに更新し、グループ作成直後は楽観的に追加する。
  const myGroupIdsRef = useRef<Set<string>>(new Set());
  const [chatThreadsLoading, setChatThreadsLoading] = useState(false);
  const [chatThreadsError, setChatThreadsError] = useState<string | null>(
    null,
  );
  // 新着DM/グループメッセージを受信するたびに+1し、チャット一覧の
  // 再取得トリガーにする。
  const [chatThreadsRefreshTrigger, setChatThreadsRefreshTrigger] = useState(0);

  // ---- 通知(グループチャットの@メンション) ----
  type MentionNotification = {
    id: string;
    messageId: string;
    groupId: string;
    groupName: string;
    mentionerName: string;
    isEveryone: boolean;
    createdAt: string;
    readAt: string | null;
    messageCreatedAt: string;
    messagePreview: string;
  };
  const [mentions, setMentions] = useState<MentionNotification[]>([]);
  const [mentionsLoading, setMentionsLoading] = useState(false);
  const [mentionsError, setMentionsError] = useState<string | null>(null);
  const [mentionsRefreshTrigger, setMentionsRefreshTrigger] = useState(0);
  // 開いたら該当メッセージまでスクロールしたい対象(通知一覧からの
  // ジャンプ用)。messageCreatedAtは、対象メッセージが「直近50件」に
  // 含まれない古いものだった場合に、その時刻を基準にした取得(前後を
  // まとめて取る)を行うために使う。グループスレッドの読み込み側で
  // このrefを見て処理し、使い終わったらnullに戻す。
  const pendingMentionScrollTargetRef = useRef<{
    messageId: string;
    createdAt: string;
  } | null>(null);

  // ---- グループチャット ----
  type GroupMessage = {
    id: string;
    senderUserId: string;
    senderName: string;
    isSelf: boolean;
    message: string;
    createdAt: string;
    deletedAt: string | null;
    // 退出通知(「○○が退出しました」)かどうか。trueの場合、通常の吹き
    // 出しではなく枠なし・赤文字で表示する。
    isSystem: boolean;
    imagePath: string | null;
    reactions: ChatReaction[];
  };
  // 現在サイドバーで開いているグループスレッド。1対1(selectedPeerUserId)
  // とは排他的(どちらか一方だけがnullでない)。
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const selectedGroupIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedGroupIdRef.current = selectedGroupId;
  }, [selectedGroupId]);

  // 「チャット」タブから他のタブ(参加者/通知/設定)へ移動したら、開いていた
  // スレッドは閉じる。dm/group-dmのbroadcast受信ハンドラは
  // 「selectedPeerUserId(またはselectedGroupId)と一致する相手からの新着は
  // 今まさに見ているので未読扱いにしない」という判定をしており、タブを
  // 切り替えても選択状態が残ったままだと、実際には見えていないスレッドの
  // 新着まで既読扱いになり未読バッジに反映されない不具合があった
  // (2026-09-02報告)。
  useEffect(() => {
    if (sidebarTab !== "chat") {
      setSelectedPeerUserId(null);
      setSelectedGroupId(null);
    }
  }, [sidebarTab]);
  const [groupThreads, setGroupThreads] = useState<
    Record<string, GroupMessage[]>
  >({});
  const [groupInput, setGroupInput] = useState("");
  const groupInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [groupSending, setGroupSending] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  // @メンション機能用。開いているグループスレッドのメンバー表示名一覧
  // (ポップアップ候補・送信済みメッセージのハイライト両方に使う)。
  type GroupMember = { userId: string; displayName: string };
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  // 送信済みメッセージの送信者名表示用。chat_messages.sender_nameは送信時点の
  // 表示名のスナップショットのため、後から表示名を変更しても過去メッセージ
  // の表示は古いままだった(2026-09報告)。groupMembersはグループを開く
  // たびにDBから最新の表示名を取得し直しているため、これで解決できる
  // 相手(=現メンバー)についてはこちらを優先し、既にグループを抜けた等で
  // 一覧に無い場合のみsender_nameのスナップショットにフォールバックする。
  const groupMemberNameById = useMemo(
    () => new Map(groupMembers.map((m) => [m.userId, m.displayName])),
    [groupMembers],
  );
  // 入力中に「@」を打った(かつ直後に空白を含まない)時だけセットする、
  // 候補ポップアップの状態。startは対象の「@」がgroupInput内で始まる
  // 位置(候補選択時、ここから選択範囲までを「@表示名 」で置き換える)。
  const [groupMentionQuery, setGroupMentionQuery] = useState<{
    start: number;
    query: string;
  } | null>(null);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [createGroupSelectedIds, setCreateGroupSelectedIds] = useState<
    Set<string>
  >(new Set());
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [createGroupError, setCreateGroupError] = useState<string | null>(
    null,
  );
  // グループ一覧の右クリックメニュー(グループ名変更/削除)。
  const [groupContextMenu, setGroupContextMenu] = useState<{
    groupId: string;
    x: number;
    y: number;
  } | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameGroupInput, setRenameGroupInput] = useState("");
  const [renamingGroupSaving, setRenamingGroupSaving] = useState(false);
  const [renameGroupError, setRenameGroupError] = useState<string | null>(
    null,
  );
  const [leavingGroupId, setLeavingGroupId] = useState<string | null>(null);
  const [leavingGroupBusy, setLeavingGroupBusy] = useState(false);
  const [leaveGroupError, setLeaveGroupError] = useState<string | null>(
    null,
  );
  const [dmInput, setDmInput] = useState("");
  const [dmSending, setDmSending] = useState(false);
  const [dmError, setDmError] = useState<string | null>(null);
  const [dmImageUploading, setDmImageUploading] = useState(false);
  // 送信中の画像アップロード進捗。複数枚をまとめて送る場合、何枚目を
  // 処理中か(index/total)と、そのアップロードの進捗%を持つ。
  // phase: "uploading"はxhr.upload.onprogressによる実際のバイト進捗、
  // "compressing"はサーバー側の圧縮APIレスポンス待ち(進捗は取得できない
  // ため見た目上のインジケーターのみ)。
  const [dmUploadProgress, setDmUploadProgress] = useState<{
    index: number;
    total: number;
    percent: number;
    phase: "uploading" | "compressing";
  } | null>(null);
  const dmImageInputRef = useRef<HTMLInputElement | null>(null);
  // メッセージごとの署名付き画像URL(取得済み分のキャッシュ)。有効期限
  // (5分)が近いことは気にせず、スレッドを開き直した際に再取得する簡易実装。
  const [dmImageUrls, setDmImageUrls] = useState<Record<string, string>>({});
  // 署名付きURLの取得(fetch自体)、または実際の画像読み込み(<img>の
  // onerror)のどちらかに失敗したメッセージID。取得失敗を無限リトライ
  // させないためのマーカーであり、かつ「読み込めませんでした・タップで
  // 再試行」というUIを出す判定にも使う。
  const [dmImageLoadFailed, setDmImageLoadFailed] = useState<
    Record<string, true>
  >({});
  // 送信前の添付画像(選択/ドロップ/貼り付け直後〜送信操作までの一時状態)。
  // 複数枚を溜められるよう配列で持つ。実際のアップロード・圧縮は
  // 送信操作のタイミングまで行わない。
  type DmPendingImage = {
    id: string;
    file: File;
    previewUrl: string;
    width?: number;
    height?: number;
  };
  const [dmPendingImages, setDmPendingImages] = useState<DmPendingImage[]>([]);
  const [dmDragActive, setDmDragActive] = useState(false);
  // グループチャットの画像添付(DMと同じ考え方の一時添付状態)。署名付き
  // URLのキャッシュ(dmImageUrls/dmImageLoadFailed)・拡大プレビュー
  // (dmLightbox)はメッセージID単位のキーで、DM/グループどちらの画像でも
  // 共用できるためグループ専用には分けていない。
  const [groupPendingImages, setGroupPendingImages] = useState<
    DmPendingImage[]
  >([]);
  const [groupImageUploading, setGroupImageUploading] = useState(false);
  const [groupUploadProgress, setGroupUploadProgress] = useState<{
    index: number;
    total: number;
    percent: number;
    phase: "uploading" | "compressing";
  } | null>(null);
  const groupImageInputRef = useRef<HTMLInputElement | null>(null);
  const [groupDragActive, setGroupDragActive] = useState(false);
  // 画像の拡大プレビュー(送受信済み画像/送信前プレビューの両方で使う)。
  // messageIdがnullの場合は送信前プレビュー(保存ボタンは出さない)。
  const [dmLightbox, setDmLightbox] = useState<{
    messageId: string | null;
    url: string;
  } | null>(null);
  const [dmLightboxDownloading, setDmLightboxDownloading] = useState(false);
  // 編集中のメッセージID。設定されている間、入力欄は送信ではなく更新用に
  // 動作する(dmInputにそのメッセージの文面を読み込んで使う)。
  const [dmEditingMessageId, setDmEditingMessageId] = useState<string | null>(
    null,
  );
  // メッセージ一覧のスクロール制御用。dmForceScrollRefがtrueの間に
  // dmThreads(選択中の相手分)が更新されたら、次の描画後に一番下へ
  // スクロールする(自分の送信時・スレッドを開いた時・最下部付近での
  // 新着時)。falseのまま更新された場合は、最下部から離れて過去の
  // メッセージを見ている間の新着なので、自動スクロールせず矢印ボタンを出す。
  const dmScrollRef = useRef<HTMLDivElement | null>(null);
  const dmForceScrollRef = useRef(false);
  const [showDmScrollButton, setShowDmScrollButton] = useState(false);
  // グループチャットは1対1よりシンプルな仕様(画像添付・編集・削除・
  // コピーメニュー無し)のため、スクロール制御も単純に「更新のたびに
  // 一番下へ」だけにする。
  const groupScrollRef = useRef<HTMLDivElement | null>(null);
  // DMのdmForceScrollRefと同じ考え方(スレッドを開いた直後・自分の送信・
  // 最下部付近での新着はtrueにして一番下へスクロールし、それ以外(過去ログを
  // 見ている間の新着、通知からのメンションジャンプ)はfalseのままにして
  // 現在のスクロール位置を保つ)。以前はgroupThreadsが更新されるたびに
  // 無条件で一番下へスクロールしていたため、通知からメンションへジャンプ
  // した直後に(スパム送信等で)新着が来ると、無条件スクロールに位置を
  // 上書きされて最新メッセージへ戻ってしまう不具合があった(2026-09-02報告)。
  const groupForceScrollRef = useRef(false);

  // ---- チャット:メッセージのコピー(右クリック/長押しメニュー) ----
  // 各メッセージ本文<p>へのref(Range操作でメッセージ全文選択・選択中の
  // 相手の要素特定・メニュー位置算出(親の吹き出し枠のrect)に使う)。
  const dmBubbleRefs = useRef<Record<string, HTMLParagraphElement | null>>(
    {},
  );
  // 右クリック(PC)/長押し(スマホ)で開くメニュー。sourceが"mouse"か
  // "touch"かで表示項目が変わる(PC:未選択なら「コピー」のみ・選択済みなら
  // 「選択範囲をコピー」のみ。スマホ:長押し時点では事前選択という概念が
  // 無いため常に「コピー」「部分コピー」の2択のまま)。位置は常に対象
  // メッセージの吹き出し枠の右上に統一する(座標では管理しない)。
  const [dmContextMenu, setDmContextMenu] = useState<{
    message: DmMessage;
    selectedText: string;
    source: "mouse" | "touch";
  } | null>(null);
  // 「部分コピー」を選んだ場合に入る、範囲調整モード。対象メッセージ全文を
  // 初期選択した状態にし、ユーザーがブラウザ標準の選択ハンドルでドラッグして
  // 範囲を1文字単位で調整できるようにする(独自の選択ハンドルは描画しない。
  // ブラウザ/OSネイティブの選択操作に乗せることで端末差異を吸収する)。
  // このモードに入っている間だけ、対象メッセージに`dm-select-active`
  // クラスを付与してテキスト選択を許可する(スマホの通常の長押しでは
  // ネイティブ選択が発動しないよう、`.dm-selectable`自体は引き続き
  // PC限定のままにするため)。
  const [dmSelectionModeMessageId, setDmSelectionModeMessageId] = useState<
    string | null
  >(null);
  // スマホの長押し検出用(contextmenuイベントが発火しないiOS Safari向け)。
  const dmLongPressTimerRef = useRef<number | null>(null);
  const dmLongPressStartRef = useRef<{ x: number; y: number } | null>(null);
  // 絵文字リアクション:PCでホバー中のメッセージ(そのメッセージの上に
  // 絵文字バーを一時表示する)。DMメッセージはdmContextMenu(コピー/編集/
  // 削除メニュー)と別軸のUIなので専用stateにする。
  const [dmHoverMessageId, setDmHoverMessageId] = useState<string | null>(
    null,
  );
  const [groupHoverMessageId, setGroupHoverMessageId] = useState<
    string | null
  >(null);
  // 通知一覧からジャンプしてきた際、対象メッセージを一時的に強調表示する
  // ためのID(数秒後に自動で消える)。
  const [highlightedGroupMessageId, setHighlightedGroupMessageId] = useState<
    string | null
  >(null);
  // ホバーで出した絵文字バーへ、吹き出しとの間の隙間を挟んでマウスを
  // 移動する間に一瞬mouseleaveが発火して消えてしまう問題への対策。
  // leave即座に閉じず、一定時間後に閉じる予約をし、その間にバー側へ
  // マウスが入ってenterが再発火すれば予約をキャンセルする(DM/グループ
  // それぞれ独立したタイマーを持つ)。
  const dmHoverCloseTimerRef = useRef<number | null>(null);
  const groupHoverCloseTimerRef = useRef<number | null>(null);
  // グループメッセージの吹き出しdivへのref(絵文字バー/長押しメニューの
  // 位置算出に使う。DMのdmBubbleRefsと同じ考え方だが、グループメッセージ
  // には元々コピー機能が無いためref自体も無かった)。
  const groupBubbleRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // グループメッセージの長押しで開く、絵文字リアクション専用メニュー。
  // DMと違いグループメッセージには元々コピー/編集/削除メニューが無いため、
  // dmContextMenuとは別の、リアクションだけのシンプルなメニューにする。
  const [groupMessageContextMenu, setGroupMessageContextMenu] = useState<{
    message: GroupMessage;
  } | null>(null);
  const groupMessageLongPressTimerRef = useRef<number | null>(null);
  const groupMessageLongPressStartRef = useRef<{
    x: number;
    y: number;
  } | null>(null);

  const openDmHover = useCallback((messageId: string) => {
    // スマホ等のタッチ端末では、タップがmouseenterとして疑似発火する
    // ことがあり、意図せずPC向けのホバーバーが出てしまっていた
    // (2026-09-02報告)。実際にマウスでホバーできる端末(hover:hover
    // かつポインタがマウス相当の精度)でのみ開く。
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      return;
    }
    if (dmHoverCloseTimerRef.current !== null) {
      window.clearTimeout(dmHoverCloseTimerRef.current);
      dmHoverCloseTimerRef.current = null;
    }
    setDmHoverMessageId(messageId);
  }, []);

  const scheduleDmHoverClose = useCallback((messageId: string) => {
    if (dmHoverCloseTimerRef.current !== null) {
      window.clearTimeout(dmHoverCloseTimerRef.current);
    }
    dmHoverCloseTimerRef.current = window.setTimeout(() => {
      dmHoverCloseTimerRef.current = null;
      setDmHoverMessageId((cur) => (cur === messageId ? null : cur));
    }, 250);
  }, []);

  const openGroupHover = useCallback((messageId: string) => {
    // 理由はopenDmHover参照。
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      return;
    }
    if (groupHoverCloseTimerRef.current !== null) {
      window.clearTimeout(groupHoverCloseTimerRef.current);
      groupHoverCloseTimerRef.current = null;
    }
    setGroupHoverMessageId(messageId);
  }, []);

  const scheduleGroupHoverClose = useCallback((messageId: string) => {
    if (groupHoverCloseTimerRef.current !== null) {
      window.clearTimeout(groupHoverCloseTimerRef.current);
    }
    groupHoverCloseTimerRef.current = window.setTimeout(() => {
      groupHoverCloseTimerRef.current = null;
      setGroupHoverMessageId((cur) => (cur === messageId ? null : cur));
    }, 250);
  }, []);

  // グループ一覧の項目(名前変更/退出メニュー)向けの長押し検出用。
  // DMメッセージの長押しコピー機能とは無関係の、単純な「メニューを開く」
  // だけの用途のため、部分コピー等の複雑な状態は持たない。
  const groupLongPressTimerRef = useRef<number | null>(null);
  const groupLongPressStartRef = useRef<{ x: number; y: number } | null>(
    null,
  );
  // 長押しでメニューを開いた直後、指を離した際にボタンのonClick(スレッド
  // を開く操作)まで発火してしまうのを防ぐためのフラグ。
  const groupLongPressFiredRef = useRef(false);
  // 相手ごとの未読件数。参加者一覧の該当行にLINE風のバッジで表示し、
  // そのスレッドを開いたタイミングで0に戻す。
  const [unreadFromPeers, setUnreadFromPeers] = useState<
    Record<string, number>
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
  const [warpPoints, setWarpPoints] = useState<WarpPoint[]>([]);
  const warpPointsRef = useRef<WarpPoint[]>([]);
  // ワープ直後、瞬間移動先の丸にも重なっているため、そのまま同じフレームで
  // 逆方向へワープし直してしまう(行ったり来たりの無限ループ)のを防ぐため、
  // 「現在重なっている(と扱っている)ワープ地点のID」を記録する。時間経過
  // ではなく、一度丸の外に完全に出る(nullに戻る)までは新規のワープ判定を
  // 行わない(2026-09報告: 時間ベースのクールダウンだと、猶予時間内に
  // 丸から出られなかった場合に当たり判定が無いまま足踏みしてしまっていた)。
  const insideWarpIdRef = useRef<string | null>(null);
  // ワープ演出(一瞬暗転)用。trueの間、画面全体を覆う黒いオーバーレイを
  // 表示する。
  const [warpFading, setWarpFading] = useState(false);

  // マップの広さ(テンプレートごとに変更可能)。デフォルトは従来通りの
  // MAP_WIDTH/MAP_HEIGHTだが、テンプレート側で個別サイズが設定されて
  // いればそちらを使う。
  const [mapSize, setMapSize] = useState({ width: MAP_WIDTH, height: MAP_HEIGHT });
  const mapSizeRef = useRef({ width: MAP_WIDTH, height: MAP_HEIGHT });

  // 音声・映像・画面共有はLiveKit移行(Phase2〜4)でLiveKit経由に切り替えた
  // ため、自前PeerConnectionメッシュ関連の状態はPhase6で全て廃止した。
  const livekitRoomRef = useRef<LiveKitRoom | null>(null);
  // room.connect()が完了した瞬間を検知するためのstate(refと違いレンダーを
  // 起こせる)。G-2対応: 購読対象(eligiblePeerIds等)の計算はLiveKitの接続
  // 完了より先に確定していることがあり(Supabase presenceの同期や
  // meetingZonesの取得は別々の非同期処理で、どちらが先に終わるかは
  // 保証されない)、その場合「購読対象を反映するeffect」がLiveKit未接続で
  // 早期returnしたまま、購読対象自体はその後変化しないので二度と
  // 再実行されず、繋がってから購読が一度も反映されないことがあった
  // (全体アナウンスエリアで先に発信していた相手の音声・画面共有が、
  // 後から入室した人にだけ届かない不具合の原因)。接続完了をこのstateの
  // 変化として明示的に検知し、購読反映effectを必ずもう一度実行させる。
  const [livekitConnected, setLivekitConnected] = useState(false);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const lastTrackedZoneId = useRef<string | null>(null);

  // ---- 会議室(conference)ゾーンの入室確認・施錠機能 ----
  // 「いいえ」を選んだ相手は、当たり判定から完全に外れるまで再表示しない
  // ようにするための記録(ゾーンIDの集合)。
  const dismissedConferenceZonesRef = useRef<Set<string>>(new Set());
  // 「入室確認済み(はいを選んだ)」ゾーンIDの集合。当たり判定(矩形の重なり)
  // が完全に外れた時点で退室確定としてここから削除する(詳細は移動ループ内の
  // コメント参照)。
  const insideConferenceZoneIdsRef = useRef<Set<string>>(new Set());
  // 入室確認ポップアップの表示状態。rAFループ(refのみ参照)からも
  // 「既に表示中か」を判定できるよう、state本体とは別にrefでも持つ。
  const [pendingMeetingEntry, setPendingMeetingEntry] = useState<{
    zoneId: string;
  } | null>(null);
  const pendingMeetingEntryRef = useRef<{ zoneId: string } | null>(null);
  useEffect(() => {
    pendingMeetingEntryRef.current = pendingMeetingEntry;
  }, [pendingMeetingEntry]);
  // 施錠者以外が鍵アイコンを押した際のエラーポップアップ(3秒で自動的に消す)
  const [lockPermissionError, setLockPermissionError] = useState<{
    zoneId: string;
  } | null>(null);
  useEffect(() => {
    if (!lockPermissionError) return;
    const timer = setTimeout(() => setLockPermissionError(null), 3000);
    return () => clearTimeout(timer);
  }, [lockPermissionError]);
  // 施錠中の会議室に接触した際、自分の名前の上に出す警告吹き出し
  // (「鍵がかかっています」、3秒で自動的に消える)。既に表示中かどうかは
  // rAFループからも読めるようrefでも持ち、表示中の再接触は無視する
  // (=タイマーは延長しない、実装しやすい方を採用)。
  const [lockedZoneNotice, setLockedZoneNotice] = useState(false);
  const lockedZoneNoticeRef = useRef(false);
  useEffect(() => {
    lockedZoneNoticeRef.current = lockedZoneNotice;
    if (!lockedZoneNotice) return;
    const timer = setTimeout(() => setLockedZoneNotice(false), 3000);
    return () => clearTimeout(timer);
  }, [lockedZoneNotice]);
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
  // ダブルクリック移動の目的地(マップ座標)。表示に使わないためReactの
  // stateではなくrefだけで持つ。矢印キー/タッチ操作(=keysDownに何か
  // 入っている状態)が入力されたら即座にnullへ戻し、通常操作を優先する。
  const autoMoveTargetRef = useRef<{ x: number; y: number } | null>(null);
  // assetsReady stateの最新値をRAFループ(effect外)から読むためのref。
  const assetsReadyRef = useRef(false);
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
  // 相手ごとに「直近で位置broadcastを受信した時刻」を記録する。在室状況の
  // 自己修復(下のsuspectedGoneRef)が、実際には動いていて頻繁にbroadcastを
  // 送ってきている相手をpresenceスナップショットの瞬間的な欠落だけで
  // 誤って「不在」と判定しないようにするための参照。
  const lastMoveAtRef = useRef<Map<string, number>>(new Map());
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
            .select(
              "id, sender_user_id, message, created_at, edited_at, deleted_at, image_path, chat_message_reactions(user_id, emoji)",
            )
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
        setDmError(
          `チャット履歴の取得に失敗しました(${error.message ?? error.code ?? "不明なエラー"})`,
        );
        return;
      }
      const rows = (data ?? []) as Array<{
        id: string;
        sender_user_id: string;
        message: string;
        created_at: string;
        edited_at: string | null;
        deleted_at: string | null;
        image_path: string | null;
        chat_message_reactions?: Array<{ user_id: string; emoji: string }>;
      }>;
      // viewOnly(招待URLの一時ゲスト)は通常のRLS経由でchat_message_
      // reactionsを埋め込みSELECTできない(9f-5のコメント参照)ため、
      // メッセージ本体の取得後にトークン検証付きの別RPCでまとめて取得し、
      // メッセージIDをキーに突き合わせる。
      const reactionsByMessageId = new Map<
        string,
        Array<{ user_id: string; emoji: string }>
      >();
      if (viewOnlyInviteToken) {
        const messageIds = rows.map((row) => row.id);
        if (messageIds.length > 0) {
          const { data: reactionRows, error: reactionError } =
            await supabase.rpc("list_chat_message_reactions_by_invite_token", {
              token: viewOnlyInviteToken,
              p_message_ids: messageIds,
            });
          if (reactionError) {
            // eslint-disable-next-line no-console
            console.error("リアクションの取得に失敗しました", reactionError);
          } else {
            for (const r of (reactionRows ?? []) as Array<{
              message_id: string;
              user_id: string;
              emoji: string;
            }>) {
              const list = reactionsByMessageId.get(r.message_id) ?? [];
              list.push({ user_id: r.user_id, emoji: r.emoji });
              reactionsByMessageId.set(r.message_id, list);
            }
          }
        }
      }
      if (cancelled) return;
      const messages: DmMessage[] = (
        viewOnlyInviteToken ? rows : rows.slice().reverse()
      )
        // 削除済みメッセージは一覧に表示しない(吹き出し自体を残さない)。
        .filter((row) => !row.deleted_at)
        .map((row) => ({
          id: row.id,
          senderUserId: row.sender_user_id,
          isSelf: row.sender_user_id === myUserId,
          message: row.message,
          createdAt: row.created_at,
          editedAt: row.edited_at,
          deletedAt: row.deleted_at,
          imagePath: row.image_path,
          reactions: (
            viewOnlyInviteToken
              ? (reactionsByMessageId.get(row.id) ?? [])
              : (row.chat_message_reactions ?? [])
          ).map((r) => ({ userId: r.user_id, emoji: r.emoji })),
        }));
      dmForceScrollRef.current = true;
      setDmThreads((prev) => ({ ...prev, [selectedPeerUserId]: messages }));
      // スレッドを開いたので未読を消す(ローカル表示用)。
      setUnreadFromPeers((prev) =>
        prev[selectedPeerUserId] ? { ...prev, [selectedPeerUserId]: 0 } : prev,
      );
      // タブの未読合計バッジを、スレッドを開いた時点で即座に反映する
      // (以前は一覧の再取得タイミング任せで、開いてもすぐには減らなかった)。
      setChatThreads((prev) =>
        prev.map((t) =>
          !t.isGroup && t.threadId === selectedPeerUserId
            ? { ...t, unreadCount: 0 }
            : t,
        ),
      );
      // 既読位置をサーバー側にも保存する(ログインし直しても未読数が
      // 保持されるようにするため)。chat_read_stateのRLSはuser_id=
      // auth.uid()のみで判定しておりアカウント所属を問わないため、
      // viewOnlyでもそのまま呼べる(2026-08-30修正: 以前はここを
      // viewOnly除外していたため、viewOnlyでは開いても未読数が
      // 減らない不具合になっていた)。
      supabase
        .rpc("mark_chat_thread_read", {
          p_room_id: roomId,
          p_peer_user_id: selectedPeerUserId,
        })
        .then(({ error: markError }) => {
          if (markError) {
            // eslint-disable-next-line no-console
            console.error("既読位置の保存に失敗しました", markError);
          }
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [joined, roomId, supabase, viewOnlyInviteToken, selectedPeerUserId]);

  // ---- チャット:選択中のグループスレッドを読み込む ----
  // グループのSELECT/INSERT RLSはchat_group_members.user_id=auth.uid()
  // のみで判定しており、profiles経由のアカウント所属は問わないため、
  // viewOnly(招待URL経由の一時閲覧。profiles.account_idを書き換えない
  // 設計)でも通常のクエリでそのまま読み書きできる(2026-08-30に判明・
  // 修正: 以前はここでviewOnlyを一律除外していたため、viewOnlyの人が
  // 招待されたグループのメッセージを一切見られなかった)。
  useEffect(() => {
    if (!joined || !selectedGroupId) return;
    let cancelled = false;
    const myUserId = authUserIdRef.current;
    // 通知からのメンションジャンプ待ちが無い、通常のスレッド新規オープン/
    // 再オープンの場合のみ、読み込み完了時に一番下へスクロールする。
    if (!pendingMentionScrollTargetRef.current) {
      groupForceScrollRef.current = true;
    }
    type MessageRow = {
      id: string;
      sender_user_id: string;
      sender_name: string;
      message: string;
      created_at: string;
      deleted_at: string | null;
      is_system: boolean;
      image_path: string | null;
      chat_message_reactions?: Array<{ user_id: string; emoji: string }>;
    };
    const selectCols =
      "id, sender_user_id, sender_name, message, created_at, deleted_at, is_system, image_path, chat_message_reactions(user_id, emoji)";
    (async () => {
      // 通知一覧からのジャンプ待ちがある場合、「直近50件」だと対象メッセージ
      // が範囲外(それより古い)のことがあるため、対象の送信時刻を基準に
      // 前後(前30件・後20件)をまとめて取得し、範囲内に必ず含めるように
      // する。通常時は従来通り「直近50件」を取得する。
      const anchor = pendingMentionScrollTargetRef.current;
      let rows: MessageRow[];
      if (anchor) {
        const [beforeRes, afterRes] = await Promise.all([
          supabase
            .from("chat_messages")
            .select(selectCols)
            .eq("room_id", roomId)
            .eq("group_id", selectedGroupId)
            .lte("created_at", anchor.createdAt)
            .order("created_at", { ascending: false })
            .limit(30),
          supabase
            .from("chat_messages")
            .select(selectCols)
            .eq("room_id", roomId)
            .eq("group_id", selectedGroupId)
            .gt("created_at", anchor.createdAt)
            .order("created_at", { ascending: true })
            .limit(20),
        ]);
        if (cancelled) return;
        if (beforeRes.error || afterRes.error) {
          // eslint-disable-next-line no-console
          console.error(
            "グループチャット履歴の取得に失敗しました",
            beforeRes.error ?? afterRes.error,
          );
          setGroupError("グループチャット履歴の取得に失敗しました。");
          return;
        }
        rows = [
          ...((beforeRes.data ?? []) as MessageRow[]).slice().reverse(),
          ...((afterRes.data ?? []) as MessageRow[]),
        ];
      } else {
        const { data, error } = await supabase
          .from("chat_messages")
          .select(selectCols)
          .eq("room_id", roomId)
          .eq("group_id", selectedGroupId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (cancelled) return;
        if (error) {
          // eslint-disable-next-line no-console
          console.error("グループチャット履歴の取得に失敗しました", error);
          setGroupError(
            `グループチャット履歴の取得に失敗しました(${error.message ?? error.code ?? "不明なエラー"})`,
          );
          return;
        }
        rows = ((data ?? []) as MessageRow[]).slice().reverse();
      }
      const messages: GroupMessage[] = rows
        .filter((row) => !row.deleted_at)
        .map((row) => ({
          id: row.id,
          senderUserId: row.sender_user_id,
          senderName: row.sender_name,
          isSelf: row.sender_user_id === myUserId,
          message: row.message,
          createdAt: row.created_at,
          deletedAt: row.deleted_at,
          isSystem: row.is_system,
          imagePath: row.image_path,
          reactions: (row.chat_message_reactions ?? []).map((r) => ({
            userId: r.user_id,
            emoji: r.emoji,
          })),
        }));
      setGroupThreads((prev) => ({ ...prev, [selectedGroupId]: messages }));
      // タブの未読合計バッジを、スレッドを開いた時点で即座に反映する
      // (以前は一覧の再取得タイミング任せで、開いてもすぐには減らなかった)。
      setChatThreads((prev) =>
        prev.map((t) =>
          t.isGroup && t.threadId === selectedGroupId
            ? { ...t, unreadCount: 0 }
            : t,
        ),
      );
      // chat_group_read_stateのRLSもuser_id=auth.uid()のみで判定して
      // おりアカウント所属を問わないため、viewOnlyでもそのまま呼べる
      // (2026-08-30修正: 前回viewOnly除外にしたのは誤りだった)。
      supabase
        .rpc("mark_chat_group_read", { p_group_id: selectedGroupId })
        .then(({ error: markError }) => {
          if (markError) {
            // eslint-disable-next-line no-console
            console.error("既読位置の保存に失敗しました", markError);
          }
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [joined, roomId, supabase, viewOnlyInviteToken, selectedGroupId]);

  // グループチャットのスクロール位置制御。groupForceScrollRefがtrueの
  // 間だけ一番下へスクロールしてフラグを消費する(DMのdmForceScrollRefと
  // 同じ考え方)。通知からのメンションジャンプ待ち・過去ログ閲覧中の新着
  // では立てないため、意図せず一番下へ戻されることが無い。
  useEffect(() => {
    if (!selectedGroupId) return;
    const el = groupScrollRef.current;
    if (!el) return;
    if (groupForceScrollRef.current) {
      groupForceScrollRef.current = false;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [selectedGroupId, groupThreads]);

  // ---- 通知一覧からのジャンプ:対象メッセージまでスクロール+一時強調 ----
  useEffect(() => {
    const target = pendingMentionScrollTargetRef.current;
    if (!target || !selectedGroupId) return;
    const thread = groupThreads[selectedGroupId];
    if (!thread || !thread.some((m) => m.id === target.messageId)) return;
    const targetId = target.messageId;
    pendingMentionScrollTargetRef.current = null;
    requestAnimationFrame(() => {
      groupBubbleRefs.current[targetId]?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    });
    setHighlightedGroupMessageId(targetId);
    const timer = window.setTimeout(
      () => setHighlightedGroupMessageId(null),
      2000,
    );
    return () => window.clearTimeout(timer);
  }, [groupThreads, selectedGroupId]);

  // ---- グループチャット:@メンション用のメンバー表示名一覧を取得する ----
  useEffect(() => {
    if (!joined || !selectedGroupId) {
      setGroupMembers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc(
        "list_chat_group_member_names",
        { p_group_id: selectedGroupId },
      );
      if (cancelled) return;
      if (error) {
        // eslint-disable-next-line no-console
        console.error("グループメンバー一覧の取得に失敗しました", error);
        return;
      }
      setGroupMembers(
        (data ?? []).map(
          (row: { user_id: string; display_name: string }) => ({
            userId: row.user_id,
            displayName: row.display_name,
          }),
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [joined, selectedGroupId, supabase]);

  // ---- チャットタブ:やり取りした相手ごとの最新メッセージ一覧を読み込む ----
  // 個別スレッドを開いていない間、常に取得する(以前はsidebarTab==="chat"
  // の間だけに限定していたため、参加者/設定タブを見ている間に来た新着は
  // chatThreadsRefreshTriggerが増えても再取得されず、「チャット」タブの
  // 未読バッジがリアルタイムに反映されない不具合があった。2026-09-02
  // 報告)。新着DM/グループDM受信時にはchatThreadsRefreshTriggerを介して
  // 再取得する(未読数・並び順を最新化)。
  useEffect(() => {
    if (!joined) return;
    if (selectedPeerUserId || selectedGroupId) return;
    let cancelled = false;
    setChatThreadsLoading(true);
    setChatThreadsError(null);
    (async () => {
      // viewOnly(自分のアカウントを持つ人が他人の招待URLを一時閲覧中)は
      // profiles.account_idがこのアカウントを指さないため、通常の
      // list_chat_threadsではDM・グループどちらも常に0件になっていた
      // (2026-08-30修正)。招待トークンを検証するSECURITY DEFINER関数
      // 経由で取得する(list_chat_messages_by_invite_tokenと同じ考え方)。
      const { data, error } = viewOnlyInviteToken
        ? await supabase.rpc("list_chat_threads_by_invite_token", {
            token: viewOnlyInviteToken,
            target_room_id: roomId,
          })
        : await supabase.rpc("list_chat_threads", {
            p_room_id: roomId,
          });
      if (cancelled) return;
      setChatThreadsLoading(false);
      if (error) {
        // eslint-disable-next-line no-console
        console.error("チャット一覧の取得に失敗しました", error);
        setChatThreadsError(
          `チャット一覧の取得に失敗しました(${error.message ?? error.code ?? "不明なエラー"})`,
        );
        return;
      }
      const rows = (data ?? []) as Array<{
        thread_id: string;
        is_group: boolean;
        thread_name: string;
        last_message: string;
        last_message_at: string;
        unread_count: number;
      }>;
      setChatThreads(
        rows.map((row) => ({
          threadId: row.thread_id,
          isGroup: row.is_group,
          threadName: row.thread_name,
          lastMessage: row.last_message,
          lastMessageAt: row.last_message_at,
          unreadCount: row.unread_count,
        })),
      );
      myGroupIdsRef.current = new Set(
        rows.filter((row) => row.is_group).map((row) => row.thread_id),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [
    joined,
    roomId,
    supabase,
    viewOnlyInviteToken,
    selectedPeerUserId,
    selectedGroupId,
    chatThreadsRefreshTrigger,
  ]);

  // ---- 通知:@メンション一覧を取得する ----
  // chat_mentionsのSELECT RLSはmentioned_user_id=auth.uid()のみで判定して
  // おりアカウント所属を問わないため、viewOnlyでもそのまま呼べる。
  useEffect(() => {
    if (!joined) return;
    const myUserId = authUserIdRef.current;
    if (!myUserId) return;
    let cancelled = false;
    setMentionsLoading(true);
    setMentionsError(null);
    (async () => {
      const { data, error } = await supabase
        .from("chat_mentions")
        .select(
          "id, message_id, group_id, mentioner_user_id, mentioner_name, is_everyone, created_at, read_at, chat_groups(name)",
        )
        .eq("mentioned_user_id", myUserId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (error) {
        setMentionsLoading(false);
        // eslint-disable-next-line no-console
        console.error("通知の取得に失敗しました", error);
        setMentionsError(
          `通知の取得に失敗しました(${error.message ?? error.code ?? "不明なエラー"})`,
        );
        return;
      }
      const rows = (data ?? []) as Array<{
        id: string;
        message_id: string;
        group_id: string;
        mentioner_user_id: string;
        mentioner_name: string;
        is_everyone: boolean;
        created_at: string;
        read_at: string | null;
        chat_groups: Array<{ name: string | null }> | null;
      }>;
      // メッセージ本文・正確な送信時刻は、chat_mentionsからの埋め込み
      // SELECTだと(関係が正しく解決されず)確実に取れなかったため、
      // メッセージIDをまとめて渡す別クエリで取得して突き合わせる
      // (グループスレッド読み込みと同じ、素朴な.from("chat_messages")
      // クエリなので確実に動く)。
      const messageIds = Array.from(new Set(rows.map((r) => r.message_id)));
      const messageById = new Map<
        string,
        { created_at: string; message: string }
      >();
      if (messageIds.length > 0) {
        const { data: messageRows, error: messageError } = await supabase
          .from("chat_messages")
          .select("id, created_at, message")
          .in("id", messageIds);
        if (cancelled) return;
        if (messageError) {
          // eslint-disable-next-line no-console
          console.error("通知本文の取得に失敗しました", messageError);
        } else {
          for (const m of (messageRows ?? []) as Array<{
            id: string;
            created_at: string;
            message: string;
          }>) {
            messageById.set(m.id, {
              created_at: m.created_at,
              message: m.message,
            });
          }
        }
      }
      // メンションしてきた相手の表示名は、chat_mentions.mentioner_nameだと
      // 送信時点のスナップショットのままで、後から表示名を変えても通知
      // 一覧の表示は古いままだった(2026-09報告)。list_mentioner_names経由
      // (自分宛てのメンションで実際に名前が出たことのある相手に限定した
      // SECURITY DEFINER関数。profilesは本人しかSELECTできないRLSのため
      // 直接は取得できない)で最新のdisplay_nameを取得し、優先的に使う。
      // 取得できなかった相手(関数エラー等)のみスナップショットを使う。
      const mentionerUserIds = Array.from(
        new Set(rows.map((r) => r.mentioner_user_id)),
      );
      const mentionerNameById = new Map<string, string>();
      if (mentionerUserIds.length > 0) {
        const { data: mentionerRows, error: mentionerError } =
          await supabase.rpc("list_mentioner_names", {
            p_mentioner_user_ids: mentionerUserIds,
          });
        if (cancelled) return;
        if (mentionerError) {
          // eslint-disable-next-line no-console
          console.error("メンション相手の表示名取得に失敗しました", mentionerError);
        } else {
          for (const m of (mentionerRows ?? []) as Array<{
            user_id: string;
            display_name: string;
          }>) {
            mentionerNameById.set(m.user_id, m.display_name);
          }
        }
      }
      setMentionsLoading(false);
      setMentions(
        rows.map((row) => {
          const message = messageById.get(row.message_id);
          return {
            id: row.id,
            messageId: row.message_id,
            groupId: row.group_id,
            groupName: row.chat_groups?.[0]?.name ?? "グループ",
            mentionerName:
              mentionerNameById.get(row.mentioner_user_id) ??
              row.mentioner_name,
            isEveryone: row.is_everyone,
            createdAt: row.created_at,
            readAt: row.read_at,
            messageCreatedAt: message?.created_at ?? row.created_at,
            messagePreview: message?.message ?? "",
          };
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [joined, supabase, mentionsRefreshTrigger]);

  // 通知タップ:既読化してから、対象グループスレッドの該当メッセージへ
  // ジャンプする。
  const handleMentionClick = useCallback(
    (mention: MentionNotification) => {
      if (!mention.readAt) {
        setMentions((prev) =>
          prev.map((m) =>
            m.id === mention.id ? { ...m, readAt: new Date().toISOString() } : m,
          ),
        );
        supabase
          .from("chat_mentions")
          .update({ read_at: new Date().toISOString() })
          .eq("id", mention.id)
          .then(({ error }) => {
            if (error) {
              // eslint-disable-next-line no-console
              console.error("通知の既読化に失敗しました", error);
            }
          });
      }
      pendingMentionScrollTargetRef.current = {
        messageId: mention.messageId,
        createdAt: mention.messageCreatedAt,
      };
      setSelectedPeerUserId(null);
      setSelectedGroupId(mention.groupId);
      setSidebarTab("chat");
    },
    [supabase],
  );

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

  // テキスト送信・画像送信で共通の本体部分(RLS/viewOnlyの2経路振り分け・
  // ローカル反映・Realtime配信)。戻り値は送信に成功したかどうか
  // (呼び出し元が失敗時に入力欄の文面を復元できるように)。
  const postDmMessage = useCallback(
    async (text: string, imagePath: string | null) => {
      const peerUserId = selectedPeerUserId;
      if ((!text && !imagePath) || !selfState.current || !peerUserId || dmSending) {
        return false;
      }
      const senderName = selfState.current.name;
      const myUserId = authUserIdRef.current;
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
                  message: text,
                  p_image_path: imagePath,
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
                message: text,
                image_path: imagePath,
              })
              .select("id, created_at")
              .single();
        if (error || !data || !myUserId) {
          // eslint-disable-next-line no-console
          console.error("チャットメッセージの送信に失敗しました", error);
          setDmError("送信に失敗しました。時間をおいて再度お試しください。");
          return false;
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
              message: text,
              createdAt: data.created_at,
              editedAt: null,
              deletedAt: null,
              imagePath,
              reactions: [],
            },
          ],
        }));
        channelRef.current?.httpSend("dm", {
          id: data.id,
          originId: selfId.current,
          senderUserId: myUserId,
          recipientUserId: peerUserId,
          senderName,
          message: text,
          createdAt: data.created_at,
          imagePath,
        });
        return true;
      } catch (err) {
        // 2026-09 QA指摘: 以前はcatchが無く、送信処理中に例外が発生すると
        // (Supabaseクライアント側の想定外の例外等)エラーメッセージが
        // 一切表示されないまま呼び出し元へ例外が伝播し、入力欄の文面も
        // 復元されない経路があった。
        // eslint-disable-next-line no-console
        console.error("チャットメッセージの送信に失敗しました", err);
        setDmError("送信に失敗しました。時間をおいて再度お試しください。");
        return false;
      } finally {
        setDmSending(false);
      }
    },
    [dmSending, roomId, selectedPeerUserId, supabase, viewOnlyInviteToken],
  );

  // グループチャットの送信(画像添付・編集・削除は1対1と異なり非対応)。
  // グループのINSERT RLSはchat_group_members.user_id=auth.uid()のみで
  // 判定しており、profiles経由のアカウント所属は問わないため、viewOnly
  // でもそのままこのINSERTが通る(トークン検証の専用RPCは不要)。
  // テキスト送信・画像送信で共通の本体部分(postDmMessageと同じ考え方)。
  const postGroupMessage = useCallback(
    async (text: string, imagePath: string | null) => {
      const groupId = selectedGroupId;
      if (
        (!text && !imagePath) ||
        !selfState.current ||
        !groupId ||
        groupSending
      ) {
        return false;
      }
      const senderName = selfState.current.name;
      const myUserId = authUserIdRef.current;
      if (!myUserId) return false;
      setGroupError(null);
      setGroupSending(true);
      try {
        const { data, error } = await supabase
          .from("chat_messages")
          .insert({
            room_id: roomId,
            sender_user_id: myUserId,
            group_id: groupId,
            sender_name: senderName,
            message: text,
            image_path: imagePath,
          })
          .select("id, created_at")
          .single();
        if (error || !data) {
          // eslint-disable-next-line no-console
          console.error("グループメッセージの送信に失敗しました", error);
          setGroupError("送信に失敗しました。時間をおいて再度お試しください。");
          return false;
        }
        groupForceScrollRef.current = true;
        setGroupThreads((prev) => ({
          ...prev,
          [groupId]: [
            ...(prev[groupId] ?? []),
            {
              id: data.id,
              senderUserId: myUserId,
              senderName,
              isSelf: true,
              message: text,
              createdAt: data.created_at,
              deletedAt: null,
              isSystem: false,
              imagePath,
              reactions: [],
            },
          ],
        }));
        channelRef.current?.httpSend("group-dm", {
          id: data.id,
          originId: selfId.current,
          groupId,
          senderUserId: myUserId,
          senderName,
          message: text,
          createdAt: data.created_at,
          isSystem: false,
          imagePath,
        });
        // @メンション(@全員/@メンバー表示名)を含む場合、通知を作成する。
        // 表示上のハイライト(renderTextWithMentions)と対になる
        // extractGroupMentionsで判定するため、色が付いた部分=通知が
        // 作られる部分が常に一致する。
        if (text) {
          const { everyone, userIds } = extractGroupMentions(
            text,
            groupMembers,
          );
          if (everyone || userIds.length > 0) {
            const { error: mentionError } = await supabase.rpc(
              "create_chat_mentions",
              {
                p_message_id: data.id,
                p_group_id: groupId,
                p_mentioner_name: senderName,
                p_mention_everyone: everyone,
                p_mentioned_user_ids: userIds,
              },
            );
            if (mentionError) {
              // eslint-disable-next-line no-console
              console.error("メンション通知の作成に失敗しました", mentionError);
            } else {
              channelRef.current?.httpSend("mention", {
                originId: selfId.current,
                groupId,
                everyone,
                mentionedUserIds: userIds,
              });
            }
          }
        }
        setChatThreadsRefreshTrigger((n) => n + 1);
        return true;
      } catch (err) {
        // 2026-09 QA指摘: postDmMessageと同じ理由でcatchを追加(想定外の
        // 例外発生時にエラー表示なしで入力内容が失われるのを防ぐ)。
        // eslint-disable-next-line no-console
        console.error("グループメッセージの送信に失敗しました", err);
        setGroupError("送信に失敗しました。時間をおいて再度お試しください。");
        return false;
      } finally {
        setGroupSending(false);
      }
    },
    [groupSending, roomId, selectedGroupId, supabase, groupMembers],
  );

  // グループチャット作成モーダルの「作成」ボタン。
  const handleCreateGroup = useCallback(async () => {
    if (createGroupSelectedIds.size === 0 || creatingGroup) return;
    const myUserId = authUserIdRef.current;
    setCreatingGroup(true);
    setCreateGroupError(null);
    try {
      const memberUserIds = Array.from(createGroupSelectedIds);
      // viewOnly(自分のアカウントを持つ人が他人の招待URLを一時閲覧中)は
      // profiles.account_idがこのアカウントを指さないため、通常の
      // create_chat_groupでは「このルームへのアクセス権がありません」に
      // なる(2026-08-30修正)。招待トークンを検証する別ルート経由にする。
      // どちらも、自分を含めた選択メンバーの集合が完全一致する既存の
      // グループがあれば新規作成せずalready_existed:trueで返す
      // (2026-08-30追加。重複作成防止)。
      const { data, error } = viewOnlyInviteToken
        ? await supabase
            .rpc("create_chat_group_by_invite_token", {
              token: viewOnlyInviteToken,
              target_room_id: roomId,
              p_member_user_ids: memberUserIds,
            })
            .single()
        : await supabase
            .rpc("create_chat_group", {
              p_room_id: roomId,
              p_member_user_ids: memberUserIds,
            })
            .single();
      if (error || !data) {
        // eslint-disable-next-line no-console
        console.error("グループチャットの作成に失敗しました", error);
        setCreateGroupError(
          "作成に失敗しました。時間をおいて再度お試しください。",
        );
        return;
      }
      const result = data as { group_id: string; already_existed: boolean };
      if (result.already_existed) {
        setCreateGroupError("選択メンバーとのチャットはすでに作成済です");
        return;
      }
      const newGroupId = result.group_id;
      myGroupIdsRef.current.add(newGroupId);
      setShowCreateGroupModal(false);
      setCreateGroupSelectedIds(new Set());
      setSelectedPeerUserId(null);
      setSelectedGroupId(newGroupId);
      setChatThreadsRefreshTrigger((n) => n + 1);
      // 招待した他のメンバーへ、新規グループ作成をリアルタイムで知らせる
      // (これが無いと、メッセージが1件も無い間は相手の一覧に表示されず、
      // 相手が気づかずグループを重複作成してしまう不具合があった)。
      if (myUserId) {
        channelRef.current?.httpSend("group-created", {
          originId: selfId.current,
          groupId: newGroupId,
          memberUserIds,
        });
      }
    } finally {
      setCreatingGroup(false);
    }
  }, [
    createGroupSelectedIds,
    creatingGroup,
    roomId,
    supabase,
    viewOnlyInviteToken,
  ]);

  // グループ名変更。メンバーなら誰でも変更できる。
  const handleRenameGroupSave = useCallback(async () => {
    if (!renamingGroupId || renamingGroupSaving) return;
    const groupId = renamingGroupId;
    const trimmedName = renameGroupInput.trim();
    setRenamingGroupSaving(true);
    setRenameGroupError(null);
    try {
      const { error } = await supabase.rpc("rename_chat_group", {
        p_group_id: groupId,
        p_name: renameGroupInput,
      });
      if (error) {
        // eslint-disable-next-line no-console
        console.error("グループ名の変更に失敗しました", error);
        setRenameGroupError(
          "変更に失敗しました。時間をおいて再度お試しください。",
        );
        return;
      }
      setRenamingGroupId(null);
      // 他のメンバーへリアルタイムで反映する。空欄保存(=自動生成名に
      // 戻す)の場合、フォールバック名の計算はサーバー(list_chat_threads)
      // に委ねるため、自分・相手ともに一覧を再取得させるだけにする。
      if (trimmedName) {
        setChatThreads((prev) =>
          prev.map((t) =>
            t.isGroup && t.threadId === groupId
              ? { ...t, threadName: trimmedName }
              : t,
          ),
        );
      } else {
        setChatThreadsRefreshTrigger((n) => n + 1);
      }
      channelRef.current?.httpSend("group-renamed", {
        originId: selfId.current,
        groupId,
        name: trimmedName || null,
      });
    } finally {
      setRenamingGroupSaving(false);
    }
  }, [renamingGroupId, renameGroupInput, renamingGroupSaving, supabase]);

  // グループからの退出(メンバーなら誰でも可能。ハードデリートではなく、
  // LINE/Teams等と同様「自分の画面から消え、他のメンバーには退出通知
  // メッセージだけが残る」挙動にする。他のメンバーへは通常のグループ
  // メッセージ(is_system:true)として配信するため、group-dmイベントを
  // そのまま使う(専用のgroup-deletedイベントは廃止した)。
  const handleLeaveGroupConfirm = useCallback(async () => {
    if (!leavingGroupId || leavingGroupBusy) return;
    const groupId = leavingGroupId;
    setLeavingGroupBusy(true);
    setLeaveGroupError(null);
    try {
      const { data, error } = await supabase
        .rpc("leave_chat_group", { p_group_id: groupId })
        .single();
      if (error || !data) {
        // eslint-disable-next-line no-console
        console.error("グループからの退出に失敗しました", error);
        setLeaveGroupError(
          "退出に失敗しました。時間をおいて再度お試しください。",
        );
        return;
      }
      const leftMessage = data as {
        id: string;
        created_at: string;
        message: string;
        sender_name: string;
        deleted_image_paths: string[] | null;
      };
      channelRef.current?.httpSend("group-dm", {
        id: leftMessage.id,
        originId: selfId.current,
        groupId,
        senderUserId: authUserIdRef.current,
        senderName: leftMessage.sender_name,
        message: leftMessage.message,
        createdAt: leftMessage.created_at,
        isSystem: true,
      });
      myGroupIdsRef.current.delete(groupId);
      setChatThreads((prev) => prev.filter((t) => t.threadId !== groupId));
      setGroupThreads((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
      if (selectedGroupId === groupId) {
        setSelectedGroupId(null);
      }
      setLeavingGroupId(null);
      // 自分が最後のメンバーで、グループごと削除された場合、DBの行は
      // leave_chat_group側でcascade削除済みだが、添付画像のStorage実体は
      // SQLのDELETEだけでは消えないため、ここでService Role経由の
      // 削除APIを呼ぶ(cronの保管期間切れ削除と同じ理由・同じ方針)。
      if (
        leftMessage.deleted_image_paths &&
        leftMessage.deleted_image_paths.length > 0
      ) {
        fetch("/api/chat/cleanup-group-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imagePaths: leftMessage.deleted_image_paths,
          }),
        }).catch((err) => {
          // eslint-disable-next-line no-console
          console.error("グループ画像のクリーンアップに失敗しました", err);
        });
      }
    } finally {
      setLeavingGroupBusy(false);
    }
  }, [leavingGroupId, leavingGroupBusy, selectedGroupId, supabase]);

  // グループの右クリックメニューは、開いている間だけ外側クリック/スクロール
  // で閉じるようにする。
  useEffect(() => {
    if (!groupContextMenu) return;
    const close = () => setGroupContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [groupContextMenu]);

  // 添付中の画像を1件、idを指定して取り消す。プレビュー用のオブジェクトURLは
  // 明示的に解放しないとリークするため、必ずこの関数経由でクリアする。
  const cancelDmPendingImage = useCallback((id: string) => {
    setDmPendingImages((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  // 添付中の画像をすべて取り消す(相手切り替え時・送信成功時に使う)。
  const cancelAllDmPendingImages = useCallback(() => {
    setDmPendingImages((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return [];
    });
  }, []);

  // 画像ボタン/ドラッグ&ドロップ/クリップボード貼り付けのいずれからも
  // 呼ばれる共通の添付処理。この時点ではアップロードは行わず、
  // バリデーションと当日の上限事前確認(既に溜まっている枚数も含める。
  // 最終判定は送信時のサーバー側で行う)だけ済ませ、送信前プレビューに
  // 追加する。複数ファイルを渡した場合、上限に達した時点で以降は
  // 追加せずエラー表示する。実際のアップロード・圧縮はsendDmMessageが
  // 送信操作のタイミングでまとめて行う。
  const stageDmImages = useCallback(
    async (files: File[]) => {
      if (dmImageUploading || files.length === 0) return;

      const { data: currentCount } = await supabase.rpc(
        "get_daily_image_upload_count",
      );
      // 1日のアップロード上限はDM・グループ共通(ユーザー単位)のため、
      // 両方の添付中件数を差し引く。
      let remaining =
        DAILY_IMAGE_UPLOAD_LIMIT -
        (currentCount ?? 0) -
        dmPendingImages.length -
        groupPendingImages.length;

      setDmError(null);
      // 画像を添付した時点で編集モードは抜ける(「更新」ボタンに送信操作が
      // 奪われ、添付画像がいつまでも送信されない状態になるのを避けるため)。
      if (dmEditingMessageId) {
        setDmEditingMessageId(null);
        setDmInput("");
      }

      const staged: DmPendingImage[] = [];
      for (const file of files) {
        const validationError = validateChatImageFile(file);
        if (validationError) {
          setDmError(validationError);
          break;
        }
        if (remaining <= 0) {
          setDmError(`1日アップロード上限${DAILY_IMAGE_UPLOAD_LIMIT}枚までです`);
          break;
        }
        const previewUrl = URL.createObjectURL(file);
        const dims = await new Promise<
          { width: number; height: number } | null
        >((resolve) => {
          const img = new window.Image();
          img.onload = () =>
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = () => resolve(null);
          img.src = previewUrl;
        });
        staged.push({
          id: crypto.randomUUID(),
          file,
          previewUrl,
          width: dims?.width,
          height: dims?.height,
        });
        remaining -= 1;
      }

      if (staged.length > 0) {
        setDmPendingImages((prev) => [...prev, ...staged]);
      }
    },
    [
      dmImageUploading,
      dmPendingImages.length,
      groupPendingImages.length,
      dmEditingMessageId,
      supabase,
    ],
  );

  const cancelGroupPendingImage = useCallback((id: string) => {
    setGroupPendingImages((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const cancelAllGroupPendingImages = useCallback(() => {
    setGroupPendingImages((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return [];
    });
  }, []);

  // グループチャット版の添付処理(stageDmImagesと同じ考え方。1日の上限は
  // DM・グループ共通のため、両方の添付中件数を差し引いて判定する)。
  const stageGroupImages = useCallback(
    async (files: File[]) => {
      if (groupImageUploading || files.length === 0) return;

      const { data: currentCount } = await supabase.rpc(
        "get_daily_image_upload_count",
      );
      let remaining =
        DAILY_IMAGE_UPLOAD_LIMIT -
        (currentCount ?? 0) -
        dmPendingImages.length -
        groupPendingImages.length;

      setGroupError(null);

      const staged: DmPendingImage[] = [];
      for (const file of files) {
        const validationError = validateChatImageFile(file);
        if (validationError) {
          setGroupError(validationError);
          break;
        }
        if (remaining <= 0) {
          setGroupError(`1日アップロード上限${DAILY_IMAGE_UPLOAD_LIMIT}枚までです`);
          break;
        }
        const previewUrl = URL.createObjectURL(file);
        const dims = await new Promise<
          { width: number; height: number } | null
        >((resolve) => {
          const img = new window.Image();
          img.onload = () =>
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = () => resolve(null);
          img.src = previewUrl;
        });
        staged.push({
          id: crypto.randomUUID(),
          file,
          previewUrl,
          width: dims?.width,
          height: dims?.height,
        });
        remaining -= 1;
      }

      if (staged.length > 0) {
        setGroupPendingImages((prev) => [...prev, ...staged]);
      }
    },
    [
      groupImageUploading,
      dmPendingImages.length,
      groupPendingImages.length,
      supabase,
    ],
  );

  // 相手を切り替えたら、添付中の画像は宛先違いの誤送信を避けるため破棄する。
  useEffect(() => {
    cancelAllDmPendingImages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeerUserId]);

  // グループを切り替えたら同様に破棄する。
  useEffect(() => {
    cancelAllGroupPendingImages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupId]);

  // グループメッセージへの絵文字リアクション選択。DMのhandleDmReaction
  // Selectと同じ「同じ絵文字なら取り消し・別の絵文字なら上書き」の
  // ロジックだが、グループのメッセージ読み書きは(グループRLSがアカウント
  // 所属を問わないため)viewOnlyかどうかで経路を分ける必要が無い点が
  // DM向けと異なる(9f-3bのコメント、および[[handleDmReactionSelect]]と
  // 同じ考え方)。
  const handleGroupReactionSelect = useCallback(
    async (m: GroupMessage, emoji: string) => {
      const groupId = selectedGroupId;
      const myUserId = authUserIdRef.current;
      if (!groupId || !myUserId) return;
      const previousEmoji =
        m.reactions.find((r) => r.userId === myUserId)?.emoji ?? null;
      const removing = previousEmoji === emoji;
      const nextEmoji = removing ? null : emoji;

      const applyLocally = (targetEmoji: string | null) => {
        setGroupThreads((prev) => ({
          ...prev,
          [groupId]: (prev[groupId] ?? []).map((msg) =>
            msg.id !== m.id
              ? msg
              : {
                  ...msg,
                  reactions: targetEmoji
                    ? [
                        ...msg.reactions.filter((r) => r.userId !== myUserId),
                        { userId: myUserId, emoji: targetEmoji },
                      ]
                    : msg.reactions.filter((r) => r.userId !== myUserId),
                },
          ),
        }));
      };
      applyLocally(nextEmoji);
      setGroupMessageContextMenu(null);

      const { error } = removing
        ? await supabase
            .from("chat_message_reactions")
            .delete()
            .eq("message_id", m.id)
            .eq("user_id", myUserId)
        : await supabase
            .from("chat_message_reactions")
            .upsert(
              { message_id: m.id, user_id: myUserId, emoji },
              { onConflict: "message_id,user_id" },
            );

      if (error) {
        // eslint-disable-next-line no-console
        console.error("リアクションの更新に失敗しました", error);
        applyLocally(previousEmoji);
        setGroupError("リアクションの更新に失敗しました。");
        return;
      }

      channelRef.current?.httpSend("group-reaction", {
        originId: selfId.current,
        messageId: m.id,
        groupId,
        reactorUserId: myUserId,
        emoji: nextEmoji,
      });
    },
    [selectedGroupId, supabase],
  );

  // 入力欄の高さをテキスト量に合わせて自動調整する(複数行になっても
  // 全体が見えるように)。最大高さは超えたらテキストエリア自体の
  // スクロールに任せる。
  const autoResizeGroupInput = useCallback(() => {
    const el = groupInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    autoResizeGroupInput();
  }, [groupInput, autoResizeGroupInput]);

  // 入力欄の内容が変わるたびに、カーソル直前が「(先頭or空白)+@+空白を
  // 含まない文字列」になっていないか調べ、なっていれば@メンション候補
  // ポップアップの状態(どこからの「@」か・現在の絞り込み文字列)を
  // セットする。
  const handleGroupInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setGroupInput(value);
      const cursor = e.target.selectionStart ?? value.length;
      const beforeCursor = value.slice(0, cursor);
      const match = /(?:^|\s)@([^\s@]*)$/.exec(beforeCursor);
      if (match) {
        setGroupMentionQuery({
          start: beforeCursor.lastIndexOf("@"),
          query: match[1],
        });
      } else {
        setGroupMentionQuery(null);
      }
    },
    [],
  );

  // @メンション候補ポップアップに出す一覧。「全員」を常に先頭に置き、
  // 絞り込み文字列(@の後に続けて打った文字)で表示名を前方一致以外も
  // 含めた部分一致でフィルタする。
  const groupMentionCandidates = groupMentionQuery
    ? [
        { key: "__everyone__", label: "全員" },
        ...groupMembers.map((m) => ({ key: m.userId, label: m.displayName })),
      ].filter((c) =>
        c.label.toLowerCase().includes(groupMentionQuery.query.toLowerCase()),
      )
    : [];

  // 候補を選択:カーソル直前の「@絞り込み文字列」部分を「@表示名 」で
  // 置き換え、カーソルをその直後へ戻す。
  const selectGroupMentionCandidate = useCallback(
    (label: string) => {
      if (!groupMentionQuery) return;
      const el = groupInputRef.current;
      const cursor = el?.selectionStart ?? groupInput.length;
      const before = groupInput.slice(0, groupMentionQuery.start);
      const after = groupInput.slice(cursor);
      const inserted = `@${label} `;
      const next = before + inserted + after;
      setGroupInput(next);
      setGroupMentionQuery(null);
      const nextCursor = before.length + inserted.length;
      requestAnimationFrame(() => {
        const target = groupInputRef.current;
        if (!target) return;
        target.focus();
        target.setSelectionRange(nextCursor, nextCursor);
        autoResizeGroupInput();
      });
    },
    [groupMentionQuery, groupInput, autoResizeGroupInput],
  );

  const sendGroupMessage = useCallback(async () => {
    const text = groupInput.trim();
    const pending = groupPendingImages;
    if (
      (!text && pending.length === 0) ||
      groupSending ||
      groupImageUploading
    ) {
      return;
    }

    setGroupInput("");
    setGroupMentionQuery(null);
    setGroupError(null);

    // 複数画像は、chat_messagesのスキーマ上1メッセージにつき画像は1枚のため、
    // 1枚ずつ順番にメッセージとして送る(sendDmMessageと同じ考え方)。
    const imagePaths: string[] = [];
    if (pending.length > 0) {
      const myUserId = authUserIdRef.current;
      if (!myUserId) return;
      setGroupImageUploading(true);
      try {
        for (let i = 0; i < pending.length; i++) {
          const p = pending[i];
          setGroupUploadProgress({
            index: i,
            total: pending.length,
            percent: 0,
            phase: "uploading",
          });
          const rawPath = await uploadRawChatImageWithProgress(
            p.file,
            myUserId,
            (percent) =>
              setGroupUploadProgress({
                index: i,
                total: pending.length,
                percent,
                phase: "uploading",
              }),
          );
          setGroupUploadProgress({
            index: i,
            total: pending.length,
            percent: 100,
            phase: "compressing",
          });
          const res = await fetch("/api/chat/compress-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rawPath,
              roomId,
              inviteToken: viewOnlyInviteToken ?? undefined,
            }),
          });
          const json = await res.json();
          if (!res.ok) {
            setGroupError(json.error ?? "画像のアップロードに失敗しました");
            setGroupInput(text);
            return;
          }
          imagePaths.push(json.imagePath as string);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("画像添付メッセージの送信に失敗しました", err);
        setGroupError(
          "画像のアップロードに失敗しました。時間をおいて再度お試しください。",
        );
        setGroupInput(text);
        return;
      } finally {
        setGroupImageUploading(false);
        setGroupUploadProgress(null);
      }
    }

    if (imagePaths.length === 0) {
      const ok = await postGroupMessage(text, null);
      if (!ok) setGroupInput(text);
      return;
    }

    let allOk = true;
    for (let i = 0; i < imagePaths.length; i++) {
      const isLast = i === imagePaths.length - 1;
      const ok = await postGroupMessage(isLast ? text : "", imagePaths[i]);
      if (!ok) {
        allOk = false;
        break;
      }
    }
    if (allOk) {
      cancelAllGroupPendingImages();
    } else {
      setGroupInput(text);
    }
  }, [
    groupInput,
    groupPendingImages,
    groupSending,
    groupImageUploading,
    postGroupMessage,
    roomId,
    viewOnlyInviteToken,
    cancelAllGroupPendingImages,
  ]);

  const sendDmMessage = useCallback(async () => {
    const trimmed = dmInput.trim();
    const pending = dmPendingImages;
    if ((!trimmed && pending.length === 0) || dmSending || dmImageUploading) {
      return;
    }

    setDmInput("");
    setDmError(null);

    // 複数画像は、chat_messagesのスキーマ上1メッセージにつき画像は1枚のため、
    // 1枚ずつ順番にメッセージとして送る(=見た目には連続した吹き出しが
    // まとめて届く形になる。1つの吹き出しに複数画像を並べる形にはしていない)。
    // キャプション(入力欄のテキスト)は最後の画像のメッセージに付与する。
    const imagePaths: string[] = [];
    if (pending.length > 0) {
      const myUserId = authUserIdRef.current;
      if (!myUserId) return;
      setDmImageUploading(true);
      try {
        for (let i = 0; i < pending.length; i++) {
          const p = pending[i];
          setDmUploadProgress({
            index: i,
            total: pending.length,
            percent: 0,
            phase: "uploading",
          });
          const rawPath = await uploadRawChatImageWithProgress(
            p.file,
            myUserId,
            (percent) =>
              setDmUploadProgress({
                index: i,
                total: pending.length,
                percent,
                phase: "uploading",
              }),
          );
          setDmUploadProgress({
            index: i,
            total: pending.length,
            percent: 100,
            phase: "compressing",
          });
          const res = await fetch("/api/chat/compress-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rawPath,
              roomId,
              inviteToken: viewOnlyInviteToken ?? undefined,
            }),
          });
          const json = await res.json();
          if (!res.ok) {
            setDmError(json.error ?? "画像のアップロードに失敗しました");
            setDmInput(trimmed);
            return;
          }
          imagePaths.push(json.imagePath as string);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("画像添付メッセージの送信に失敗しました", err);
        setDmError("画像のアップロードに失敗しました。時間をおいて再度お試しください。");
        setDmInput(trimmed);
        return;
      } finally {
        setDmImageUploading(false);
        setDmUploadProgress(null);
      }
    }

    if (imagePaths.length === 0) {
      const ok = await postDmMessage(trimmed, null);
      if (!ok) setDmInput(trimmed);
      return;
    }

    let allOk = true;
    for (let i = 0; i < imagePaths.length; i++) {
      const isLast = i === imagePaths.length - 1;
      const ok = await postDmMessage(isLast ? trimmed : "", imagePaths[i]);
      if (!ok) {
        allOk = false;
        break;
      }
    }
    if (allOk) {
      cancelAllDmPendingImages();
    } else {
      setDmInput(trimmed);
    }
  }, [
    dmInput,
    dmPendingImages,
    dmSending,
    dmImageUploading,
    postDmMessage,
    roomId,
    viewOnlyInviteToken,
    cancelAllDmPendingImages,
    cancelDmPendingImage,
  ]);

  // 画像を保存(ダウンロード)する。Content-Dispositionによる強制ダウンロード
  // 付きの署名付きURLをその場で発行し直す(表示用URLとは別発行にすることで、
  // 通常表示時にダウンロードダイアログが出てしまうのを避ける)。
  // DM・グループどちらのライトボックスからも使う(グループ画像はアカウント
  // 所属を問わないRLSのため、roomId/peerUserId/inviteTokenの付与は
  // DM+viewOnlyの場合のみでよい)。
  const downloadDmLightboxImage = useCallback(async () => {
    if (!dmLightbox?.messageId || (!selectedPeerUserId && !selectedGroupId)) {
      return;
    }
    setDmLightboxDownloading(true);
    try {
      const params = new URLSearchParams({
        messageId: dmLightbox.messageId,
        download: "1",
      });
      if (viewOnlyInviteToken && selectedPeerUserId) {
        params.set("roomId", roomId);
        params.set("peerUserId", selectedPeerUserId);
        params.set("inviteToken", viewOnlyInviteToken);
      }
      const res = await fetch(`/api/chat/image-url?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "画像の保存に失敗しました");
      window.location.href = json.url;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("画像の保存に失敗しました", err);
      setDmError("画像の保存に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setDmLightboxDownloading(false);
    }
  }, [
    dmLightbox,
    roomId,
    selectedPeerUserId,
    selectedGroupId,
    viewOnlyInviteToken,
  ]);

  // 添付画像の署名付きURLを取得する(未取得・未失敗のもののみ)。
  // スレッドを開いた/更新された際にまとめて呼ぶ。失敗した場合は
  // dmImageLoadFailedに記録し、以後は自動リトライしない(理由不明の
  // 恒久的な失敗を毎レンダー無限リトライしないため)。ユーザーが
  // 「タップして再試行」を押した場合はretryDmImageUrl経由で
  // dmImageLoadFailedから外れ、この effect が再度対象に含める。
  useEffect(() => {
    if (!selectedPeerUserId) return;
    const thread = dmThreads[selectedPeerUserId] ?? [];
    const targets = thread.filter(
      (m) => m.imagePath && !dmImageUrls[m.id] && !dmImageLoadFailed[m.id],
    );
    if (targets.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        targets.map(async (m) => {
          const params = new URLSearchParams({ messageId: m.id });
          if (viewOnlyInviteToken) {
            params.set("roomId", roomId);
            params.set("peerUserId", selectedPeerUserId);
            params.set("inviteToken", viewOnlyInviteToken);
          }
          try {
            const res = await fetch(`/api/chat/image-url?${params.toString()}`);
            const json = await res.json();
            if (!res.ok) {
              // eslint-disable-next-line no-console
              console.error(
                "添付画像URLの取得に失敗しました",
                m.id,
                res.status,
                json,
              );
              return { id: m.id, ok: false as const };
            }
            return { id: m.id, ok: true as const, url: json.url as string };
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error("添付画像URLの取得に失敗しました", m.id, err);
            return { id: m.id, ok: false as const };
          }
        }),
      );
      if (cancelled) return;
      const succeeded = results.filter(
        (r): r is { id: string; ok: true; url: string } => r.ok,
      );
      const failed = results.filter((r) => !r.ok);
      if (succeeded.length > 0) {
        setDmImageUrls((prev) => ({
          ...prev,
          ...Object.fromEntries(succeeded.map((r) => [r.id, r.url])),
        }));
      }
      if (failed.length > 0) {
        setDmImageLoadFailed((prev) => ({
          ...prev,
          ...Object.fromEntries(failed.map((r) => [r.id, true as const])),
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    selectedPeerUserId,
    dmThreads,
    dmImageUrls,
    dmImageLoadFailed,
    roomId,
    viewOnlyInviteToken,
  ]);

  // グループチャット版の署名付きURL取得(上のDM版と同じ考え方)。
  // chat_messagesのグループ向けSELECT RLSはアカウント所属を問わないため、
  // viewOnlyでも通常のmessageIdだけで取得できる(roomId/inviteTokenの
  // 付与は不要)。dmImageUrls/dmImageLoadFailedはメッセージID単位の
  // キャッシュのためDMと共用する。
  useEffect(() => {
    if (!selectedGroupId) return;
    const thread = groupThreads[selectedGroupId] ?? [];
    const targets = thread.filter(
      (m) => m.imagePath && !dmImageUrls[m.id] && !dmImageLoadFailed[m.id],
    );
    if (targets.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        targets.map(async (m) => {
          const params = new URLSearchParams({ messageId: m.id });
          try {
            const res = await fetch(`/api/chat/image-url?${params.toString()}`);
            const json = await res.json();
            if (!res.ok) {
              // eslint-disable-next-line no-console
              console.error(
                "添付画像URLの取得に失敗しました",
                m.id,
                res.status,
                json,
              );
              return { id: m.id, ok: false as const };
            }
            return { id: m.id, ok: true as const, url: json.url as string };
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error("添付画像URLの取得に失敗しました", m.id, err);
            return { id: m.id, ok: false as const };
          }
        }),
      );
      if (cancelled) return;
      const succeeded = results.filter(
        (r): r is { id: string; ok: true; url: string } => r.ok,
      );
      const failed = results.filter((r) => !r.ok);
      if (succeeded.length > 0) {
        setDmImageUrls((prev) => ({
          ...prev,
          ...Object.fromEntries(succeeded.map((r) => [r.id, r.url])),
        }));
      }
      if (failed.length > 0) {
        setDmImageLoadFailed((prev) => ({
          ...prev,
          ...Object.fromEntries(failed.map((r) => [r.id, true as const])),
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedGroupId, groupThreads, dmImageUrls, dmImageLoadFailed]);

  // 画像の読み込みに失敗した状態(署名付きURL取得失敗、または実際の
  // <img>読み込み失敗)を解除して再試行させる。
  const retryDmImageUrl = useCallback((messageId: string) => {
    setDmImageLoadFailed((prev) => {
      if (!prev[messageId]) return prev;
      const next = { ...prev };
      delete next[messageId];
      return next;
    });
    setDmImageUrls((prev) => {
      if (!prev[messageId]) return prev;
      const next = { ...prev };
      delete next[messageId];
      return next;
    });
  }, []);

  // 編集モードに入る:メニューの「編集」から呼ばれ、入力欄に文面を読み込む。
  const startEditDmMessage = useCallback((m: DmMessage) => {
    setDmEditingMessageId(m.id);
    setDmInput(m.message);
    setDmError(null);
  }, []);

  const cancelEditDmMessage = useCallback(() => {
    setDmEditingMessageId(null);
    setDmInput("");
  }, []);

  // 編集中のメッセージを更新する(自分の送信分のみ)。
  const updateDmMessage = useCallback(async () => {
    const trimmed = dmInput.trim();
    const messageId = dmEditingMessageId;
    const peerUserId = selectedPeerUserId;
    const myUserId = authUserIdRef.current;
    if (!trimmed || !messageId || !peerUserId || !myUserId || dmSending) {
      return;
    }
    setDmSending(true);
    try {
      const editedAt = new Date().toISOString();
      const { error } = viewOnlyInviteToken
        ? await supabase.rpc("edit_chat_message_by_invite_token", {
            token: viewOnlyInviteToken,
            p_message_id: messageId,
            p_new_message: trimmed,
            p_edited_at: editedAt,
          })
        : await supabase
            .from("chat_messages")
            .update({ message: trimmed, edited_at: editedAt })
            .eq("id", messageId)
            .eq("sender_user_id", myUserId);
      if (error) {
        // eslint-disable-next-line no-console
        console.error("メッセージの編集に失敗しました", error);
        setDmError("編集に失敗しました。時間をおいて再度お試しください。");
        return;
      }
      setDmThreads((prev) => ({
        ...prev,
        [peerUserId]: (prev[peerUserId] ?? []).map((m) =>
          m.id === messageId ? { ...m, message: trimmed, editedAt } : m,
        ),
      }));
      channelRef.current?.httpSend("dm-edit", {
        id: messageId,
        originId: selfId.current,
        senderUserId: myUserId,
        recipientUserId: peerUserId,
        message: trimmed,
        editedAt,
      });
      setDmEditingMessageId(null);
      setDmInput("");
    } finally {
      setDmSending(false);
    }
  }, [
    dmInput,
    dmEditingMessageId,
    dmSending,
    selectedPeerUserId,
    supabase,
    viewOnlyInviteToken,
  ]);

  // メッセージを削除する(論理削除。自分の送信分のみ)。確認ダイアログは
  // 呼び出し元(メニューのonClick)で表示する。
  const deleteDmMessage = useCallback(
    async (m: DmMessage) => {
      const peerUserId = selectedPeerUserId;
      const myUserId = authUserIdRef.current;
      if (!peerUserId || !myUserId) return;
      const deletedAt = new Date().toISOString();
      const { error } = viewOnlyInviteToken
        ? await supabase.rpc("delete_chat_message_by_invite_token", {
            token: viewOnlyInviteToken,
            p_message_id: m.id,
            p_deleted_at: deletedAt,
          })
        : await supabase
            .from("chat_messages")
            .update({ message: "", deleted_at: deletedAt })
            .eq("id", m.id)
            .eq("sender_user_id", myUserId);
      if (error) {
        // eslint-disable-next-line no-console
        console.error("メッセージの削除に失敗しました", error);
        setDmError("削除に失敗しました。時間をおいて再度お試しください。");
        return;
      }
      // 画像添付メッセージの場合、保管期間を待たず即座に実ファイルも削除する。
      // 自分がアップロードした画像("chat-images: delete own"ポリシーの
      // 対象パス)のみ削除できるため、削除に失敗しても致命的ではない
      // (最終的には保管期間経過時の一括削除でも消える)。
      if (m.imagePath) {
        const { error: storageError } = await supabase.storage
          .from("chat-images")
          .remove([m.imagePath]);
        if (storageError) {
          // eslint-disable-next-line no-console
          console.error("添付画像の削除に失敗しました", storageError);
        }
      }
      setDmThreads((prev) => ({
        ...prev,
        [peerUserId]: (prev[peerUserId] ?? []).filter(
          (msg) => msg.id !== m.id,
        ),
      }));
      channelRef.current?.httpSend("dm-delete", {
        id: m.id,
        originId: selfId.current,
        senderUserId: myUserId,
        recipientUserId: peerUserId,
        deletedAt,
      });
      if (dmEditingMessageId === m.id) {
        setDmEditingMessageId(null);
        setDmInput("");
      }
    },
    [selectedPeerUserId, supabase, viewOnlyInviteToken, dmEditingMessageId],
  );

  // DMメッセージへの絵文字リアクション選択(ホバーバー/長押しメニュー
  // 共通)。同じ絵文字を選び直した場合は取り消し、別の絵文字なら
  // 上書きする(1人1トークにつき1リアクションまで)。楽観的に即座へ
  // 反映し、失敗時は元の状態へ戻す。
  const handleDmReactionSelect = useCallback(
    async (m: DmMessage, emoji: string) => {
      const peerUserId = selectedPeerUserId;
      const myUserId = authUserIdRef.current;
      if (!peerUserId || !myUserId) return;
      const previousEmoji =
        m.reactions.find((r) => r.userId === myUserId)?.emoji ?? null;
      const removing = previousEmoji === emoji;
      const nextEmoji = removing ? null : emoji;

      const applyLocally = (targetEmoji: string | null) => {
        setDmThreads((prev) => ({
          ...prev,
          [peerUserId]: (prev[peerUserId] ?? []).map((msg) =>
            msg.id !== m.id
              ? msg
              : {
                  ...msg,
                  reactions: targetEmoji
                    ? [
                        ...msg.reactions.filter((r) => r.userId !== myUserId),
                        { userId: myUserId, emoji: targetEmoji },
                      ]
                    : msg.reactions.filter((r) => r.userId !== myUserId),
                },
          ),
        }));
      };
      applyLocally(nextEmoji);
      setDmContextMenu(null);

      const { error } = viewOnlyInviteToken
        ? removing
          ? await supabase.rpc(
              "remove_chat_message_reaction_by_invite_token",
              { token: viewOnlyInviteToken, p_message_id: m.id },
            )
          : await supabase.rpc("set_chat_message_reaction_by_invite_token", {
              token: viewOnlyInviteToken,
              p_message_id: m.id,
              p_emoji: emoji,
            })
        : removing
          ? await supabase
              .from("chat_message_reactions")
              .delete()
              .eq("message_id", m.id)
              .eq("user_id", myUserId)
          : await supabase
              .from("chat_message_reactions")
              .upsert(
                { message_id: m.id, user_id: myUserId, emoji },
                { onConflict: "message_id,user_id" },
              );

      if (error) {
        // eslint-disable-next-line no-console
        console.error("リアクションの更新に失敗しました", error);
        applyLocally(previousEmoji);
        setDmError("リアクションの更新に失敗しました。");
        return;
      }

      channelRef.current?.httpSend("dm-reaction", {
        originId: selfId.current,
        messageId: m.id,
        reactorUserId: myUserId,
        recipientUserId: peerUserId,
        emoji: nextEmoji,
      });
    },
    [selectedPeerUserId, supabase, viewOnlyInviteToken],
  );

  // 指定テキストをクリップボードへコピーする。コピー後は選択範囲の
  // ハイライトが残り続けないよう解除する。
  const copyDmText = useCallback((text: string) => {
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        window.getSelection()?.removeAllRanges();
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

  // 対象メッセージの「コピー・部分コピー」メニューを開く。sourceが"mouse"
  // (PC右クリック)の場合のみ、その場で既に選択されていたテキストを拾う
  // (スマホの長押しには「事前選択」という概念が無いため、常に""扱いにする)。
  const openDmContextMenu = useCallback(
    (message: DmMessage, source: "mouse" | "touch") => {
      const sel = window.getSelection();
      const bubbleEl = dmBubbleRefs.current[message.id];
      const selectedText =
        source === "mouse" &&
        sel &&
        !sel.isCollapsed &&
        bubbleEl &&
        sel.anchorNode &&
        bubbleEl.contains(sel.anchorNode)
          ? sel.toString()
          : "";
      if (source === "touch") {
        // 長押しでブラウザが自動的に開始した単語選択などが、独自メニューの
        // 裏に中途半端に残らないようクリアしておく。
        sel?.removeAllRanges();
      }
      setDmContextMenu({ message, selectedText, source });
    },
    [],
  );

  // タッチ由来の操作が進行中かどうか(contextmenuイベントが本物の右クリック
  // なのか、Android等が長押しで自動発火させたものなのかを区別するために使う)。
  const dmTouchActiveRef = useRef(false);

  const handleDmContextMenu = useCallback(
    (e: React.MouseEvent, m: DmMessage) => {
      // 部分コピー中(選択ハンドルをドラッグして範囲調整している間)は
      // 何もしない。コピー自体はOS標準のポップアップ(コピー/調べる等)
      // に任せるため、独自メニューを開いたりpreventDefaultしたりせず、
      // ブラウザ標準の挙動をそのまま通す。
      if (dmSelectionModeMessageId) return;
      // ブラウザ標準の右クリックメニュー/長押しメニューは常に抑止し、
      // 独自メニューに一本化する。
      e.preventDefault();
      const source = dmTouchActiveRef.current ? "touch" : "mouse";
      clearDmLongPressTimer();
      openDmContextMenu(m, source);
    },
    [openDmContextMenu, clearDmLongPressTimer, dmSelectionModeMessageId],
  );

  // iOS Safariはテキスト上の長押しでcontextmenuイベントが発火しないため、
  // touchstart/touchmove/touchendから自前で長押し(500ms・移動量10px以内)を
  // 検出する(Android等でcontextmenuも発火した場合は上のハンドラと二重に
  // 呼ばれ得るが、setDmContextMenuを上書きするだけなので実害は無い)。
  const handleDmTouchStart = useCallback(
    (e: React.TouchEvent, m: DmMessage) => {
      // 部分コピー中に選択ハンドルをつかむと、この<div>への通常の
      // touchstartとしても検知されてしまう。ここで長押しタイマーを
      // 新たに仕込むと、ハンドルをドラッグして微調整している最中でも
      // 500ms後にopenDmContextMenu(source: "touch")が発火し、選択範囲が
      // removeAllRanges()で消えて1文字単位の調整ができなくなってしまう
      // ため、選択モード中は長押し検出自体を行わない。
      if (dmSelectionModeMessageId) return;
      dmTouchActiveRef.current = true;
      const touch = e.touches[0];
      if (!touch) return;
      dmLongPressStartRef.current = { x: touch.clientX, y: touch.clientY };
      dmLongPressTimerRef.current = window.setTimeout(() => {
        dmLongPressTimerRef.current = null;
        openDmContextMenu(m, "touch");
      }, 500);
    },
    [openDmContextMenu, dmSelectionModeMessageId],
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

  const clearGroupLongPressTimer = useCallback(() => {
    if (groupLongPressTimerRef.current !== null) {
      window.clearTimeout(groupLongPressTimerRef.current);
      groupLongPressTimerRef.current = null;
    }
  }, []);

  // スマホでのグループ一覧項目の長押しで、PCの右クリックと同じメニュー
  // (名前変更/退出)を開く。
  const handleGroupTouchStart = useCallback(
    (e: React.TouchEvent, groupId: string) => {
      const touch = e.touches[0];
      if (!touch) return;
      groupLongPressStartRef.current = { x: touch.clientX, y: touch.clientY };
      groupLongPressTimerRef.current = window.setTimeout(() => {
        groupLongPressTimerRef.current = null;
        groupLongPressFiredRef.current = true;
        setGroupContextMenu({ groupId, x: touch.clientX, y: touch.clientY });
      }, 500);
    },
    [],
  );

  const handleGroupTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const start = groupLongPressStartRef.current;
      const touch = e.touches[0];
      if (!start || !touch || groupLongPressTimerRef.current === null) return;
      if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) {
        clearGroupLongPressTimer();
      }
    },
    [clearGroupLongPressTimer],
  );

  const handleGroupTouchEnd = useCallback(() => {
    clearGroupLongPressTimer();
  }, [clearGroupLongPressTimer]);

  // ---- グループメッセージの長押し(絵文字リアクション専用メニュー) ----
  // グループメッセージには元々コピー/編集/削除の右クリックメニューが
  // 無いため、DMのhandleDmTouchStart/handleDmContextMenuとは独立した
  // シンプルな実装にする(長押し500ms・移動量10px以内でキャンセルは同じ)。
  const clearGroupMessageLongPressTimer = useCallback(() => {
    if (groupMessageLongPressTimerRef.current !== null) {
      window.clearTimeout(groupMessageLongPressTimerRef.current);
      groupMessageLongPressTimerRef.current = null;
    }
  }, []);

  const handleGroupMessageContextMenu = useCallback(
    (e: React.MouseEvent, m: GroupMessage) => {
      e.preventDefault();
      clearGroupMessageLongPressTimer();
      setGroupMessageContextMenu({ message: m });
    },
    [clearGroupMessageLongPressTimer],
  );

  const handleGroupMessageTouchStart = useCallback(
    (e: React.TouchEvent, m: GroupMessage) => {
      const touch = e.touches[0];
      if (!touch) return;
      groupMessageLongPressStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
      };
      groupMessageLongPressTimerRef.current = window.setTimeout(() => {
        groupMessageLongPressTimerRef.current = null;
        setGroupMessageContextMenu({ message: m });
      }, 500);
    },
    [],
  );

  const handleGroupMessageTouchMove = useCallback((e: React.TouchEvent) => {
    const start = groupMessageLongPressStartRef.current;
    const touch = e.touches[0];
    if (!start || !touch || groupMessageLongPressTimerRef.current === null) {
      return;
    }
    if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) {
      clearGroupMessageLongPressTimer();
    }
  }, [clearGroupMessageLongPressTimer]);

  const handleGroupMessageTouchEnd = useCallback(() => {
    clearGroupMessageLongPressTimer();
  }, [clearGroupMessageLongPressTimer]);

  const getGroupBubbleTopRight = useCallback((messageId: string) => {
    const bubbleEl = groupBubbleRefs.current[messageId];
    if (!bubbleEl) return null;
    const rect = bubbleEl.getBoundingClientRect();
    return { x: rect.right, y: rect.top };
  }, []);

  // 部分コピーモード:対象メッセージ全文を初期選択し、ユーザーがブラウザ
  // 標準の選択ハンドルでドラッグして範囲を1文字単位で調整できるようにする。
  // 「コピー」ボタンの位置は選択範囲を追わず、常にメッセージ吹き出し枠の
  // 右上に固定する(JSX側でdmBubbleRefsのrectから都度算出する)。
  useEffect(() => {
    if (!dmSelectionModeMessageId) return;
    const bubbleEl = dmBubbleRefs.current[dmSelectionModeMessageId];
    if (!bubbleEl) return;

    const range = document.createRange();
    range.selectNodeContents(bubbleEl);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    return () => {
      window.getSelection()?.removeAllRanges();
    };
  }, [dmSelectionModeMessageId]);

  // 部分コピーモード中は、ブラウザ標準の選択ハンドルから「コピー」が
  // 実行された(document上でcopyイベントが発火した)時点で選択モードを
  // 終了する。closeDmCopyUiでdmSelectionModeMessageIdがnullに戻ると、
  // 上のuseEffectのクリーンアップが走って選択ハイライトも消える。
  useEffect(() => {
    if (!dmSelectionModeMessageId) return;
    const onCopy = () => closeDmCopyUi();
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, [dmSelectionModeMessageId, closeDmCopyUi]);

  // メニュー/部分コピーの「コピー」吹き出しを表示する位置(対象メッセージの
  // 吹き出し枠の右上)を算出する。dmBubbleRefsは本文<p>へのrefなので、
  // その親要素(吹き出し枠のdiv)のrectを使う。
  const getDmBubbleTopRight = useCallback((messageId: string) => {
    const bubbleEl = dmBubbleRefs.current[messageId]?.parentElement;
    if (!bubbleEl) return null;
    const rect = bubbleEl.getBoundingClientRect();
    return { x: rect.right, y: rect.top };
  }, []);

  // スレッド切り替え・Escapeキーでコピーメニュー/選択モード/編集中を閉じる。
  useEffect(() => {
    closeDmCopyUi();
    setDmEditingMessageId(null);
    setDmInput("");
  }, [selectedPeerUserId, closeDmCopyUi]);

  useEffect(() => {
    if (!dmContextMenu && !dmSelectionModeMessageId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDmCopyUi();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dmContextMenu, dmSelectionModeMessageId, closeDmCopyUi]);

  useEffect(() => {
    if (!groupMessageContextMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGroupMessageContextMenu(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [groupMessageContextMenu]);

  // 部分コピーモード中の「外側タップで閉じる」。dmContextMenu用の全画面
  // divと同じ見た目にすると、選択ハンドルへのタッチもそのdivに吸われて
  // しまい、ドラッグでの範囲調整ができなくなる(実際にそれが原因で
  // 1文字単位の選択ができない不具合が起きていた)。そのため要素を
  // 覆う透明divは使わず、documentのpointerdownを監視して対象メッセージの
  // 吹き出しの外側を押した時だけ閉じるようにする。
  useEffect(() => {
    if (!dmSelectionModeMessageId) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      const bubbleEl =
        dmBubbleRefs.current[dmSelectionModeMessageId]?.parentElement;
      if (target && bubbleEl?.contains(target)) return;
      closeDmCopyUi();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [dmSelectionModeMessageId, closeDmCopyUi]);

  // ---- LiveKit接続(音声:Phase2、カメラ:Phase3、画面共有:Phase4)----
  // Room参加時のみToken発行APIを叩き、LiveKitのRoomに接続する。近接方式を
  // 維持するため autoSubscribe: false で接続し、実際の購読は下の
  // 「eligiblePeerIdsに応じて購読を切り替える」effectとTrackPublished
  // イベントで個別に制御する。
  useEffect(() => {
    if (!joined) return;
    let cancelled = false;
    // audioCaptureDefaults: WebRTC標準のノイズ抑制・エコーキャンセル・
    // 自動音量調整を有効にする。実はLiveKit SDK自体のデフォルト値も
    // 全てtrueなのでこの指定が無くても同じ挙動になるが、暗黙のSDK
    // デフォルトに頼らずコード上で明示しておく(将来のSDKバージョン
    // アップでデフォルト値が変わっても気づけるように)。
    const room = new LiveKitRoom({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
      },
    });
    livekitRoomRef.current = room;

    const isManagedKind = (publication: RemoteTrackPublication) =>
      publication.kind === Track.Kind.Audio ||
      publication.source === Track.Source.Camera ||
      publication.source === Track.Source.ScreenShare;

    // Camera(ビデオ通話)は近接判定(eligiblePeerIds)に応じて自動購読する。
    // Audio(近接音声通話)は全体アナウンスエリアの相手も含むaudioEligiblePeerIds
    // を使う。ScreenShareだけは対象外とし、「選択視聴」effect
    // (selectedScreenSharerId)側で個別に制御する。
    const applySubscription = (
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (publication.kind === Track.Kind.Audio) {
        publication.setSubscribed(
          audioEligiblePeerIdsRef.current.includes(participant.identity),
        );
        return;
      }
      if (publication.source !== Track.Source.Camera) return;
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

        // 画面共有は、相手が入室前(またはタブ非アクティブ中)から配信して
        // いたトラックへ後から購読(後乗り)した場合、SFU側のキーフレーム
        // 要求が配信側のエンコード遅延と絡んで届かず、映像が黒いまま固まる
        // ことがある(D-1)。カメラは近接判定で購読が繰り返し再評価される
        // ため自然に復旧するが、画面共有は選択時の一度きりの購読しか
        // 行わないため取りこぼすと直らない。購読が確立した直後に一度だけ
        // 購読をOFF→ONへ切り替え、新しいネゴシエーションでキーフレームを
        // 改めて要求させることで復旧を試みる。
        // 重要: このsetSubscribed(true)自体がこのTrackSubscribedハンドラを
        // 再度発火させるため、trackSid単位で「既に予約済みか」を記録して
        // おかないと、自分自身の再購読をきっかけに無限にトグルを繰り返して
        // しまう(G-1で発覚した、約1〜2秒間隔でプレビューがちらつく不具合の
        // 原因はこれだった)。
        if (
          pub.source === Track.Source.ScreenShare &&
          !kickedScreenShareTrackSidsRef.current.has(pub.trackSid)
        ) {
          kickedScreenShareTrackSidsRef.current.add(pub.trackSid);
          setTimeout(() => {
            if (!pub.isSubscribed) return;
            pub.setSubscribed(false);
            setTimeout(() => {
              if (livekitRoomRef.current === room) pub.setSubscribed(true);
            }, 300);
          }, 1500);
        }
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
          kickedScreenShareTrackSidsRef.current.delete(publication.trackSid);
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
      })
      // タブ非アクティブ化やスリープ等でLiveKit SDK自身の自動再接続
      // (バックオフ最大10回・合計約44秒)が尽きた場合のフォールバック。
      // ただし自分でroom.disconnect()した場合(CLIENT_INITIATED)や、
      // サーバー側の意図的な切断(重複ID・強制退室・ルーム削除)では
      // 再接続を試みない。
      .on(RoomEvent.Reconnecting, () => {
        console.info("[livekit] reconnecting...");
      })
      .on(RoomEvent.Reconnected, () => {
        console.info("[livekit] reconnected (SDK auto-recovery)");
        // 再接続完了の直後は、近接判定に基づく購読(setSubscribed)が
        // 反映されない/やり直しが必要なことがあるため明示的に呼び直す
        // (2026-09報告: スマホの画面オフ→復帰で相手の音声が聞こえない
        // 不具合の対策)。
        applyProximitySubscriptionsRef.current();
      })
      .on(RoomEvent.Disconnected, (reason) => {
        if (cancelled) return;
        if (
          reason === DisconnectReason.CLIENT_INITIATED ||
          reason === DisconnectReason.DUPLICATE_IDENTITY ||
          reason === DisconnectReason.PARTICIPANT_REMOVED ||
          reason === DisconnectReason.ROOM_DELETED
        ) {
          return;
        }
        console.warn("[livekit] disconnected, attempting manual reconnect", {
          reason,
        });
        setLivekitConnected(false);
        // 画面共有はブラウザの仕様上、ユーザー操作なしでのgetDisplayMedia
        // 再取得が許可されないため自動復元できない。切れたことが伝わるよう
        // 状態だけ倒し、再開はユーザーの再操作に委ねる。
        if (screenSharingRef.current) {
          screenStreamRef.current = null;
          setScreenSharing(false);
          if (selfState.current) {
            selfState.current.sharingScreen = false;
            channelRef.current?.track(selfState.current);
          }
          setShareError(
            "画面共有が切断されました。お手数ですが再度共有を開始してください。",
          );
        }
        connect();
      });

    // トークン取得→接続。タブ復帰時のRoomEvent.Disconnectedハンドラからも
    // 同じ手順で再接続できるよう、名前付き関数として括り出す。
    const connect = async () => {
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
        if (!cancelled) setLivekitConnected(true);

        // 接続前から既に画面共有中だった相手のpublicationは、
        // RoomEvent.TrackPublished(接続後に新規発行された場合にしか
        // 発火しない)では拾えないため、ここでroom.remoteParticipantsを
        // 一度走査してscreenSharePublicationsRefへ補完する。これが
        // 無いと、後から入室した人からは相手の画面共有が(「共有中」
        // 表示は出るが)黒いプレビューのまま見られない不具合になる
        // (カメラ・音声は近接判定で購読が繰り返し再評価されるため
        // 影響を受けない)。
        room.remoteParticipants.forEach((participant) => {
          participant.videoTrackPublications.forEach((pub) => {
            if (pub.source !== Track.Source.ScreenShare) return;
            screenSharePublicationsRef.current[participant.identity] = pub;
            if (selectedScreenSharerIdRef.current === participant.identity) {
              pub.setSubscribed(true);
            }
          });
        });

        // 意図しない切断からの再接続の場合、マイク/カメラのON/OFFトグルは
        // ONのままトラックだけが失われているので、現在の状態に合わせて
        // 再パブリッシュする(既に許可済みのgetUserMediaなので通常は
        // ユーザー操作なしで復帰できる)。
        if (micEnabledRef.current) {
          room.localParticipant
            .setMicrophoneEnabled(true)
            .then(() => applyNoiseFilterProcessor(room))
            .catch((err) => console.warn("[livekit] mic再パブリッシュ失敗", err));
        }
        if (inCallRef.current) {
          room.localParticipant
            .setCameraEnabled(
              true,
              { resolution: { width: 160, height: 120, frameRate: 15 } },
              {
                videoEncoding: { maxBitrate: 150_000, maxFramerate: 15 },
                simulcast: false,
              },
            )
            .catch((err) =>
              console.warn("[livekit] カメラ再パブリッシュ失敗", err),
            );
        }
      } catch {
        if (!cancelled) {
          setMicError(
            "音声サーバーへの接続に失敗しました。しばらくしてから再度お試しください。",
          );
        }
      }
    };
    connect();

    return () => {
      cancelled = true;
      room.disconnect();
      if (livekitRoomRef.current === room) livekitRoomRef.current = null;
      screenSharePublicationsRef.current = {};
      kickedScreenShareTrackSidsRef.current = new Set();
      setSelectedScreenSharerId(null);
      setScreenPreviewImages({});
      setLivekitConnected(false);
    };
  }, [joined, roomId, viewOnlyInviteToken]);

  // ---- 画面共有の選択視聴:選んだ相手のpublicationだけを購読する ----
  // 同時に複数を視聴することはできないため、選択が変わるたびに「選ばれて
  // いる相手だけsubscribed=true、それ以外は全員false」を毎回付け直す。
  useEffect(() => {
    Object.entries(screenSharePublicationsRef.current).forEach(
      ([identity, publication]) => {
        publication.setSubscribed(
          !receptionSuspended && identity === selectedScreenSharerId,
        );
      },
    );
  }, [selectedScreenSharerId, receptionSuspended]);

  // ---- 退出:バーチャル空間から抜けて入室前の画面に戻る ----
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
    setMicEnabled(false);
    setMicError(null);
    setScreenSharing(false);
    setInCall(false);
    setCallError(null);
  }, []);

  // ---- 入室処理 ----
  // 表示名をprofiles.display_nameへ保存し、次回ログイン時のデフォルト値に
  // する(管理者・ゲストいずれのアカウントでも、認証済みユーザーは全員
  // 自分自身のprofiles行を持つため同じ経路でよい。viewOnly(他人の招待URL
  // を一時閲覧中)でも自分自身のprofiles行は更新できる)。display_nameは
  // 権限昇格防止トリガーの対象外の通常の列のため、"profiles: update own"
  // RLS(user_id = auth.uid())の範囲で直接updateしてよい(2026-09報告:
  // 以前は入室画面・設定画面どちらで変更してもDBには一切保存されず、
  // 次回ログイン時には最初にGoogleアカウントから取り込んだ名前に戻って
  // いた)。
  const saveDisplayName = useCallback(
    (name: string) => {
      const userId = authUserIdRef.current;
      if (!userId) return;
      supabase
        .from("profiles")
        .update({ display_name: name })
        .eq("user_id", userId)
        .then(({ error }) => {
          if (error) {
            // eslint-disable-next-line no-console
            console.error("表示名の保存に失敗しました", error);
          }
        });
    },
    [supabase],
  );

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
    setAssetsReady(false);
    setJoined(true);
    saveDisplayName(name);
  }, [nameInput, selectedAvatar, obstacles, saveDisplayName]);

  // ---- 入室直後:自分のアバターの向き別スプライトをプリロードし、完了する
  // まで移動・向き変更操作をロックする(向き変更時に初めて画像取得が走り、
  // 数秒ラグって見える問題への対策)。対象は自分のアバター画像のみで、
  // 背景画像やLiveKit接続などは対象にしない。 ----
  useEffect(() => {
    if (!joined) return;
    const avatarImage = selfState.current?.avatarImage;
    if (!avatarImage) {
      setAssetsReady(true);
      return;
    }

    let cancelled = false;
    const dirs: PlayerState["dir"][] = ["up", "down", "left", "right"];
    const paths = Array.from(
      new Set(dirs.map((dir) => getAvatarSpritePath(avatarImage, dir))),
    );

    const preload = (src: string) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        // 向きごとの画像を持たないアバターがあり、その分は404になる。
        // 失敗してもロードをブロックしたくないので成功と同様に完了扱いする。
        img.onerror = () => resolve();
        img.src = src;
      });

    const ASSET_LOAD_TIMEOUT_MS = 5000; // 何らかの理由で完了しない場合の保険
    const timeout = new Promise<void>((resolve) =>
      setTimeout(resolve, ASSET_LOAD_TIMEOUT_MS),
    );

    Promise.race([Promise.all(paths.map(preload)), timeout]).then(() => {
      if (!cancelled) setAssetsReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [joined]);

  // ---- マップレイアウト:refをstateと同期(移動ループなど、effect外から常に最新値を読むため) ----
  useEffect(() => {
    assetsReadyRef.current = assetsReady;
  }, [assetsReady]);
  useEffect(() => {
    obstaclesRef.current = obstacles;
  }, [obstacles]);
  useEffect(() => {
    meetingZonesRef.current = meetingZones;
  }, [meetingZones]);
  useEffect(() => {
    warpPointsRef.current = warpPoints;
  }, [warpPoints]);
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
    // 2026-09 QA指摘: 他の大半の非同期effectと異なりcancelledガードが
    // 無く、テンプレート切替(roomId変更)や退室(joined変更)が短時間に
    // 連続した場合、既にアンマウント/差し替え済みの古いfetchの結果で
    // setState群が呼ばれてしまう経路があった。
    let cancelled = false;
    (async () => {
      // 2026-09 QA指摘(新規不具合): 以前はここで props の rooms(=
      // app/page.tsxのサーバーコンポーネントがページ表示時に1回だけ
      // 取得したスナップショット)からtemplate_idを読んでいた。招待URL
      // 経由のゲストが入室前のロビー画面で待っている間に管理者がルーム
      // デザインを変更すると、既に入室済みの参加者はforce-leaveの
      // broadcastで強制退出・再入室させられる一方、まだRealtime
      // チャンネルを購読していないロビー待機中のゲストにはbroadcastが
      // 届かない。その結果、ロビーで待っていたゲストだけが古い
      // template_idのまま入室してしまい、見た目上は別のルームデザインに
      // 見えるのに、実際には同じLiveKitルーム(roomIdは変わらないため)
      // に接続され、音声・映像・画面共有がそのまま繋がってしまっていた。
      // 入室する瞬間に必ずDBからtemplate_idを取り直すことで解消する。
      const { data: roomRow } = viewOnlyInviteToken
        ? await (async () => {
            const res = await supabase.rpc("list_rooms_by_invite_token", {
              token: viewOnlyInviteToken,
            });
            const matched = (
              res.data as Array<{
                id: string;
                template_id: string | null;
              }> | null
            )?.find((r) => r.id === roomId);
            return { data: matched ? { template_id: matched.template_id } : null };
          })()
        : await supabase
            .from("rooms")
            .select("template_id")
            .eq("id", roomId)
            .maybeSingle();
      if (cancelled || !roomRow?.template_id) return;
      const templateId = roomRow.template_id;

      const { data } = await supabase
        .from("templates")
        .select(
          "background_image_url, obstacles, meeting_area, warp_points, map_width, map_height, spawn_x, spawn_y",
        )
        .eq("id", templateId)
        .maybeSingle();
      if (cancelled || !data) return;

      if (data.background_image_url) {
        setBackgroundImageUrl(data.background_image_url);
      }

      if (data.map_width && data.map_height) {
        setMapSize({ width: data.map_width, height: data.map_height });
      }

      let loadedObstacles: Obstacle[] | null = null;
      if (Array.isArray(data.obstacles)) {
        loadedObstacles = (data.obstacles as Array<Partial<Obstacle>>).map(
          (o, i) => ({
            id: o.id ?? `obstacle-${i}`,
            x: o.x ?? 0,
            y: o.y ?? 0,
            width: o.width ?? NEW_ITEM_SIZE,
            height: o.height ?? NEW_ITEM_SIZE,
            label: o.label ?? "🧱 壁",
            rotation: o.rotation ?? 0,
          }),
        );
        setObstacles(loadedObstacles);
      }

      // 初期位置の反映:テンプレートにアバター初期位置(spawn_x/y)が設定
      // されていればそちらを、なければ現在位置(handleJoin時点のマップ中心)
      // を基準にし、障害物と重なっていれば上端のすぐ上へ押し出す。
      if (selfState.current) {
        const baseX = data.spawn_x ?? selfState.current.x;
        const baseY = data.spawn_y ?? selfState.current.y;
        const resolved = resolveSpawnPosition(
          baseX,
          baseY,
          loadedObstacles ?? obstaclesRef.current,
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

      const rawWarpPoints = data.warp_points;
      if (Array.isArray(rawWarpPoints)) {
        const loadedWarpPoints = (rawWarpPoints as Array<Partial<WarpPoint>>)
          .filter((w) => w.channel === "A" || w.channel === "B" || w.channel === "C")
          .map((w, i) => ({
            id: w.id ?? `warp-${i}`,
            channel: w.channel as "A" | "B" | "C",
            x: w.x ?? 0,
            y: w.y ?? 0,
            label: w.label ?? "",
          }));
        setWarpPoints(loadedWarpPoints);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [joined, roomId, viewOnlyInviteToken, supabase]);

  // 作業エリア(kind: "work")内にいる間は音声通話・ビデオ通話・画面共有を
  // 一切ONにできない(既にONの場合は入室時点でoffMeetingZone側で強制OFF
  // 済み)。各toggle/startのガードで共通して使う。
  const isInWorkZone = useCallback(() => {
    const zoneId = selfState.current?.meetingZoneId;
    if (!zoneId) return false;
    return (
      meetingZonesRef.current.find((z) => z.id === zoneId)?.kind === "work"
    );
  }, []);

  // ---- 画面共有 ----
  // LiveKit移行Phase4でLiveKit経由に切り替え。screenStreamRefは自分の
  // プレビュー表示専用(LiveKitトラックをラップしたMediaStream)。
  const stopScreenShare = useCallback(async () => {
    screenStreamRef.current = null;
    setScreenSharing(false);
    if (selfState.current) {
      selfState.current.sharingScreen = false;
      selfState.current.screenPreviewDataUrl = null;
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

    if (isInWorkZone()) {
      setShareError("作業エリア内では画面共有を利用できません。");
      return;
    }

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
      // broadcastは既に入室中の相手にしか届かない(後から入室した人には
      // 再配信されない)ため、presence(selfState.screenPreviewDataUrl)にも
      // 同じ画像を乗せておき、後から入室した人にもsync時点で渡るようにする。
      captureFirstFrame(track.mediaStreamTrack).then((dataUrl) => {
        if (dataUrl && selfState.current) {
          selfState.current.screenPreviewDataUrl = dataUrl;
          channelRef.current?.track(selfState.current);
          channelRef.current?.send({
            type: "broadcast",
            event: "screen-preview",
            payload: { id: selfState.current.id, dataUrl },
          });
          // Supabase Realtimeのbroadcastは(broadcast:{self:true}を
          // 明示しない限り)送信者自身には返ってこないため、上のsend()
          // だけでは自分自身のscreenPreviewImagesに反映されず、常に
          // 「共有中...」のプレースホルダのままになっていた(2026-09
          // 報告)。他の参加者と同じ静止画表示にするため、自分の分は
          // ここでローカルに直接反映する。
          setScreenPreviewImages((prev) => ({
            ...prev,
            [selfState.current!.id]: dataUrl,
          }));
        }
      });
    } catch {
      // 選択画面でキャンセルした場合などはここに来る。エラー扱いにはしない。
    }
  }, [stopScreenShare, isInWorkZone]);

  // 2026-09 QA指摘: 連打防止の処理中フラグが無く、高速連打でstart/stopの
  // 呼び出しが二重に走りうる(LiveKit SDKへの重複リクエスト)ため、
  // トグル関数側に処理中ガードを追加する。
  const screenShareToggleInFlightRef = useRef(false);
  const toggleScreenShare = useCallback(async () => {
    if (screenShareToggleInFlightRef.current) return;
    screenShareToggleInFlightRef.current = true;
    try {
      if (screenSharing) {
        await stopScreenShare();
      } else {
        await startScreenShare();
      }
    } finally {
      screenShareToggleInFlightRef.current = false;
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
    if (isInWorkZone()) {
      setCallError("作業エリア内ではビデオ通話を利用できません。");
      return;
    }
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
  }, [stopVideoCall, isInWorkZone]);

  // 2026-09 QA指摘: toggleScreenShareと同じ理由で処理中ガードを追加。
  const videoToggleInFlightRef = useRef(false);
  const toggleVideoCall = useCallback(async () => {
    if (videoToggleInFlightRef.current) return;
    videoToggleInFlightRef.current = true;
    try {
      if (inCall) {
        await stopVideoCall();
      } else {
        await startVideoCall();
      }
    } finally {
      videoToggleInFlightRef.current = false;
    }
  }, [inCall, stopVideoCall, startVideoCall]);

  // ---- I-2: 相手の画面共有を全画面視聴している間は自分のビデオ通話を一時停止 ----
  // 開始時にビデオ通話がONだった場合だけ記録し、閉じた時にその場合だけ
  // 再開する(元々OFFだったのに閉じたタイミングでONにしてしまわないよう
  // 注意)。音声通話・自分の画面共有は対象外。
  useEffect(() => {
    const isViewingScreenShare = expandedMedia?.kind === "screen";
    if (isViewingScreenShare) {
      if (inCallRef.current) {
        pausedVideoBeforeExpandedRef.current = true;
        setVideoPausedForScreenView(true);
        stopVideoCall();
      }
      return;
    }
    if (pausedVideoBeforeExpandedRef.current) {
      pausedVideoBeforeExpandedRef.current = false;
      setVideoPausedForScreenView(false);
      // 全画面視聴中にユーザー自身が手動でビデオ通話をONに戻していた
      // 場合は、ここで二重に開始しないようにする。
      if (!inCallRef.current) {
        startVideoCall();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedMedia]);

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
                // タブが非アクティブな相手は移動(move)broadcastを送れず、
                // 初回マウント時の位置をpeerPositionsRefから拾えないと
                // (0,0)にアバターが表示されてしまう(=見えない扱いに近い)。
                // presenceで新規に把握した時点でここに座標を種まきしておく。
                if (!peerPositionsRef.current.has(p.id)) {
                  peerPositionsRef.current.set(p.id, {
                    currentX: p.x,
                    currentY: p.y,
                    targetX: p.x,
                    targetY: p.y,
                  });
                }
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

          // 画面共有の静止画プレビューは、後から入室した人にはbroadcast
          // (共有開始時点の一度きり)が届かないため、presenceに乗っている
          // screenPreviewDataUrlから補完する(既に持っていれば上書きしない
          // ・共有中でなければ何もしない)。
          setScreenPreviewImages((prev) => {
            let changed = false;
            const next = { ...prev };
            Object.values(state).forEach((entries) => {
              const p = entries[0] as PlayerState;
              if (p.id === selfId.current) return;
              if (p.sharingScreen && p.screenPreviewDataUrl && !next[p.id]) {
                next[p.id] = p.screenPreviewDataUrl;
                changed = true;
              }
            });
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

          // 直近で位置broadcastを受信した相手は「実在する」ことの強い証拠
          // なので、下の在室状況の自己修復(2回連続不在で削除)の対象から
          // 外すために記録しておく。
          lastMoveAtRef.current.set(p.id, Date.now());

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
          const {
            obstacles: newObstacles,
            meetingZones: newZones,
            warpPoints: newWarpPoints,
          } = payload as {
            obstacles?: Obstacle[];
            meetingZones?: MeetingZone[];
            warpPoints?: WarpPoint[];
          };
          if (newObstacles) setObstacles(newObstacles);
          if (newZones) setMeetingZones(newZones);
          if (newWarpPoints) setWarpPoints(newWarpPoints);
        })
        .on("broadcast", { event: "screen-preview" }, ({ payload }) => {
          const { id, dataUrl } = payload as { id: string; dataUrl: string };
          // Supabase Realtimeのbroadcastはbroadcast:{self:true}を明示
          // しない限り送信者自身には返ってこない(このchannelはconfigで
          // 指定していないため対象外)ため、自分自身の分がここに届くことは
          // 無い。自分の分は送信元(captureFirstFrameのコールバック)で
          // 直接setScreenPreviewImagesしている。
          if (id === selfId.current) return;
          setScreenPreviewImages((prev) => ({ ...prev, [id]: dataUrl }));
        })
        .on("broadcast", { event: "dm" }, ({ payload }) => {
          const msg = payload as {
            id: string;
            originId: string;
            senderUserId: string;
            recipientUserId: string;
            senderName: string;
            message: string;
            createdAt: string;
            imagePath: string | null;
          };
          const myUserId = authUserIdRef.current;
          // 送信元タブが「自分」かどうかは、認証ユーザーID(senderUserId)
          // ではなくブラウザセッション単位のorigin(selfId)で判定する。
          // 同一アカウントを複数タブ/端末で開いている場合、認証ユーザーIDは
          // 同じでもタブごとに別セッションのため、ユーザーID比較だと
          // 「自分の別タブからの更新」まで誤って自分自身の送信分として
          // 無視してしまっていた(実際にはローカル未反映のため表示が
          // 更新されなくなる不具合の原因)。このタブから送った分は既に
          // ローカルへ反映済みなのでoriginIdが一致すれば無視し、自分宛て
          // でなければ(別の相手同士のDMは同じルームチャンネルに乗って
          // 届くが自分には関係ないので)無視する。
          if (
            msg.originId === selfId.current ||
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
                editedAt: null,
                deletedAt: null,
                imagePath: msg.imagePath,
                reactions: [],
              },
            ],
          }));
          if (selectedPeerUserIdRef.current !== msg.senderUserId) {
            setUnreadFromPeers((prev) => ({
              ...prev,
              [msg.senderUserId]: (prev[msg.senderUserId] ?? 0) + 1,
            }));
          } else {
            // スレッドを開いたまま新着を受け取った場合、既読位置もその場で
            // 更新しておく。これをしないと、後でスレッドを閉じてチャット
            // 一覧を再取得した際に「見たはずの新着」が未読として復活して
            // しまっていた(2026-08-31修正)。
            supabase
              .rpc("mark_chat_thread_read", {
                p_room_id: roomId,
                p_peer_user_id: msg.senderUserId,
              })
              .then(({ error: markError }) => {
                if (markError) {
                  // eslint-disable-next-line no-console
                  console.error("既読位置の保存に失敗しました", markError);
                }
              });
          }
          setChatThreadsRefreshTrigger((n) => n + 1);
        })
        .on("broadcast", { event: "group-dm" }, ({ payload }) => {
          const msg = payload as {
            id: string;
            originId: string;
            groupId: string;
            senderUserId: string;
            senderName: string;
            message: string;
            createdAt: string;
            isSystem?: boolean;
            imagePath?: string | null;
          };
          // broadcast自体はグループメンバー以外にも届くため、自分が
          // そのグループのメンバーかどうかをここで判定して弾く(退出
          // した本人は退出時点でmyGroupIdsRefから削除済みのため、この
          // 判定だけで「退出後は通知が来ない」も自然に満たされる)。
          if (
            msg.originId === selfId.current ||
            !myGroupIdsRef.current.has(msg.groupId)
          ) {
            return;
          }
          // 表示中のスレッド宛ての新着なら、届いた時点でのスクロール位置を
          // 見て「既に最下部付近にいたか」を判定する(DMのdm受信ハンドラと
          // 同じ理由。過去ログを見ている間や通知からのジャンプ直後は、
          // 新着が来ても一番下へ戻さない)。
          if (selectedGroupIdRef.current === msg.groupId) {
            const el = groupScrollRef.current;
            groupForceScrollRef.current = el
              ? isDmScrollNearBottom(el)
              : true;
          }
          setGroupThreads((prev) => ({
            ...prev,
            [msg.groupId]: [
              ...(prev[msg.groupId] ?? []),
              {
                id: msg.id,
                senderUserId: msg.senderUserId,
                senderName: msg.senderName,
                isSelf: false,
                message: msg.message,
                createdAt: msg.createdAt,
                deletedAt: null,
                isSystem: msg.isSystem ?? false,
                imagePath: msg.imagePath ?? null,
                reactions: [],
              },
            ],
          }));
          // グループを開いたまま新着を受け取った場合も、1対1DMと同じ理由
          // (2026-08-31修正)で既読位置を更新しておく。
          if (selectedGroupIdRef.current === msg.groupId) {
            supabase
              .rpc("mark_chat_group_read", { p_group_id: msg.groupId })
              .then(({ error: markError }) => {
                if (markError) {
                  // eslint-disable-next-line no-console
                  console.error("既読位置の保存に失敗しました", markError);
                }
              });
          }
          setChatThreadsRefreshTrigger((n) => n + 1);
        })
        .on("broadcast", { event: "group-created" }, ({ payload }) => {
          const msg = payload as {
            originId: string;
            groupId: string;
            memberUserIds: string[];
          };
          const myUserId = authUserIdRef.current;
          // broadcast自体は room 内全員に届くため、自分が招待された
          // メンバーに含まれているかどうかをここで判定して弾く
          // (group-dmと同じ考え方)。
          if (
            msg.originId === selfId.current ||
            !myUserId ||
            !msg.memberUserIds.includes(myUserId)
          ) {
            return;
          }
          myGroupIdsRef.current.add(msg.groupId);
          setChatThreadsRefreshTrigger((n) => n + 1);
        })
        .on("broadcast", { event: "group-renamed" }, ({ payload }) => {
          const msg = payload as {
            originId: string;
            groupId: string;
            name: string | null;
          };
          if (
            msg.originId === selfId.current ||
            !myGroupIdsRef.current.has(msg.groupId)
          ) {
            return;
          }
          if (msg.name) {
            setChatThreads((prev) =>
              prev.map((t) =>
                t.isGroup && t.threadId === msg.groupId
                  ? { ...t, threadName: msg.name as string }
                  : t,
              ),
            );
          } else {
            setChatThreadsRefreshTrigger((n) => n + 1);
          }
        })
        .on("broadcast", { event: "dm-edit" }, ({ payload }) => {
          const msg = payload as {
            id: string;
            originId: string;
            senderUserId: string;
            recipientUserId: string;
            message: string;
            editedAt: string;
          };
          const myUserId = authUserIdRef.current;
          // このタブから送った編集は既にローカルへ反映済み(originId一致)。
          // 自分宛てでなければ無視する(上のdmイベントと同じ理由でユーザーID
          // ではなくoriginIdで自分自身の送信分かどうかを判定する)。
          if (
            msg.originId === selfId.current ||
            msg.recipientUserId !== myUserId
          ) {
            return;
          }
          setDmThreads((prev) => ({
            ...prev,
            [msg.senderUserId]: (prev[msg.senderUserId] ?? []).map((m) =>
              m.id === msg.id
                ? { ...m, message: msg.message, editedAt: msg.editedAt }
                : m,
            ),
          }));
        })
        .on("broadcast", { event: "dm-delete" }, ({ payload }) => {
          const msg = payload as {
            id: string;
            originId: string;
            senderUserId: string;
            recipientUserId: string;
            deletedAt: string;
          };
          const myUserId = authUserIdRef.current;
          // 自分の送信分かどうかの判定理由は上のdm/dm-editイベントと同じ。
          if (
            msg.originId === selfId.current ||
            msg.recipientUserId !== myUserId
          ) {
            return;
          }
          setDmThreads((prev) => ({
            ...prev,
            [msg.senderUserId]: (prev[msg.senderUserId] ?? []).filter(
              (m) => m.id !== msg.id,
            ),
          }));
        })
        .on("broadcast", { event: "dm-reaction" }, ({ payload }) => {
          const msg = payload as {
            messageId: string;
            originId: string;
            reactorUserId: string;
            recipientUserId: string;
            emoji: string | null;
          };
          const myUserId = authUserIdRef.current;
          // DMは常に2者間のため、リアクションを付けた本人
          // (reactorUserId)が自分にとっての会話相手=スレッドキーになる
          // (dm/dm-editイベントと同じ判定方法)。
          if (
            msg.originId === selfId.current ||
            msg.recipientUserId !== myUserId
          ) {
            return;
          }
          setDmThreads((prev) => ({
            ...prev,
            [msg.reactorUserId]: (prev[msg.reactorUserId] ?? []).map((m) =>
              m.id !== msg.messageId
                ? m
                : {
                    ...m,
                    reactions: msg.emoji
                      ? [
                          ...m.reactions.filter(
                            (r) => r.userId !== msg.reactorUserId,
                          ),
                          { userId: msg.reactorUserId, emoji: msg.emoji },
                        ]
                      : m.reactions.filter(
                          (r) => r.userId !== msg.reactorUserId,
                        ),
                  },
            ),
          }));
        })
        .on("broadcast", { event: "group-reaction" }, ({ payload }) => {
          const msg = payload as {
            messageId: string;
            originId: string;
            groupId: string;
            reactorUserId: string;
            emoji: string | null;
          };
          if (
            msg.originId === selfId.current ||
            !myGroupIdsRef.current.has(msg.groupId)
          ) {
            return;
          }
          setGroupThreads((prev) => ({
            ...prev,
            [msg.groupId]: (prev[msg.groupId] ?? []).map((m) =>
              m.id !== msg.messageId
                ? m
                : {
                    ...m,
                    reactions: msg.emoji
                      ? [
                          ...m.reactions.filter(
                            (r) => r.userId !== msg.reactorUserId,
                          ),
                          { userId: msg.reactorUserId, emoji: msg.emoji },
                        ]
                      : m.reactions.filter(
                          (r) => r.userId !== msg.reactorUserId,
                        ),
                  },
            ),
          }));
        })
        .on("broadcast", { event: "mention" }, ({ payload }) => {
          const msg = payload as {
            originId: string;
            groupId: string;
            everyone: boolean;
            mentionedUserIds: string[];
          };
          const myUserId = authUserIdRef.current;
          if (msg.originId === selfId.current || !myUserId) return;
          const targeted =
            msg.everyone || msg.mentionedUserIds.includes(myUserId);
          if (!targeted) return;
          // 通知本文(送信者名・グループ名等)はローカルで組み立てず、
          // 一覧を丸ごと再取得する(chatThreadsと同じ考え方。1件だけの
          // ためRPC/クエリの負荷は無視できる)。
          setMentionsRefreshTrigger((n) => n + 1);
        })
        .on("broadcast", { event: "force-leave" }, ({ payload }) => {
          const { reason, targetId } = payload as {
            reason?: string;
            targetId?: string;
          };
          // targetIdが指定されている(=特定の参加者だけを退出させる管理者
          // 操作)場合は、自分宛てでなければ無視する。未指定の場合は従来通り
          // プラン変更時と同じくルーム内全員が対象。
          if (targetId && targetId !== selfId.current) return;
          setForceLeaveMessage(
            reason === "admin-kicked"
              ? "管理者により退出させられました。まもなく退出します..."
              : reason === "room-changed"
                ? "管理者がルームを変更しました。強制退出されます"
                : "管理者がプランを変更したため、まもなく退出します...",
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
  //
  // 5人以上が同時に動いているような高負荷時、presenceのスナップショットが
  // 瞬間的に一部欠けることがあり、実際には位置broadcastが届き続けている
  // (=確実に在室している)相手までこの仕組みで誤って消してしまい、
  // 「走行中に相手が一瞬消える」症状の主因と判明した。直近で位置broadcastを
  // 受信している相手は、presence側の欠落に関わらず不在判定から除外する。
  const RECENT_MOVE_GRACE_MS = 4000;
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
        const now = Date.now();

        Object.keys(next).forEach((id) => {
          if (id === selfId.current || presentIds.has(id)) return;
          const lastMoveAt = lastMoveAtRef.current.get(id) ?? 0;
          if (now - lastMoveAt < RECENT_MOVE_GRACE_MS) {
            // つい先ほどまで位置broadcastを受信していた = 実際には在室して
            // いるはずなので、presence側の一時的な欠落は無視する。
            return;
          }
          if (suspectedGoneRef.current.has(id)) {
            // 前回に続き2回連続で不在を確認できたので削除する
            delete next[id];
            peerPositionsRef.current.delete(id);
            lastMoveAtRef.current.delete(id);
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
            // 上のpresence syncハンドラと同じ理由で座標を種まきする。
            if (!peerPositionsRef.current.has(p.id)) {
              peerPositionsRef.current.set(p.id, {
                currentX: p.x,
                currentY: p.y,
                targetX: p.x,
                targetY: p.y,
              });
            }
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
      // 非アクティブの間、上の在室状況の自己修復(setInterval)は動き続けて
      // いるが、rAFの停止で自分からの送信も止まっているため、この間に
      // 積み上がった「不在疑い」は根拠が薄い。復帰時にリセットし、直後の
      // 新しいpresence/broadcastで正しく判定し直させる。
      suspectedGoneRef.current = new Set();
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
        // アバターの向き別スプライトのプリロードが終わるまでは、キー/タッチ
        // 操作による移動・向き変更を受け付けない(ローディング画面表示中)。
        if (assetsReadyRef.current) {
          const keys = keysDown.current;
          if (keys.size > 0) {
            // 矢印キー/タッチ操作が入力されたら、ダブルクリック移動中でも
            // 即座にキャンセルして通常操作へ切り替える。
            if (autoMoveTargetRef.current) autoMoveTargetRef.current = null;
            if (keys.has("arrowup") || keys.has("w")) dy -= 1;
            if (keys.has("arrowdown") || keys.has("s")) dy += 1;
            if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
            if (keys.has("arrowright") || keys.has("d")) dx += 1;
          } else if (autoMoveTargetRef.current) {
            // ダブルクリック移動中:目的地への方向ベクトルを求める。
            const target = autoMoveTargetRef.current;
            const toX = target.x - self.x;
            const toY = target.y - self.y;
            const dist = Math.hypot(toX, toY);
            if (dist < 0.5) {
              // 既に目的地とみなせるほど近い(通常はここに来る前に到着処理
              // 済みだが、念のための保険)。
              autoMoveTargetRef.current = null;
            } else {
              dx = toX / dist;
              dy = toY / dist;
            }
          }
        }

        const moving = dx !== 0 || dy !== 0;

        if (moving) {
          const len = Math.hypot(dx, dy) || 1;
          dx = (dx / len) * MOVE_SPEED * dt;
          dy = (dy / len) * MOVE_SPEED * dt;

          const halfW = AVATAR_HITBOX_WIDTH / 2;
          const halfH = AVATAR_HITBOX_HEIGHT / 2;

          let nextX = Math.min(
            Math.max(self.x + dx, halfW),
            mapSizeRef.current.width - halfW,
          );
          let nextY = Math.min(
            Math.max(self.y + dy, halfH),
            mapSizeRef.current.height - halfH,
          );

          // ダブルクリック移動中は、1フレームの移動量が残り距離より大きい
          // 場合に目的地を通り過ぎてしまわないよう、目的地でクランプする。
          const autoTarget = autoMoveTargetRef.current;
          if (autoTarget) {
            if (dx > 0) nextX = Math.min(nextX, autoTarget.x);
            else if (dx < 0) nextX = Math.max(nextX, autoTarget.x);
            if (dy > 0) nextY = Math.min(nextY, autoTarget.y);
            else if (dy < 0) nextY = Math.max(nextY, autoTarget.y);
          }

          // 障害物との当たり判定(矩形どうし)。X軸・Y軸を別々に判定することで、
          // 障害物に斜めから近づいても壁沿いに滑るように移動できる。
          let blockedX = obstaclesRef.current.some((o) =>
            rectIntersectsObstacle(nextX, self.y, halfW, halfH, o),
          );
          let blockedY = obstaclesRef.current.some((o) =>
            rectIntersectsObstacle(self.x, nextY, halfW, halfH, o),
          );

          // 会議室(conference)ゾーンの入室確認・施錠判定。
          // 「入室済みかどうか」は、当たり判定(ゾーンとの矩形の重なり)が
          // 一度でも外れたかどうかで管理する(insideConferenceZoneIdsRef)。
          // 以前はself.meetingZoneId(アバター中心点がゾーン内かどうかの
          // 点判定、出入り判定effect側で別途計算)を流用していたが、中心点の
          // 境界とアバターの当たり判定(矩形)の境界は一致しないため、退室の
          // 過程で「中心点は外に出たが当たり判定はまだ触れている」という
          // 一瞬の状態が生じ、そこで「未入室なのに接触した」と誤判定されて
          // 入室確認ポップアップが再度出てその場で動けなくなるバグがあった。
          // 当たり判定という単一の基準に統一することでこれを解消する。
          meetingZonesRef.current.forEach((zone) => {
            if (zone.kind !== "conference") return;

            const touchX = rectIntersectsRect(nextX, self.y, halfW, halfH, zone);
            const touchY = rectIntersectsRect(self.x, nextY, halfW, halfH, zone);
            const touching = touchX || touchY;
            const wasInside = insideConferenceZoneIdsRef.current.has(zone.id);

            if (wasInside) {
              // 入室済み:出る方向には一切制限をかけず、ポップアップも出さない。
              // 当たり判定が完全に外れた時点で退室確定とする。
              if (!touching) {
                insideConferenceZoneIdsRef.current.delete(zone.id);
                // 施錠者本人が退室した場合は自動解錠する。相手にも伝わる
                // よう、下の出入り判定effectのtrack()を待たずここで送る。
                if (self.lockedMeetingZoneId === zone.id) {
                  self.lockedMeetingZoneId = null;
                  channelRef.current?.track(self);
                }
              }
              return;
            }

            if (!touching) {
              // 当たり判定が完全に外れたら、次に触れた時に再度ポップアップ
              // できるようリセットする。
              dismissedConferenceZonesRef.current.delete(zone.id);
              if (pendingMeetingEntryRef.current?.zoneId === zone.id) {
                pendingMeetingEntryRef.current = null;
                setPendingMeetingEntry(null);
              }
              return;
            }

            const locker = Object.values(playersRef.current).find(
              (p) => p.lockedMeetingZoneId === zone.id,
            );
            const lockedByOther = !!locker && locker.id !== selfId.current;
            const dismissed = dismissedConferenceZonesRef.current.has(zone.id);
            const alreadyPending =
              pendingMeetingEntryRef.current?.zoneId === zone.id;

            // 施錠中・「いいえ」選択済み・確認待ちのいずれでもなければ、
            // 新規の接触(未入室→接触)として入室確認ポップアップを出す。
            if (!lockedByOther && !dismissed && !alreadyPending) {
              pendingMeetingEntryRef.current = { zoneId: zone.id };
              setPendingMeetingEntry({ zoneId: zone.id });
            }
            // 施錠中の場合は入室確認の代わりに警告吹き出しを出す
            // (表示中の再接触は無視し、重複してタイマーを延長しない)。
            if (lockedByOther && !lockedZoneNoticeRef.current) {
              lockedZoneNoticeRef.current = true;
              setLockedZoneNotice(true);
            }
            // 施錠中・確認待ち・拒否済みのいずれの場合も、答えが出るまでは
            // 壁と同様にそれ以上先へは進めないようにする(接触した軸のみ)。
            if (touchX) blockedX = true;
            if (touchY) blockedY = true;
          });

          if (!blockedX) self.x = nextX;
          if (!blockedY) self.y = nextY;

          if (autoTarget) {
            if (self.x === autoTarget.x && self.y === autoTarget.y) {
              // 目的地に到着
              autoMoveTargetRef.current = null;
            } else if (blockedX && blockedY) {
              // 障害物に阻まれてこれ以上進めない場合は、その場で自動移動を
              // 打ち切る(手前で停止したままにする)。
              autoMoveTargetRef.current = null;
            }
          }

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

        // ワープポイントの出入り判定(2026-09追加)。片方の丸(半径
        // WARP_POINT_RADIUS)の中心から一定距離内に入ったら、同じchannel
        // のもう片方の丸の座標へ瞬間移動する(双方向)。insideWarpIdRefに
        // 「現在重なっている(と扱っている)丸のID」を記録し、それと違う丸に
        // 新しく重なった時だけ発火させる。丸の外に完全に出るとnullに戻る
        // ため、一度出るまでは(移動先の丸に重なったままでも)再発火しない。
        const hitWarp = warpPointsRef.current.find(
          (w) => Math.hypot(self.x - w.x, self.y - w.y) <= WARP_POINT_RADIUS,
        );
        if (!hitWarp) {
          insideWarpIdRef.current = null;
        } else if (hitWarp.id !== insideWarpIdRef.current) {
          const warpDestination = warpPointsRef.current.find(
            (w) => w.channel === hitWarp.channel && w.id !== hitWarp.id,
          );
          if (warpDestination) {
            // テレポート実行(180ms後)までの間、まだ座標は移動元の丸のまま
            // なので、ここではまず移動元の丸のIDを記録して連続発火を防ぐ。
            // 実際に座標が移動先へ切り替わるタイミングで、改めて移動先の
            // 丸のIDに更新する。
            insideWarpIdRef.current = hitWarp.id;
            setWarpFading(true);
            window.setTimeout(() => {
              self.x = warpDestination.x;
              self.y = warpDestination.y;
              insideWarpIdRef.current = warpDestination.id;
              setPlayers((prev) => {
                const current = prev[self.id];
                if (!current) return prev;
                return {
                  ...prev,
                  [self.id]: { ...current, x: self.x, y: self.y },
                };
              });
              channelRef.current?.track(self);
            }, 180);
            window.setTimeout(() => setWarpFading(false), 500);
          } else {
            // 対になる丸が存在しない(片方だけ設置されている等の異常系)。
            // ワープはしないが、同じ丸に居続ける間は毎フレーム再判定
            // しないよう記録だけしておく。
            insideWarpIdRef.current = hitWarp.id;
          }
        }

        // ミーティングエリアの出入り判定(音声通話の自動接続に使用)
        const zoneId = findMeetingZoneId(
          self.x,
          self.y,
          meetingZonesRef.current,
        );
        self.meetingZoneId = zoneId;
        if (zoneId !== lastTrackedZoneId.current) {
          lastTrackedZoneId.current = zoneId;
          // 施錠中の会議室からの自動解錠は、当たり判定(矩形の重なり)基準の
          // 退室検知(上のconferenceゾーンのforEach内)で行っている。ここは
          // 中心点ベースの判定で境界の基準が異なるため、解錠処理は持たせない
          // (異常切断時はpresenceのleave検知で自動解錠される)。
          // presence情報も更新しておく(入室直後の相手にも最新状態が伝わるように)
          channelRef.current?.track(self);
          // 自分自身のplayers[selfId.current]のmeetingZoneIdも更新する。
          // presenceのsyncハンドラは「自分自身の行は上書きしない」設計
          // (移動loop側が正としてローカルのx,y等を上書きされないための
          // もの)のため、track()するだけでは自分のplayers上のエントリの
          // meetingZoneIdは更新されず、eligiblePeerIds側で「自分は今
          // 会議室に入っている」と正しく判定できない(=会議室内にいる
          // 本人視点では、外の人の緑サークルに入ると距離判定にフォール
          // バックして声が漏れて聞こえてしまう)不具合があった
          // (2026-09報告)。
          setPlayers((prev) => {
            const current = prev[self.id];
            if (!current || current.meetingZoneId === zoneId) return prev;
            return { ...prev, [self.id]: { ...current, meetingZoneId: zoneId } };
          });

          // 作業エリアに入った瞬間、音声通話・ビデオ通話・画面共有を
          // 強制的にオフにする(ONへ戻すことは各toggle側のガードで禁止する)。
          const enteredZone = zoneId
            ? meetingZonesRef.current.find((z) => z.id === zoneId)
            : null;
          if (enteredZone?.kind === "work") {
            livekitRoomRef.current?.localParticipant
              .setMicrophoneEnabled(false)
              .catch(() => {});
            setMicEnabled(false);
            self.micOn = false;
            setPlayers((prev) => {
              const current = prev[self.id];
              if (!current) return prev;
              return { ...prev, [self.id]: { ...current, micOn: false } };
            });
            stopVideoCall();
            stopScreenShare();
          }
        }

        // 自分のアバターの見た目の位置は、Reactのstateを介さずDOM操作で
        // 直接更新する(毎フレーム呼んでも画面全体の再描画が起きない)。
        avatarRefs.current.get(self.id)?.updatePosition(self.x, self.y);

        // マイクの音声が届く範囲の目安の円も、アバターと同じく毎フレーム
        // DOM操作で位置を更新する(Reactのstate経由だと追従が遅れて見える)。
        // アバター画像はAvatar.tsx側でx方向のみ中心揃え、y方向は当たり判定
        // (足元付近を基準)に対して画像を上へずらして表示しているため、円も
        // 同じ計算式で中心を合わせないと見た目上アバターより下にずれる。
        if (proximityCircleRef.current) {
          const displaySize = avatarSizePx ?? AVATAR_RADIUS * 2;
          const visualCenterY = self.y + AVATAR_HITBOX_HEIGHT / 2 - displaySize / 2;
          proximityCircleRef.current.style.transform = `translate(${
            self.x - PROXIMITY_RADIUS
          }px, ${visualCenterY - PROXIMITY_RADIUS}px)`;
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

  // ---- 会議室(conference)ゾーンの入室確認・施錠操作 ----
  // 「はい」:接触時点の進行方向(向き)にそのまま60px進んだ位置へ移動する。
  // ゾーンが小さい・斜め接触などでゾーン外へはみ出す場合は、ゾーン内側
  // (当たり判定の半径分の余白を持たせた範囲)にクランプする(Tech Lead確認済み)。
  const MEETING_ENTRY_STEP = 60;
  const MEETING_ENTRY_DIRECTION: Record<
    PlayerState["dir"],
    { x: number; y: number }
  > = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  const confirmMeetingEntry = useCallback((zoneId: string) => {
    const zone = meetingZonesRef.current.find((z) => z.id === zoneId);
    const self = selfState.current;
    dismissedConferenceZonesRef.current.delete(zoneId);
    pendingMeetingEntryRef.current = null;
    setPendingMeetingEntry(null);
    // ダブルクリック移動中にこのポップアップへ辿り着いた場合、テレポート後も
    // 元の(クリック時点の)目的地へ向かって余計に動き続けてしまうのを防ぐ。
    autoMoveTargetRef.current = null;
    if (!zone || !self) return;
    insideConferenceZoneIdsRef.current.add(zoneId);

    const dir = MEETING_ENTRY_DIRECTION[self.dir];
    const halfW = AVATAR_HITBOX_WIDTH / 2;
    const halfH = AVATAR_HITBOX_HEIGHT / 2;
    const rawX = self.x + dir.x * MEETING_ENTRY_STEP;
    const rawY = self.y + dir.y * MEETING_ENTRY_STEP;
    self.x = Math.min(
      Math.max(rawX, zone.x + halfW),
      zone.x + zone.width - halfW,
    );
    self.y = Math.min(
      Math.max(rawY, zone.y + halfH),
      zone.y + zone.height - halfH,
    );

    self.meetingZoneId = zoneId;
    lastTrackedZoneId.current = zoneId;
    channelRef.current?.track(self);
    // 移動loop側の同種の更新箇所と同じ理由で、自分のplayers上のエントリ
    // にもmeetingZoneIdを反映する(会議室=conferenceは常にこの確認
    // ポップアップ経由で入室するため、ここで反映しないと会議室入室時は
    // 一度もローカルのplayers上のmeetingZoneIdが更新されないままになる)。
    setPlayers((prev) => {
      const current = prev[self.id];
      if (!current) return prev;
      return { ...prev, [self.id]: { ...current, meetingZoneId: zoneId } };
    });
    channelRef.current?.send({
      type: "broadcast",
      event: "move",
      payload: self,
    });
  }, []);

  // 「いいえ」:このまま当たり判定が外れるまでは再度ポップアップしない。
  const declineMeetingEntry = useCallback((zoneId: string) => {
    dismissedConferenceZonesRef.current.add(zoneId);
    pendingMeetingEntryRef.current = null;
    setPendingMeetingEntry(null);
    // ダブルクリック移動でここへ辿り着いた場合、拒否した後もその場所へ
    // 向かい続けようとして境界に張り付いたままにならないよう、自動移動も
    // 打ち切る。
    autoMoveTargetRef.current = null;
  }, []);

  // 会議室入室確認ポップアップ表示中は、Enterキーでも「はい」と同じ挙動にする。
  useEffect(() => {
    if (!pendingMeetingEntry) return;
    const zoneId = pendingMeetingEntry.zoneId;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        confirmMeetingEntry(zoneId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingMeetingEntry, confirmMeetingEntry]);

  // 鍵アイコン押下:確認ポップアップなしで即座に施錠/解錠を切り替える。
  // 既に自分以外の誰かが施錠している場合のみ、操作不可のエラーを出す。
  const handleLockIconClick = useCallback((zoneId: string) => {
    const locker = Object.values(playersRef.current).find(
      (p) => p.lockedMeetingZoneId === zoneId,
    );
    if (locker && locker.id !== selfId.current) {
      setLockPermissionError({ zoneId });
      return;
    }

    const self = selfState.current;
    if (!self) return;
    const lockedMeetingZoneId = locker ? null : zoneId;
    self.lockedMeetingZoneId = lockedMeetingZoneId;
    channelRef.current?.track(self);
    // selfState.current(ref)を書き換えただけではReactが再レンダリング
    // しないため、その場で動かなくても南京錠アイコンが即時に表示される
    // よう、players Stateも明示的に更新する。
    setPlayers((prev) => {
      const current = prev[self.id];
      if (!current) return prev;
      return {
        ...prev,
        [self.id]: { ...current, lockedMeetingZoneId },
      };
    });
  }, []);

  // ---- ダブルクリックでのアバター移動 ----
  // クリック位置(画面座標)を、worldRef自身の実測サイズ(mapWidthに対する
  // 拡大率)からマップ座標へ逆算する。worldRefにはscale/カメラ移動の
  // transformが既にかかっているため、getBoundingClientRect()は変換後の
  // 見た目のサイズ・位置をそのまま返してくれる(camera位置を別途持たなくて
  // 済む)。実際の移動処理(経路上の障害物で手前停止・手動操作での
  // キャンセル)はrAFループ側で行う。
  const handleWorldDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // 鍵アイコンなどのボタンをダブルクリックした場合は、その場所への
      // 移動としては扱わない。
      if ((e.target as HTMLElement).closest("button")) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const scale = rect.width / mapSizeRef.current.width;
      if (!scale) return;
      const mapX = (e.clientX - rect.left) / scale;
      const mapY = (e.clientY - rect.top) / scale;
      autoMoveTargetRef.current = {
        x: Math.min(Math.max(mapX, 0), mapSizeRef.current.width),
        y: Math.min(Math.max(mapY, 0), mapSizeRef.current.height),
      };
    },
    [],
  );

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
  // 2026-09 QA指摘: toggleScreenShare/toggleVideoCallと同じ理由で処理中
  // ガードを追加(高速連打でsetMicrophoneEnabledが二重に走るのを防ぐ)。
  const micToggleInFlightRef = useRef(false);
  const toggleMic = useCallback(async () => {
    if (micToggleInFlightRef.current) return;
    setMicError(null);
    const next = !micEnabled;
    if (next && isInWorkZone()) {
      setMicError("作業エリア内では音声通話を利用できません。");
      return;
    }
    if (
      next &&
      voiceCallRemainingRef.current !== null &&
      voiceCallRemainingRef.current <= 0
    ) {
      setMicError(
        "本日の音声通話可能時間の上限に達しています(4:00にリセットされます)。",
      );
      return;
    }
    const room = livekitRoomRef.current;
    if (!room) {
      setMicError(
        "音声サーバーに接続していません。少し待ってから再度お試しください。",
      );
      return;
    }
    micToggleInFlightRef.current = true;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicEnabled(next);
      if (next) {
        // マイクONのたびにトラックが破棄・再生成されるため、その都度
        // ノイズ抑制フィルターを適用し直す。失敗してもマイク自体の動作を
        // 妨げないよう、結果を待たずに呼ぶ(内部でエラーは捕捉済み)。
        void applyNoiseFilterProcessor(room);
      }
      if (selfState.current) {
        selfState.current.micOn = next;
        channelRef.current?.track(selfState.current);
        // selfState.current(ref)を書き換えただけではReactが再レンダリング
        // しないため、その場で動かなくてもマイクアイコンの表示/非表示が
        // 即時に反映されるよう、players Stateも明示的に更新する。
        const self = selfState.current;
        setPlayers((prev) => {
          const current = prev[self.id];
          if (!current) return prev;
          return { ...prev, [self.id]: { ...current, micOn: next } };
        });
      }
    } catch {
      setMicError(
        "マイクを使用できませんでした。ブラウザのアドレスバー付近のマイク許可設定を確認してください。",
      );
    } finally {
      micToggleInFlightRef.current = false;
    }
  }, [micEnabled, isInWorkZone]);

  // 音声通話の残り時間が尽きた際に、マイクを強制的にオフにする(画面共有・
  // ビデオ通話の強制終了と同じ考え方)。次にオンにしようとしてもtoggleMic側
  // のガードで弾かれる。
  const forceMuteMic = useCallback(async () => {
    const room = livekitRoomRef.current;
    if (room) {
      try {
        await room.localParticipant.setMicrophoneEnabled(false);
      } catch {
        // 既にオフになっている場合などは無視
      }
    }
    setMicEnabled(false);
    if (selfState.current) {
      selfState.current.micOn = false;
      channelRef.current?.track(selfState.current);
      const self = selfState.current;
      setPlayers((prev) => {
        const current = prev[self.id];
        if (!current) return prev;
        return { ...prev, [self.id]: { ...current, micOn: false } };
      });
    }
  }, []);

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
  // ミーティングエリア(通常のkind:"meeting"・会議室kind:"conference")は
  // 近接判定(緑サークル)から完全に隔離する。以前は「同じエリアにいれば
  // 無条件で対象」を距離判定のOR条件として足しているだけだったため、
  // 一方だけがエリア内にいる場合には距離判定の方が生きてしまい、エリアの
  // 境界付近で外の人の緑サークルに入ると音声・映像が漏れる不具合があった
  // (2026-09報告)。自分または相手のどちらかがこれらのエリアに関与する
  // 場合は、同じエリアかどうかだけで判定し、距離は一切見ない(=内外を
  // またぐ組み合わせは常に対象外)。"announcement"(全体アナウンス)は
  // 仕様上むしろ全員に届けたいエリアのため対象外のまま、"work"は音声・
  // 映像自体を強制OFFにしているため実質関係ない。
  const isIsolatedMeetingZone = useCallback(
    (zoneId: string | null | undefined) => {
      if (!zoneId) return false;
      const zone = meetingZonesRef.current.find((z) => z.id === zoneId);
      return !zone || (zone.kind !== "announcement" && zone.kind !== "work");
    },
    [],
  );
  const eligiblePeerIds = useMemo(() => {
    const self = players[selfId.current];
    if (!self) return [] as string[];
    return Object.values(players)
      .filter((p) => {
        if (p.id === selfId.current) return false;
        if (
          isIsolatedMeetingZone(self.meetingZoneId) ||
          isIsolatedMeetingZone(p.meetingZoneId)
        ) {
          return (
            !!self.meetingZoneId &&
            !!p.meetingZoneId &&
            self.meetingZoneId === p.meetingZoneId
          );
        }
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

  // ---- 全体アナウンスエリア:音声だけの購読対象を追加で計算 ----
  // 全体アナウンスエリア(kind: "announcement")内でマイクONの相手は、
  // 距離・エリアに関わらずルーム内全員が音声だけ強制購読する(映像は
  // 対象外、通常の近接判定のまま)。カメラ用のeligiblePeerIdsとは別に
  // 音声専用のリストを持つのはこのため。
  const audioEligiblePeerIds = useMemo(() => {
    const announcementZoneIds = new Set(
      meetingZones
        .filter((z) => z.kind === "announcement")
        .map((z) => z.id),
    );
    if (announcementZoneIds.size === 0) return eligiblePeerIds;
    const announcers = Object.values(players)
      .filter(
        (p) =>
          p.id !== selfId.current &&
          !!p.micOn &&
          !!p.meetingZoneId &&
          announcementZoneIds.has(p.meetingZoneId),
      )
      .map((p) => p.id);
    if (announcers.length === 0) return eligiblePeerIds;
    return Array.from(new Set([...eligiblePeerIds, ...announcers])).sort();
  }, [eligiblePeerIds, meetingZones, players]);
  const audioEligibleKey = audioEligiblePeerIds.join(",");
  const audioEligiblePeerIdsRef = useRef<string[]>([]);
  useEffect(() => {
    audioEligiblePeerIdsRef.current = audioEligiblePeerIds;
  }, [audioEligiblePeerIds]);

  // ---- LiveKit(音声・カメラ・画面共有):近接方式に合わせて購読を切り替える ----
  // 接続そのものはLiveKitのRoom(SFU)へ1本だけなので、ここでは相手ごとの
  // トラック購読(setSubscribed)をオン/オフするだけで済む
  // (以前のPeerConnectionメッシュのような接続の作成/破棄は不要)。
  // applyProximitySubscriptionsRefに常に最新版を入れておき、依存配列の
  // 変化を待たずにピンポイントで呼び直せるようにしている(スマホの画面
  // オフ→復帰でLiveKit SDKが裏で再接続している最中にこのeffectが走ると、
  // setSubscribed(true)が再接続処理と競合して反映されないことがあり、
  // 「画面を戻しても相手の声が聞こえず、少し動く(=別の理由でこのeffectが
  // 再実行される)と聞こえる」不具合の原因になっていた。RoomEvent.Reconnected
  // 発火時とタブ/画面復帰時に明示的に呼び直すことで解消する)。
  const applyProximitySubscriptionsRef = useRef<() => void>(() => {});
  useEffect(() => {
    const apply = () => {
      if (!joined) return;
      const room = livekitRoomRef.current;
      if (!room) return;
      const eligibleSet = new Set(eligiblePeerIds);
      const audioEligibleSet = new Set(audioEligiblePeerIds);
      room.remoteParticipants.forEach((participant) => {
        const shouldSubscribeAudio =
          !receptionSuspended && audioEligibleSet.has(participant.identity);
        const shouldSubscribeCamera =
          !receptionSuspended && eligibleSet.has(participant.identity);
        participant.audioTrackPublications.forEach((pub) => {
          if (pub.isSubscribed !== shouldSubscribeAudio) {
            pub.setSubscribed(shouldSubscribeAudio);
          }
        });
        participant.videoTrackPublications.forEach((pub) => {
          // ScreenShareは近接判定ではなく「選択視聴」effectが個別に制御する
          // ため、ここでは対象外とする。
          if (pub.source !== Track.Source.Camera) return;
          if (pub.isSubscribed !== shouldSubscribeCamera) {
            pub.setSubscribed(shouldSubscribeCamera);
          }
        });
      });
    };
    applyProximitySubscriptionsRef.current = apply;
    apply();
    // livekitConnectedもdepsに含める。購読対象(eligibleKey/audioEligibleKey)
    // はSupabase presence/meetingZonesの取得から決まり、LiveKitの接続完了とは
    // 非同期に(どちらが先とも限らないタイミングで)確定する。もし購読対象が
    // 既に確定した"後"でLiveKitが接続完了した場合、depsに変化がないため
    // このeffectは再実行されず、接続直後に一度も購読が反映されないままに
    // なることがあった(G-2: 全体アナウンスエリアで先に発信していた相手の
    // 音声・画面共有が、後から入室した人にだけ届かない不具合の原因)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleKey, audioEligibleKey, joined, livekitConnected, receptionSuspended]);

  // 選択中の相手が画面共有をやめた・近接範囲外に出た場合は選択を解除する。
  // 即座に解除すると、presenceの瞬間的な揺らぎ(A-2で扱った、相手の
  // ハートビートが一瞬途切れて自己修復のremoval対象になりかけるケース等)
  // だけでeligiblePeerIdsやplayersから相手が一時的に消え、実際には
  // 何も変わっていないのに視聴中の全画面表示が閉じてしまうことがあった
  // (I-1)。数秒待っても状況が変わらない(=本当に対象外になった)場合
  // だけ解除するようにする。揺らぎが解消してこの条件を満たさなくなれば
  // (=依存配列が変化してeffectが再実行されれば)、保留中のタイマーは
  // クリーンアップで自動的にキャンセルされる。
  useEffect(() => {
    if (!selectedScreenSharerId) return;
    const stillSharingNearby =
      eligiblePeerIds.includes(selectedScreenSharerId) &&
      players[selectedScreenSharerId]?.sharingScreen;
    if (stillSharingNearby) return;
    const timer = setTimeout(() => {
      setSelectedScreenSharerId(null);
    }, 5000);
    return () => clearTimeout(timer);
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

  // 前回の記録時刻からの実経過時間を計算してサーバーへ加算する
  // (voiceCallの同種の修正と同じ理由。以前は「共有中、30秒おきに固定で
  // 30秒加算」だったため、共有終了の瞬間から次のハートビートまでの端数が
  // 失われ、再開すると使用時間がまき戻って見えていた。2026-09報告)。
  const screenShareLastFlushAtRef = useRef<number | null>(null);
  const flushScreenShareUsage = useCallback(() => {
    const lastAt = screenShareLastFlushAtRef.current;
    if (lastAt === null || screenShareDailyLimitSeconds === null) return;
    const now = Date.now();
    screenShareLastFlushAtRef.current = now;
    const elapsedSeconds = Math.round((now - lastAt) / 1000);
    if (elapsedSeconds <= 0) return;
    supabase
      .rpc("increment_daily_usage_seconds", {
        p_kind: "screen_share",
        seconds: elapsedSeconds,
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
  }, [supabase, screenShareDailyLimitSeconds, stopScreenShare]);

  useEffect(() => {
    if (!joined || screenShareDailyLimitSeconds === null || !screenSharing) {
      return;
    }
    screenShareLastFlushAtRef.current = Date.now();
    const interval = setInterval(flushScreenShareUsage, 30000);
    return () => {
      clearInterval(interval);
      flushScreenShareUsage();
      screenShareLastFlushAtRef.current = null;
    };
  }, [
    joined,
    screenSharing,
    screenShareDailyLimitSeconds,
    flushScreenShareUsage,
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

  // 理由はscreenShare/voiceCallの同種の修正と同じ(2026-09報告)。
  const videoCallLastFlushAtRef = useRef<number | null>(null);
  const flushVideoCallUsage = useCallback(() => {
    const lastAt = videoCallLastFlushAtRef.current;
    if (lastAt === null || videoCallDailyLimitSeconds === null) return;
    const now = Date.now();
    videoCallLastFlushAtRef.current = now;
    const elapsedSeconds = Math.round((now - lastAt) / 1000);
    if (elapsedSeconds <= 0) return;
    supabase
      .rpc("increment_daily_usage_seconds", {
        p_kind: "video_call",
        seconds: elapsedSeconds,
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
  }, [supabase, videoCallDailyLimitSeconds, stopVideoCall]);

  useEffect(() => {
    if (!joined || videoCallDailyLimitSeconds === null || !inCall) return;
    videoCallLastFlushAtRef.current = Date.now();
    const interval = setInterval(flushVideoCallUsage, 30000);
    return () => {
      clearInterval(interval);
      flushVideoCallUsage();
      videoCallLastFlushAtRef.current = null;
    };
  }, [joined, inCall, videoCallDailyLimitSeconds, flushVideoCallUsage]);

  useEffect(() => {
    if (!inCall || videoCallDailyLimitSeconds === null) return;
    const interval = setInterval(() => {
      setVideoCallRemainingSeconds((prev) =>
        prev === null ? prev : Math.max(0, prev - 1),
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [inCall, videoCallDailyLimitSeconds]);

  // ---- 音声通話の「1日あたり利用時間」上限管理(画面共有・ビデオ通話と同じ仕組み) ----
  // 「音声通話中」は、マイクがONかつ近くに人がいる(eligiblePeerIds.length > 0、
  // 実際に音声を送信し得る)状態として計測する(マスター画面の「音声通話中」
  // バッジと同じeligiblePeerIds基準に、送信中かどうかの条件を足したもの)。
  const voiceCallDailyLimitSeconds =
    voiceCallDailyMinutes === null ? null : voiceCallDailyMinutes * 60;
  useEffect(() => {
    if (!joined || voiceCallDailyLimitSeconds === null) return;
    let cancelled = false;
    supabase
      .rpc("get_daily_usage_used_seconds", { p_kind: "voice_call" })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // eslint-disable-next-line no-console
          console.error("音声通話利用時間の取得に失敗しました", error);
          return;
        }
        setVoiceCallRemainingSeconds(
          Math.max(0, voiceCallDailyLimitSeconds - (data ?? 0)),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [joined, supabase, voiceCallDailyLimitSeconds]);

  const isVoiceCallActive = micEnabled && eligiblePeerIds.length > 0;

  // ①③: タブ非アクティブ/バックグラウンド化時に在席ステータスを自動で
  // 切り替えるための共通ヘルパー(設定画面を経由せず、一時的な在席状態
  // だけを変える。saveSettingsと同じ「ref更新→setPlayers→channel.track」
  // のパターン)。
  const applyAutoPresenceStatus = useCallback((status: PresenceStatus) => {
    if (!selfState.current || selfState.current.status === status) return;
    selfState.current.status = status;
    const updated = selfState.current;
    setPlayers((prev) => ({ ...prev, [updated.id]: { ...updated } }));
    channelRef.current?.track(updated);
  }, []);

  // ---- タブ非アクティブ・アプリのバックグラウンド化への対応 ----
  // 永遠ログイン状態(PC)・永遠入室状態を防ぐため。
  // PC(①): マイク・ビデオ通話・画面共有のいずれかがON中は、タブを
  //   切り替えてもステータス変更やカウントダウンは一切行わない
  //   (isActiveCallでガード。既存のisVoiceCallActiveのような周囲判定
  //   ではなく、トグルの生の状態で見る)。いずれもOFFの状態でタブを
  //   非アクティブにした瞬間、即座にステータスを「離席中」にし、8時間
  //   経過でルームから強制退出させる(handleLeaveRoomと同じ、アカウント
  //   のログアウトはしない後始末)。タブに戻ると即座に「通話可能」へ戻す。
  // スマホ(③): PCと異なり、マイク・ビデオがONでも容赦なく画面オフ/
  //   バックグラウンド化した瞬間に強制マイクオフ・ビデオオフにし、
  //   ステータスを「離席中」にする(2026-09報告: スマホは画面を伏せても
  //   通話中判定のまま何もしない旧仕様だと、気づかず延々とマイクが
  //   繋がりっぱなしになってしまうため)。10分間その状態が続いたら
  //   ルームから退室させる(ログアウトはしない・ロビーに戻すだけ。
  //   従来の「アカウントごとログアウト」仕様は廃止した)。タブに戻れば
  //   在席状態のみ「通話可能」に戻す(マイク・ビデオはOFFのままとし、
  //   自動では再開しない)。
  // 自動で「離席中」にした場合のみ、復帰時に「通話可能」へ戻す
  // (autoAwayRefで判定。ユーザーが手動で「取込み中」等を選んでいた
  // 場合にタブ復帰で勝手に上書きしてしまわないようにするため)。
  // hiddenSinceRefは実際に非表示になった時刻(壁時計)を覚えておき、復帰時に
  // 実経過時間を計算するために使う(2026-09報告: スマホは画面オフ中に
  // OSがタブ自体をサスペンドし、setTimeoutが時間通り発火しない/全く発火
  // しないことがある。その状態で画面をオンに戻すと「退室していないまま」
  // 扱いになり、LiveKitが自動再接続して相手にアバターが再表示される不具合
  // があったため、復帰のたびに実時間で猶予を超えていないか検算し、超えて
  // いれば復帰時点で確実に退室させる)。joined中は同じセッションとして
  // 値を保持したいので(タブ非表示のままisActiveCallが変化してeffectが
  // 再実行されても猶予のカウントダウンをリセットしないため)、effect内
  // ローカル変数ではなくuseRefにしている。
  const isActiveCall = micEnabled || inCall || screenSharing;
  const autoAwayRef = useRef(false);
  const hiddenSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!joined) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    // スマホ/PCの判定は、既存のカメラズーム判定(rAFループ)と同じ
    // 画面幅の基準(640px未満)に揃えている。
    const isMobileNow = () =>
      viewportRef.current.width > 0 && viewportRef.current.width < 640;

    const doLeave = () => {
      clearTimer();
      autoAwayRef.current = false;
      hiddenSinceRef.current = null;
      setReceptionSuspended(false);
      handleLeaveRoom();
    };

    const enterHidden = () => {
      clearTimer();
      const mobile = isMobileNow();
      if (!mobile && isActiveCall) return;
      const now = Date.now();
      if (!autoAwayRef.current) {
        autoAwayRef.current = true;
        hiddenSinceRef.current = now;
        applyAutoPresenceStatus("away");
      }
      if (mobile) {
        forceMuteMic();
        stopVideoCall();
        // 送信(マイク・カメラ)だけでなく受信側の購読も止める。止めない
        // と、画面がオフでも近くにいる相手のマイク音声がスピーカーから
        // 鳴り続けてしまう(2026-09報告)。
        setReceptionSuspended(true);
      }
      const thresholdMs =
        (mobile ? MOBILE_AUTO_LOGOUT_SECONDS : DESKTOP_AUTO_LOGOUT_SECONDS) *
        1000;
      const elapsed = now - (hiddenSinceRef.current ?? now);
      const remainingMs = Math.max(0, thresholdMs - elapsed);
      timer = setTimeout(doLeave, remainingMs);
    };

    const enterVisible = () => {
      clearTimer();
      if (!autoAwayRef.current) return;
      const hiddenSince = hiddenSinceRef.current;
      const thresholdMs =
        (isMobileNow()
          ? MOBILE_AUTO_LOGOUT_SECONDS
          : DESKTOP_AUTO_LOGOUT_SECONDS) * 1000;
      if (hiddenSince !== null && Date.now() - hiddenSince >= thresholdMs) {
        doLeave();
        return;
      }
      autoAwayRef.current = false;
      hiddenSinceRef.current = null;
      setReceptionSuspended(false);
      applyAutoPresenceStatus("available");
      // receptionSuspendedの変化に反応する購読effectはこの直後に走るが、
      // ちょうどLiveKit SDKが裏で再接続中だと反映されないことがあるため
      // (RoomEvent.Reconnectedハンドラ参照)、少し待ってからもう一度
      // 明示的に呼び直す保険をかけておく。
      window.setTimeout(() => applyProximitySubscriptionsRef.current(), 1500);
    };

    // ①ウインドウの最小化はvisibilitychangeで捕捉できるはずだが、環境に
    // よっては発火が遅れる/されないことがある(2026-09報告: タブ切替では
    // 離席中になるのに最小化では反応しないケース)。document.hasFocus()
    // (ウインドウの最小化・非フォーカス状態でfalseになる、フォーカス系の
    // 独立したAPI)も合わせて判定することで、タブ切替と最小化を確実に
    // 同じ扱いにする。
    const isEffectivelyHidden = () =>
      document.visibilityState === "hidden" || !document.hasFocus();

    const reconcile = () => {
      if (isEffectivelyHidden()) {
        enterHidden();
      } else {
        enterVisible();
      }
    };

    // ②PCのスリープ/休止からの復帰検知。visibilitychangeだけでは通話中
    // (isActiveCall)の場合にタブ切替と区別できず何もしない仕様のため、
    // スリープしたまま延々と接続が繋がりっぱなしになってしまう。
    // setIntervalは通常のタブ切替や多少のGC停止ではほぼ狂わないが、
    // OSがスリープするとその間タイマー自体が止まるため、次に動き出した
    // 瞬間の実際の経過時間は本来の間隔を大きく超える。この差分(ドリフト)
    // でスリープを検知し、通話中かどうかに関わらず即座にマイク・ビデオ・
    // 画面共有を止めてルームから退出させる(ログアウトはしない)。
    // シャットダウンで実際にプロセスごと終了した場合はこの検知を待たず
    // 下のpagehideで対応する。スマホは画面オフ時の専用処理(enterHidden)
    // で同様のことを行うため対象外とする。
    const HEARTBEAT_MS = 15000;
    const SLEEP_DRIFT_MS = 30000;
    let lastTick = Date.now();
    const heartbeat = setInterval(() => {
      const now = Date.now();
      const gap = now - lastTick;
      lastTick = now;
      if (isMobileNow() || gap <= HEARTBEAT_MS + SLEEP_DRIFT_MS) return;
      forceMuteMic();
      stopVideoCall();
      stopScreenShare();
      doLeave();
    }, HEARTBEAT_MS);

    // ブラウザ/タブを実際に閉じた場合・PCをシャットダウンした場合は、上の
    // タイマーやスリープ検知を待たず即座にルームから退室させる
    // (ログアウトはしない)。pagehideはナビゲーションでも発火するため
    // 誤検知はあるが、副作用はhandleLeaveRoomと同じ「退室」に留まるため
    // 許容する。非同期処理を伴わない同期的な後始末のみのため、ページ破棄
    // 前でも確実に実行できる。
    const onPageHide = () => {
      doLeave();
    };

    if (isEffectivelyHidden()) {
      enterHidden();
    } else {
      // タブが表示・フォーカスされた状態での(再)マウント=新しいjoin
      // セッションの開始とみなし、前回の在席ブックキーピングを持ち越さ
      // ない(万一外部要因(管理者によるkick等)でリセットされないまま
      // 残っていた場合の保険)。
      autoAwayRef.current = false;
      hiddenSinceRef.current = null;
    }
    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("blur", reconcile);
    window.addEventListener("focus", reconcile);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearTimer();
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("blur", reconcile);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [
    joined,
    isActiveCall,
    handleLeaveRoom,
    forceMuteMic,
    stopVideoCall,
    stopScreenShare,
    applyAutoPresenceStatus,
  ]);

  // 前回の記録時刻からの実経過時間を計算してサーバーへ加算する。以前は
  // 「アクティブな間、30秒おきに固定で30秒加算」という作りだったため、
  // (1) マイクOFF・相手が離れる・退出などで通話が終わった瞬間から次の
  //     30秒ハートビートまでの端数(最大30秒弱)が記録されないまま失われ、
  //     再入室すると使用時間がまき戻って見える、
  // (2) スマホでタブがバックグラウンド化するとsetIntervalの発火が遅延・
  //     間引かれることがあり、実際の経過時間とズレる
  // という2つの問題があった(2026-09報告)。実時刻の差分から加算秒数を
  // 求める方式にすることで両方解消する。
  const voiceCallLastFlushAtRef = useRef<number | null>(null);
  const flushVoiceCallUsage = useCallback(() => {
    const lastAt = voiceCallLastFlushAtRef.current;
    if (lastAt === null || voiceCallDailyLimitSeconds === null) return;
    const now = Date.now();
    voiceCallLastFlushAtRef.current = now;
    const elapsedSeconds = Math.round((now - lastAt) / 1000);
    if (elapsedSeconds <= 0) return;
    supabase
      .rpc("increment_daily_usage_seconds", {
        p_kind: "voice_call",
        seconds: elapsedSeconds,
      })
      .then(({ data, error }) => {
        if (error) {
          // eslint-disable-next-line no-console
          console.error("音声通話利用時間の記録に失敗しました", error);
          return;
        }
        const remaining = Math.max(
          0,
          voiceCallDailyLimitSeconds - (data ?? 0),
        );
        setVoiceCallRemainingSeconds(remaining);
        if (remaining <= 0) {
          setMicError(
            "本日の音声通話可能時間の上限に達したため、マイクをオフにしました。",
          );
          forceMuteMic();
        }
      });
  }, [supabase, voiceCallDailyLimitSeconds, forceMuteMic]);

  useEffect(() => {
    if (!joined || voiceCallDailyLimitSeconds === null || !isVoiceCallActive) {
      return;
    }
    voiceCallLastFlushAtRef.current = Date.now();
    const interval = setInterval(flushVoiceCallUsage, 30000);
    return () => {
      clearInterval(interval);
      // マイクOFF・相手が離れる・退出など、アクティブでなくなる瞬間に
      // 前回のハートビートからの端数分も必ずここで記録する。
      flushVoiceCallUsage();
      voiceCallLastFlushAtRef.current = null;
    };
  }, [joined, isVoiceCallActive, voiceCallDailyLimitSeconds, flushVoiceCallUsage]);

  useEffect(() => {
    if (!isVoiceCallActive || voiceCallDailyLimitSeconds === null) return;
    const interval = setInterval(() => {
      setVoiceCallRemainingSeconds((prev) =>
        prev === null ? prev : Math.max(0, prev - 1),
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [isVoiceCallActive, voiceCallDailyLimitSeconds]);

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

  // 相手から離れて映像が届かなくなったら、開いていた全画面表示も自動的に閉じる。
  // 画面共有は選択(クリック)と同時に購読を開始するため、開いた直後は
  // まだストリームが届いていない一瞬が必ずある。一度もストリームが
  // 届いていないうちに「届いていない」を理由に閉じてしまわないよう、
  // 一度でも届いたことがある場合だけ「消えた」を検知して閉じる。
  const expandedMediaHadStreamRef = useRef(false);
  useEffect(() => {
    if (!expandedMedia) {
      expandedMediaHadStreamRef.current = false;
      return;
    }
    const streamMap =
      expandedMedia.kind === "screen" ? remoteScreenStreams : remoteCallStreams;
    if (streamMap[expandedMedia.peerId]) {
      expandedMediaHadStreamRef.current = true;
      return;
    }
    if (expandedMediaHadStreamRef.current) {
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
  // 以前は歯車アイコン(削除済み)を押した瞬間にだけ現在値を読み込んで
  // いたが、タブバーから直接「設定」タブへ切り替えても同じフォームが
  // 開くようになったため、タブがsettingsになるたびに読み込み直す。
  useEffect(() => {
    if (sidebarTab !== "settings") return;
    setSettingsNameInput(selfState.current?.name ?? "");
    setSettingsAvatar(selfState.current?.avatarImage ?? AVATAR_IMAGES[0]);
    setSettingsStatus(selfState.current?.status ?? "available");
    setSettingsMessageInput(selfState.current?.message ?? "");
    setSettingsShowMessage(selfState.current?.showMessage ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarTab]);

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
    setSidebarTab("participants");
    saveDisplayName(name);
    // 入室前画面のname入力(nameInput)は設定変更後も更新されないままだった
    // ため、同じセッション内で退出→再入室すると、この古い値でhandleJoinが
    // 再度saveDisplayNameを呼び、DBの表示名を変更前の名前へ上書きして
    // しまっていた(2026-09報告の「保存しても退出したら元に戻る」の原因)。
    // ここで同期し、次の入室画面にも直近の保存値が反映されるようにする。
    setNameInput(name);
  }, [
    settingsNameInput,
    settingsAvatar,
    settingsStatus,
    settingsMessageInput,
    settingsShowMessage,
    saveDisplayName,
  ]);

  // 入室前の画面にいる間、ルームのRealtimeチャンネルにpresence観測者として
  // 接続し、プレビュー表示用のオンライン人数を取得する(入室後は不要なので
  // joinedになったら購読解除する)。
  useEffect(() => {
    if (joined || rooms.length === 0) return;
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
  }, [joined, rooms, supabase]);

  // ---- 入室前:ルームプレビュー(選択不可)・アバター選択・名前入力 ----
  // F-2でルーム選択画面を廃止し、ログイン後は直接この画面へ来る。
  if (!joined) {
    const room = rooms[0];
    return (
      <div className="flex h-full w-full items-center justify-center overflow-hidden bg-slate-900 px-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
          {room ? (
            <div className="mb-4 overflow-hidden rounded-lg bg-slate-100">
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
            </div>
          ) : (
            <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              まだルームがありません。管理画面からルームを作成してください。
            </p>
          )}

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
            disabled={!room}
            className="w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
          >
            入室
          </button>

          {/* ログインフロー統一(2026-08-24): 管理者は/adminへ自動転送
              されなくなったため、ロビー画面からも管理画面へ行けるように
              する(入室後の設定タブ内の同種リンクは既存のまま維持)。
              isAccountAdminがtrueになるのは常に「自分自身のアカウントの
              ルームを見ている」場合のみ(他人の招待URLを閲覧中の画面では
              isAccountAdminは常にfalseで、このボタン自体が表示されない)
              ため、退室処理は不要で単純なリンクでよい(2026-08-29確認)。 */}
          {isAccountAdmin && (
            <Link
              href="/admin"
              className="mt-2 block w-full rounded-lg bg-slate-100 py-2 text-center text-sm font-semibold text-slate-700 hover:bg-slate-200"
            >
              管理画面へ
            </Link>
          )}
        </div>
      </div>
    );
  }

  const playerList = Object.values(players);

  // 「チャット」タブに表示する未読合計(DM+グループ)。
  const chatThreadsTotalUnreadCount = chatThreads.reduce(
    (sum, t) => sum + t.unreadCount,
    0,
  );
  const mentionsUnreadCount = mentions.filter((m) => !m.readAt).length;

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
  // 作業エリア内かどうか(マイク・ビデオ通話・画面共有ボタンをグレーアウトするため)。
  const selfInWorkZone = selfPlayer?.meetingZoneId
    ? meetingZones.find((z) => z.id === selfPlayer.meetingZoneId)?.kind ===
      "work"
    : false;
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
      {/* 入室直後のアバタースプライト読み込み中はこのオーバーレイで画面全体を
          覆い、下の移動ボタン等へのタップも吸収する(キーボード操作は
          移動ループ側のassetsReadyRefチェックでロックしている)。 */}
      {!assetsReady && (
        <div className="pointer-events-auto absolute inset-0 z-[9999] flex flex-col items-center justify-center gap-3 bg-slate-900/90 text-white">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/30 border-t-white" />
          <p className="text-sm">読み込み中…</p>
        </div>
      )}
      {/* ヘッダー */}
      <div className="flex h-16 min-w-0 items-center justify-between gap-2 border-b border-slate-700 bg-slate-900 px-4 text-white">
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
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="flex shrink-0 flex-col items-center">
              <MicButton
                enabled={micEnabled}
                onClick={toggleMic}
                disabled={selfInWorkZone}
              />
              {voiceCallRemainingSeconds !== null && (
                <span
                  className={`mt-0.5 inline text-[9px] leading-none ${
                    voiceCallRemainingSeconds <= 0
                      ? "text-red-400"
                      : "text-slate-400"
                  }`}
                  title="音声通話の本日の残り利用可能時間(4:00にリセット)"
                >
                  残{formatRemainingTime(voiceCallRemainingSeconds)}
                </span>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-center">
              <ScreenShareButton
                enabled={screenSharing}
                onClick={toggleScreenShare}
                disabled={selfInWorkZone}
              />
              {screenShareRemainingSeconds !== null && (
                <span
                  className={`mt-0.5 inline text-[9px] leading-none ${
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
              <VideoCallButton
                enabled={inCall}
                onClick={toggleVideoCall}
                disabled={selfInWorkZone}
              />
              {videoCallRemainingSeconds !== null && (
                <span
                  className={`mt-0.5 inline text-[9px] leading-none ${
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
            <div className="shrink-0">
              <LeaveRoomButton onClick={handleLeaveRoom} />
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

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* マップ:表示領域は固定し、中の世界をtransformで動かしてカメラ追従を実現。
            transformの更新は毎フレームDOM操作で行うため、ここでは初期値のみ指定する。
            flexアイテムはデフォルトでmin-width/min-height: autoになり、中身が
            大きいと縮まず親を押し広げてしまうことがあるため、min-w-0/min-h-0で
            明示的に「縮んでよい」ことを指定しておく(中身のworldRefはposition:
            absoluteなので通常は影響しないはずだが、念のための保険)。 */}
        <div
          ref={containerRef}
          className="relative min-w-0 flex-1 overflow-hidden bg-slate-700 sm:order-3"
        >
          {/* 画面共有・ビデオ通話のプレビュー(自分・近くにいる相手)。
              以前はサイドバーと横並びの上部バーとして画面全幅に表示して
              いたため、サイドバーの上に覆いかぶさって見えていた
              (2026-09報告)。アバター空間(このcontainerRef)の上部に
              浮かせるabsoluteオーバーレイに変更し、サイドバーの右側
              (=アバター空間の幅の中)だけに収まるようにした。 */}
          {(screenSharing ||
            inCall ||
            visibleScreenShares.length > 0 ||
            visibleVideoCalls.length > 0) && (
            <div className="absolute left-0 right-0 top-0 z-20 flex flex-wrap gap-2 bg-slate-900/80 px-3 py-2">
              {screenSharing && screenStreamRef.current && (
                <div className="relative">
                  {screenPreviewImages[selfId.current] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={screenPreviewImages[selfId.current]}
                      alt="あなたの画面共有プレビュー"
                      className="h-20 w-32 rounded-md border border-emerald-400 bg-black object-contain"
                    />
                  ) : (
                    <div className="flex h-20 w-32 items-center justify-center rounded-md border border-emerald-400 bg-black text-[10px] text-slate-300">
                      共有中...
                    </div>
                  )}
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

              {videoPausedForScreenView ? (
                <div className="flex h-20 w-32 items-center justify-center rounded-md border border-slate-500 bg-slate-800 px-1 text-center text-[9px] text-slate-300">
                  画面共有視聴中
                </div>
              ) : (
                inCall &&
                cameraStreamRef.current && (
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
                )
              )}

              {/* 画面共有は同時に何人でも共有できるが、視聴は1人だけ選ぶ方式。
                  小さいプレビューは常に共有開始時点の静止画(ライブ映像には
                  しない)、1回のクリックで購読開始と同時に全画面表示へ進む
                  (以前の「黒→静止画プレビュー→全画面」の3段階を、
                  「静止画プレビュー→全画面」の2段階に短縮)。 */}
              {visibleScreenShares.map((p) => (
                <button
                  key={`screen-${p.id}`}
                  onClick={() => {
                    setSelectedScreenSharerId(p.id);
                    setExpandedMedia({ peerId: p.id, kind: "screen" });
                  }}
                  className="relative"
                  aria-label={`${p.name}の画面を全画面表示`}
                >
                  {screenPreviewImages[p.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={screenPreviewImages[p.id]}
                      alt={`${p.name}の画面共有プレビュー`}
                      className="h-20 w-32 rounded-md border border-slate-500 bg-black object-contain"
                    />
                  ) : (
                    <div className="flex h-20 w-32 items-center justify-center rounded-md border border-slate-500 bg-black text-[10px] text-slate-300">
                      入室中...
                    </div>
                  )}
                  <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
                    {p.name}の画面
                  </span>
                </button>
              ))}

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

          <div
            ref={worldRef}
            className="absolute left-0 top-0"
            onDoubleClick={handleWorldDoubleClick}
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
                同じ(同エリア内での自動音声接続)。ラベルは出さないが、部屋の
                境界がわかるよう薄黄緑の背景・薄緑の枠で塗る。 */}
            {meetingZones.map((zone) =>
              zone.kind === "conference" ? (
                (() => {
                  const locker = Object.values(players).find(
                    (p) => p.lockedMeetingZoneId === zone.id,
                  );
                  return (
                    <div
                      key={zone.id}
                      className={`absolute rounded-xl border ${
                        locker
                          ? "border-red-300 bg-pink-200/30"
                          : "border-green-300 bg-lime-200/20"
                      }`}
                      style={{
                        left: zone.x,
                        top: zone.y,
                        width: zone.width,
                        height: zone.height,
                      }}
                    >
                      {/* 施錠アイコン:このゾーンに現在いる人にだけ操作させる
                          (入室していない相手には見せない=押せない)。 */}
                      {selfPlayer?.meetingZoneId === zone.id && (
                        <button
                          type="button"
                          onClick={() => handleLockIconClick(zone.id)}
                          className="absolute left-1 top-1 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white shadow hover:bg-black/80"
                          aria-label={locker ? "施錠を解除する" : "施錠する"}
                          title={locker ? "施錠を解除する" : "施錠する"}
                        >
                          {locker ? "🔒" : "🔓"}
                        </button>
                      )}
                    </div>
                  );
                })()
              ) : (
                <div
                  key={zone.id}
                  className={`absolute flex items-start rounded-xl border p-2 ${
                    zone.kind === "announcement"
                      ? "border-amber-400 bg-amber-500/20"
                      : zone.kind === "work"
                        ? "border-sky-400 bg-sky-500/20"
                        : "border-slate-500 bg-slate-600/60"
                  }`}
                  style={{
                    left: zone.x,
                    top: zone.y,
                    width: zone.width,
                    height: zone.height,
                  }}
                >
                  <span
                    className={`text-[11px] ${
                      zone.kind === "announcement"
                        ? "text-amber-200"
                        : zone.kind === "work"
                          ? "text-sky-200"
                          : "text-slate-300"
                    }`}
                  >
                    {zone.kind === "announcement" ? "📢 " : ""}
                    {zone.kind === "work" ? "🔇 " : ""}
                    {zone.label}
                  </span>
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

            {/* ワープポイント。半透明の色付き円で見えるようにする
                (テンプレート編集画面と同系色)。 */}
            {warpPoints.map((w) => (
              <div key={w.id}>
                {w.label && (
                  <div
                    className="pointer-events-none absolute flex justify-center"
                    style={{
                      left: w.x - WARP_POINT_RADIUS,
                      top: w.y - WARP_POINT_RADIUS,
                      width: WARP_POINT_RADIUS * 2,
                      transform: "translateY(-100%)",
                    }}
                  >
                    <span className="whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                      {w.label}
                    </span>
                  </div>
                )}
                <div
                  className={`pointer-events-none absolute flex items-center justify-center rounded-full border-2 text-xs font-bold text-white ${warpChannelClasses(w.channel)}`}
                  style={{
                    left: w.x - WARP_POINT_RADIUS,
                    top: w.y - WARP_POINT_RADIUS,
                    width: WARP_POINT_RADIUS * 2,
                    height: WARP_POINT_RADIUS * 2,
                  }}
                >
                  {w.channel}
                </div>
              </div>
            ))}

            {/* 自分の音声が届く範囲の目安(マイクON時のみ表示。位置は毎フレームDOM操作で更新) */}
            <div
              ref={proximityCircleRef}
              className={`pointer-events-none absolute left-0 top-0 rounded-full border-2 border-emerald-400/40 ${
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
                noticeText={
                  p.id === selfId.current && lockedZoneNotice
                    ? "鍵がかかっています"
                    : undefined
                }
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

        {/* サイドバー:オンラインリスト+DM(スマホはドロワー表示・画面幅
            100%。PC版は右端のハンドルでドラッグリサイズ可能、幅は
            --sidebar-width(px)で制御し、リロードすると既定幅に戻る)。 */}
        <div
          className={`${
            showParticipants ? "flex" : "hidden"
          } fixed inset-y-0 left-0 z-40 w-full flex-col border-r border-slate-700 bg-slate-900 text-white sm:static sm:z-auto sm:order-1 sm:flex sm:w-[var(--sidebar-width)] sm:shrink-0`}
          style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
        >
          {/* サイドバー本体:ヘッダー+タブ(参加者/チャット/設定)+
              選択中タブの中身。中身はタブごとに排他的に描画するため、
              表示中のタブがflex-1で残り高さを使い切る。 */}
          <div className="flex min-h-0 flex-1 flex-col pl-4 pr-3 pb-3 sm:pt-2">
            {/* ヘッダー:アイコン(左上)+閉じるボタン(右上)。スマホの
                ドロワー表示専用(PC版は常設サイドバーなので、上部の
                メインヘッダーのロゴと重複するため非表示にする)。
                高さ(h-16)・左の余白(px-4)をメインヘッダーと揃えることで、
                ハンバーガーメニューの開閉時にロゴの位置がずれて見えない
                ようにする(PC版はこの行自体が非表示になる分、親要素側の
                sm:pt-2で元の上余白を維持する)。 */}
            <div className="mb-4 flex h-16 shrink-0 items-center justify-between sm:hidden">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo.png"
                  alt="Globy"
                  className="h-5 w-5 object-contain"
                />
              </div>
              <button
                onClick={() => setShowParticipants(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-2xl text-slate-300 hover:bg-slate-800 hover:text-white sm:hidden"
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>

            {/* タブ切替:参加者/チャット/通知/設定。「チャット」「通知」
                タブにはそれぞれの未読件数をバッジ表示する。 */}
            <div className="mb-3 flex shrink-0 gap-1 rounded-lg bg-white/5 p-1 text-xs font-semibold">
              {(
                [
                  {
                    key: "participants" as const,
                    label: "参加者",
                    Icon: TabIconPerson,
                    unread: 0,
                  },
                  {
                    key: "chat" as const,
                    label: "チャット",
                    Icon: TabIconChat,
                    unread: chatThreadsTotalUnreadCount,
                  },
                  {
                    key: "notifications" as const,
                    label: "通知",
                    Icon: TabIconBell,
                    unread: mentionsUnreadCount,
                  },
                  {
                    key: "settings" as const,
                    label: "設定",
                    Icon: TabIconGear,
                    unread: 0,
                  },
                ]
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setSidebarTab(tab.key)}
                  title={tab.label}
                  aria-label={tab.label}
                  className={`relative flex flex-1 items-center justify-center rounded-md py-2 transition-colors ${
                    sidebarTab === tab.key
                      ? "bg-emerald-600 text-white"
                      : "text-slate-300 hover:bg-white/10"
                  }`}
                >
                  <tab.Icon className="h-5 w-5" />
                  {tab.unread > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white">
                      {tab.unread > 99 ? "99+" : tab.unread}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {sidebarTab === "participants" && (
              <>
                <h2 className="mb-2 shrink-0 text-xs font-semibold text-slate-400">
                  自分
                </h2>
                {selfPlayer && (
                  <div className="mb-3 flex shrink-0 items-center gap-2 text-sm">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          PRESENCE_STATUS_COLORS[selfPlayer.status ?? "available"],
                      }}
                    />
                    <span className="truncate">{selfPlayer.name}</span>
                  </div>
                )}

                <h2 className="mb-2 shrink-0 text-xs font-semibold text-slate-400">
                  参加者
                </h2>
                <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                  {playerList
                    .filter((p) => p.id !== selfId.current)
                    .map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => {
                            if (!p.userId) return;
                            setSelectedGroupId(null);
                            setSelectedPeerUserId(p.userId);
                            setSidebarTab("chat");
                          }}
                          disabled={!p.userId}
                          className={`flex w-full items-center gap-1.5 rounded px-1 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              </>
            )}

            {sidebarTab === "chat" && (
              <div
                className={`flex min-h-0 flex-1 flex-col ${
                  dmDragActive || groupDragActive
                    ? "ring-2 ring-inset ring-emerald-400"
                    : ""
                }`}
                onDragOver={(e) => {
                  if (selectedPeerUserId) {
                    e.preventDefault();
                    setDmDragActive(true);
                  } else if (selectedGroupId) {
                    e.preventDefault();
                    setGroupDragActive(true);
                  }
                }}
                onDragLeave={() => {
                  setDmDragActive(false);
                  setGroupDragActive(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDmDragActive(false);
                  setGroupDragActive(false);
                  const files = Array.from(e.dataTransfer.files ?? []);
                  if (files.length === 0) return;
                  if (selectedPeerUserId) stageDmImages(files);
                  else if (selectedGroupId) stageGroupImages(files);
                }}
              >
                {!selectedPeerUserId && !selectedGroupId ? (
                  <>
                    {chatThreadsLoading ? (
                      <div className="flex flex-1 items-center justify-center px-3 text-center text-[11px] text-slate-500">
                        読み込み中...
                      </div>
                    ) : chatThreadsError ? (
                      <div className="flex flex-1 items-center justify-center px-3 text-center text-[11px] text-red-500">
                        {chatThreadsError}
                      </div>
                    ) : chatThreads.length === 0 ? (
                      <div className="flex flex-1 items-center justify-center px-3 text-center text-[11px] text-slate-500">
                        参加者を選んでチャットを開始してください
                      </div>
                    ) : (
                      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                        {chatThreads.map((t) => (
                          <li key={`${t.isGroup ? "group" : "dm"}-${t.threadId}`}>
                            <button
                              type="button"
                              onClick={() => {
                                // スマホでの長押しでメニューを開いた直後は、
                                // 指を離した際のclickでスレッドまで開いて
                                // しまわないようにする。
                                if (groupLongPressFiredRef.current) {
                                  groupLongPressFiredRef.current = false;
                                  return;
                                }
                                if (t.isGroup) {
                                  setSelectedPeerUserId(null);
                                  setSelectedGroupId(t.threadId);
                                } else {
                                  setSelectedGroupId(null);
                                  setSelectedPeerUserId(t.threadId);
                                }
                              }}
                              onContextMenu={(e) => {
                                if (!t.isGroup) return;
                                e.preventDefault();
                                setGroupContextMenu({
                                  groupId: t.threadId,
                                  x: e.clientX,
                                  y: e.clientY,
                                });
                              }}
                              onTouchStart={(e) => {
                                if (!t.isGroup) return;
                                handleGroupTouchStart(e, t.threadId);
                              }}
                              onTouchMove={handleGroupTouchMove}
                              onTouchEnd={handleGroupTouchEnd}
                              onTouchCancel={handleGroupTouchEnd}
                              className="flex w-full items-center gap-2 rounded px-1 py-2 text-left transition-colors hover:bg-white/5"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="min-w-0 truncate text-sm">
                                    {t.isGroup ? "👥 " : ""}
                                    {t.threadName}
                                  </span>
                                  <span className="shrink-0 text-[10px] leading-none text-slate-400">
                                    {formatDmListTime(t.lastMessageAt)}
                                  </span>
                                </div>
                                <div className="mt-0.5 flex items-center justify-between gap-2">
                                  <span className="min-w-0 truncate text-xs text-slate-400">
                                    {t.lastMessage}
                                  </span>
                                  {t.unreadCount > 0 && (
                                    <span
                                      className="flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white"
                                      title="未読メッセージがあります"
                                    >
                                      {t.unreadCount > 99 ? "99+" : t.unreadCount}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setCreateGroupSelectedIds(new Set());
                        setShowCreateGroupModal(true);
                      }}
                      className="mt-2 shrink-0 rounded-lg border border-dashed border-slate-600 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5"
                    >
                      ＋ グループチャット作成
                    </button>
                  </>
                ) : null}
                {(() => {
              const peer = selectedPeerUserId
                ? playerList.find((p) => p.userId === selectedPeerUserId)
                : null;
              if (!selectedPeerUserId) {
                return null;
              }
              // 今オンラインでない相手(チャット履歴一覧経由で開いた場合など)
              // は playerList には出てこないため、list_chat_threads側の
              // 最新表示名にフォールバックする。
              const threadSummary = chatThreads.find(
                (t) => !t.isGroup && t.threadId === selectedPeerUserId,
              );
              const thread = dmThreads[selectedPeerUserId] ?? [];
              return (
                <>
                  <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
                    <h2 className="truncate text-xs font-semibold text-slate-300">
                      {peer?.name ?? threadSummary?.threadName ?? "退出したユーザー"}
                    </h2>
                    <button
                      onClick={() => setSelectedPeerUserId(null)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base text-slate-300 hover:bg-slate-800 hover:text-white"
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
                      {thread.map((m) => {
                        const groupedReactions = groupChatReactions(
                          m.reactions,
                          authUserIdRef.current,
                        );
                        return (
                        // 削除済みメッセージはリアルタイム反映・初回読み込み
                        // どちらの経路でもthreadから除外済みのため、ここでは
                        // 通常メッセージのみを描画すればよい。
                        <div
                          key={m.id}
                          className={`flex flex-col ${m.isSelf ? "items-end" : "items-start"}`}
                        >
                          <div
                            className="relative"
                            onMouseEnter={() => openDmHover(m.id)}
                            onMouseLeave={() => scheduleDmHoverClose(m.id)}
                          >
                            {dmHoverMessageId === m.id &&
                              (() => {
                                // チャットパネル(スクロール領域)の外に
                                // はみ出さないよう、吹き出し中心を基準に
                                // 画面固定座標でクランプする。CSSの
                                // left-1/2 + -translate-x-1/2だけだと、
                                // PC版はチャットパネル自体がブラウザ幅
                                // より狭いサイドバーのため、画面左端に近い
                                // 短い吹き出しでパネル外(背景の地図側)まで
                                // はみ出してしまっていた。
                                const bubbleEl =
                                  dmBubbleRefs.current[m.id]?.parentElement;
                                const panelEl = dmScrollRef.current;
                                if (!bubbleEl || !panelEl) return null;
                                const bubbleRect =
                                  bubbleEl.getBoundingClientRect();
                                const panelRect =
                                  panelEl.getBoundingClientRect();
                                const BAR_WIDTH = 180;
                                const left = Math.min(
                                  Math.max(
                                    bubbleRect.left +
                                      bubbleRect.width / 2 -
                                      BAR_WIDTH / 2,
                                    panelRect.left + 4,
                                  ),
                                  panelRect.right - BAR_WIDTH - 4,
                                );
                                return (
                                  <div
                                    className="fixed z-30 flex justify-center gap-0.5 rounded-full bg-slate-800 px-1.5 py-1 shadow-lg"
                                    style={{
                                      left,
                                      top: bubbleRect.top,
                                      width: BAR_WIDTH,
                                      transform: "translateY(calc(-100% - 4px))",
                                    }}
                                  >
                                    {REACTION_EMOJIS.map((emoji) => (
                                      <button
                                        key={emoji}
                                        type="button"
                                        onClick={() =>
                                          handleDmReactionSelect(m, emoji)
                                        }
                                        className="flex h-6 w-6 items-center justify-center rounded-full text-sm hover:bg-slate-700"
                                      >
                                        {emoji}
                                      </button>
                                    ))}
                                  </div>
                                );
                              })()}
                        <div
                          onContextMenu={(e) => handleDmContextMenu(e, m)}
                          onTouchStart={(e) => handleDmTouchStart(e, m)}
                          onTouchMove={handleDmTouchMove}
                          onTouchEnd={handleDmTouchEnd}
                          onTouchCancel={handleDmTouchEnd}
                          className={`dm-selectable w-fit max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs ${
                            dmSelectionModeMessageId === m.id
                              ? "dm-select-active"
                              : ""
                          } ${
                            m.isSelf
                              ? "ml-auto bg-emerald-600 text-white"
                              : "bg-slate-700 text-slate-100"
                          }`}
                        >
                          {/*
                            (編集済み)ラベルはこの<p>の外に置く。
                            「部分コピー」はこの<p>のDOMノード全体を
                            Range.selectNodeContentsで選択するため、
                            <p>の中に入れるとコピー内容に混ざってしまう。
                          */}
                          {/*
                            <p>はテキストが空(画像のみのメッセージ)でも
                            常にマウントする。dmBubbleRefsは右クリック
                            メニューの位置計算(親要素=吹き出し全体のrect)に
                            使われるため、条件付きでアンマウントすると
                            画像のみのメッセージでメニュー位置が取れなくなる。
                          */}
                          {m.imagePath && dmImageLoadFailed[m.id] && (
                            <button
                              type="button"
                              onClick={() => retryDmImageUrl(m.id)}
                              className={`flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-md bg-slate-600/60 text-[9px] text-slate-300 hover:bg-slate-600 ${
                                m.message ? "mb-1" : ""
                              }`}
                            >
                              <span>読み込めません</span>
                              <span className="underline">タップで再試行</span>
                            </button>
                          )}
                          {m.imagePath && !dmImageLoadFailed[m.id] && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={dmImageUrls[m.id]}
                              alt="添付画像"
                              onClick={() => {
                                const url = dmImageUrls[m.id];
                                if (url) setDmLightbox({ messageId: m.id, url });
                              }}
                              onError={() => {
                                // 署名付きURLの取得自体は成功したが、実際の画像
                                // 読み込み(ブラウザ側のGET)が失敗したケース
                                // (期限切れ・ネットワーク不調等)。
                                if (dmImageUrls[m.id]) {
                                  // eslint-disable-next-line no-console
                                  console.error(
                                    "添付画像の読み込みに失敗しました",
                                    m.id,
                                    dmImageUrls[m.id],
                                  );
                                  setDmImageLoadFailed((prev) => ({
                                    ...prev,
                                    [m.id]: true,
                                  }));
                                }
                              }}
                              className={`block max-h-56 max-w-full rounded-md object-contain ${
                                m.message ? "mb-1" : ""
                              } ${
                                dmImageUrls[m.id]
                                  ? "cursor-pointer"
                                  : "min-h-16 min-w-16 animate-pulse bg-slate-600"
                              }`}
                            />
                          )}
                          <p
                            ref={(el) => {
                              dmBubbleRefs.current[m.id] = el;
                            }}
                            className="inline whitespace-pre-wrap break-words"
                          >
                            {m.message}
                          </p>
                          {m.editedAt && (
                            <span
                              className={`ml-1 text-[10px] ${
                                m.isSelf ? "text-emerald-100" : "text-slate-400"
                              }`}
                            >
                              (編集済み)
                            </span>
                          )}
                        </div>
                          </div>
                          <p className="mt-0.5 text-[10px] text-slate-400">
                            {formatDmMessageTime(m.createdAt)}
                          </p>
                          {groupedReactions.length > 0 && (
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              {groupedReactions.map((g) => (
                                <button
                                  key={g.emoji}
                                  type="button"
                                  onClick={() => {
                                    if (g.mine) {
                                      handleDmReactionSelect(m, g.emoji);
                                    }
                                  }}
                                  className={`rounded-full border px-1.5 py-0.5 text-[11px] leading-none ${
                                    g.mine
                                      ? "cursor-pointer border-emerald-400 bg-emerald-500/20 text-emerald-100"
                                      : "cursor-default border-slate-600 bg-slate-800/70 text-slate-200"
                                  }`}
                                >
                                  {g.emoji}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        );
                      })}
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
                  {dmEditingMessageId && (
                    <div className="flex items-center justify-between border-t border-slate-700 bg-slate-800/60 px-3 py-1.5 text-[11px] text-slate-300">
                      <span>編集中</span>
                      <button
                        type="button"
                        onClick={cancelEditDmMessage}
                        className="text-slate-400 hover:text-white"
                      >
                        キャンセル
                      </button>
                    </div>
                  )}
                  {dmPendingImages.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto border-t border-slate-700 bg-slate-800/60 px-3 py-2">
                      {dmPendingImages.map((p) => (
                        <div
                          key={p.id}
                          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-700/70 py-1 pl-1 pr-2"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setDmLightbox({ messageId: null, url: p.previewUrl })
                            }
                            className="shrink-0"
                            aria-label="添付画像を拡大表示"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={p.previewUrl}
                              alt=""
                              className="h-8 w-8 rounded object-cover"
                            />
                          </button>
                          <div className="min-w-0 max-w-[110px] text-[10px] text-slate-300">
                            <p className="truncate font-medium">{p.file.name}</p>
                            {p.width && p.height && (
                              <p className="text-slate-500">
                                {p.width}×{p.height}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => cancelDmPendingImage(p.id)}
                            disabled={dmImageUploading}
                            aria-label="添付を取り消す"
                            className="shrink-0 text-slate-400 hover:text-white disabled:opacity-30"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {dmUploadProgress && (
                    <div className="border-t border-slate-700 bg-slate-800/60 px-3 py-2">
                      <div className="mb-1 flex items-center justify-between text-[10px] text-slate-300">
                        <span>
                          {dmUploadProgress.phase === "uploading"
                            ? `アップロード中 (${dmUploadProgress.index + 1}/${dmUploadProgress.total}) ${dmUploadProgress.percent}%`
                            : `圧縮中… (${dmUploadProgress.index + 1}/${dmUploadProgress.total})`}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
                        <div
                          className={`h-full rounded-full bg-emerald-500 ${
                            dmUploadProgress.phase === "uploading"
                              ? "transition-all"
                              : "animate-pulse"
                          }`}
                          style={{
                            width:
                              dmUploadProgress.phase === "uploading"
                                ? `${dmUploadProgress.percent}%`
                                : "100%",
                          }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 border-t border-slate-700 p-2">
                    <input
                      ref={dmImageInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        e.target.value = "";
                        if (files.length > 0) stageDmImages(files);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => dmImageInputRef.current?.click()}
                      disabled={dmImageUploading || dmSending}
                      title="画像を添付"
                      aria-label="画像を添付"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-600 text-sm font-semibold leading-none text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                    >
                      {dmImageUploading ? "…" : "+"}
                    </button>
                    <input
                      value={dmInput}
                      onChange={(e) => setDmInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                          if (dmEditingMessageId) {
                            updateDmMessage();
                          } else {
                            sendDmMessage();
                          }
                        }
                      }}
                      onPaste={(e) => {
                        const items = e.clipboardData?.items;
                        if (!items) return;
                        const imageFiles: File[] = [];
                        for (let i = 0; i < items.length; i++) {
                          const item = items[i];
                          if (item.type.startsWith("image/")) {
                            const file = item.getAsFile();
                            if (file) imageFiles.push(file);
                          }
                        }
                        if (imageFiles.length > 0) {
                          e.preventDefault();
                          stageDmImages(imageFiles);
                        }
                      }}
                      maxLength={500}
                      placeholder="メッセージを入力"
                      className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs text-white outline-none focus:border-slate-400"
                    />
                    <button
                      onClick={dmEditingMessageId ? updateDmMessage : sendDmMessage}
                      disabled={
                        dmEditingMessageId
                          ? !dmInput.trim() || dmSending
                          : (!dmInput.trim() && dmPendingImages.length === 0) ||
                            dmSending ||
                            dmImageUploading
                      }
                      className="flex h-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 px-3 text-xs font-semibold leading-none text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {dmEditingMessageId
                        ? "更新"
                        : dmImageUploading
                          ? "送信中..."
                          : "送信"}
                    </button>
                  </div>
                </>
              );
            })()}
                {(() => {
                  if (!selectedGroupId) return null;
                  const threadSummary = chatThreads.find(
                    (t) => t.isGroup && t.threadId === selectedGroupId,
                  );
                  const thread = groupThreads[selectedGroupId] ?? [];
                  return (
                    <>
                      <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
                        <h2 className="truncate text-xs font-semibold text-slate-300">
                          👥 {threadSummary?.threadName ?? "グループ"}
                        </h2>
                        <button
                          onClick={() => setSelectedGroupId(null)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base text-slate-300 hover:bg-slate-800 hover:text-white"
                          aria-label="チャットを閉じる"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="relative min-h-0 flex-1">
                        <div
                          ref={groupScrollRef}
                          className="h-full space-y-2 overflow-y-auto px-3 py-2"
                        >
                          {thread.length === 0 && (
                            <p className="mt-4 text-center text-[11px] text-slate-500">
                              まだメッセージはありません
                            </p>
                          )}
                          {thread.map((m) => {
                            const groupedReactions = m.isSystem
                              ? []
                              : groupChatReactions(
                                  m.reactions,
                                  authUserIdRef.current,
                                );
                            return m.isSystem ? (
                              // 退出通知など。通常の吹き出しとは区別し、
                              // 枠なし・赤文字のみで中央に表示する。
                              <p
                                key={m.id}
                                className="py-1 text-center text-[11px] text-red-400"
                              >
                                {m.message}
                              </p>
                            ) : (
                              <div
                                key={m.id}
                                className={`flex flex-col ${m.isSelf ? "items-end" : "items-start"}`}
                              >
                              {!m.isSelf && (
                                <p className="mb-0.5 text-[10px] font-semibold text-slate-400">
                                  {groupMemberNameById.get(m.senderUserId) ??
                                    m.senderName}
                                </p>
                              )}
                              <div
                                className="relative"
                                onMouseEnter={() => openGroupHover(m.id)}
                                onMouseLeave={() =>
                                  scheduleGroupHoverClose(m.id)
                                }
                              >
                                {groupHoverMessageId === m.id &&
                                  (() => {
                                    // 理由はDM側(dmHoverMessageId)と同じ。
                                    const bubbleEl =
                                      groupBubbleRefs.current[m.id];
                                    const panelEl = groupScrollRef.current;
                                    if (!bubbleEl || !panelEl) return null;
                                    const bubbleRect =
                                      bubbleEl.getBoundingClientRect();
                                    const panelRect =
                                      panelEl.getBoundingClientRect();
                                    const BAR_WIDTH = 180;
                                    const left = Math.min(
                                      Math.max(
                                        bubbleRect.left +
                                          bubbleRect.width / 2 -
                                          BAR_WIDTH / 2,
                                        panelRect.left + 4,
                                      ),
                                      panelRect.right - BAR_WIDTH - 4,
                                    );
                                    return (
                                      <div
                                        className="fixed z-30 flex justify-center gap-0.5 rounded-full bg-slate-800 px-1.5 py-1 shadow-lg"
                                        style={{
                                          left,
                                          top: bubbleRect.top,
                                          width: BAR_WIDTH,
                                          transform:
                                            "translateY(calc(-100% - 4px))",
                                        }}
                                      >
                                        {REACTION_EMOJIS.map((emoji) => (
                                          <button
                                            key={emoji}
                                            type="button"
                                            onClick={() =>
                                              handleGroupReactionSelect(
                                                m,
                                                emoji,
                                              )
                                            }
                                            className="flex h-6 w-6 items-center justify-center rounded-full text-sm hover:bg-slate-700"
                                          >
                                            {emoji}
                                          </button>
                                        ))}
                                      </div>
                                    );
                                  })()}
                              <div
                                ref={(el) => {
                                  groupBubbleRefs.current[m.id] = el;
                                }}
                                onContextMenu={(e) =>
                                  handleGroupMessageContextMenu(e, m)
                                }
                                onTouchStart={(e) =>
                                  handleGroupMessageTouchStart(e, m)
                                }
                                onTouchMove={handleGroupMessageTouchMove}
                                onTouchEnd={handleGroupMessageTouchEnd}
                                onTouchCancel={handleGroupMessageTouchEnd}
                                className={`w-fit max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs transition-shadow ${
                                  m.isSelf
                                    ? "ml-auto bg-emerald-600 text-white"
                                    : "bg-slate-700 text-slate-100"
                                } ${
                                  highlightedGroupMessageId === m.id
                                    ? "ring-2 ring-purple-400"
                                    : ""
                                }`}
                              >
                                {m.imagePath && dmImageLoadFailed[m.id] && (
                                  <button
                                    type="button"
                                    onClick={() => retryDmImageUrl(m.id)}
                                    className={`flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-md bg-slate-600/60 text-[9px] text-slate-300 hover:bg-slate-600 ${
                                      m.message ? "mb-1" : ""
                                    }`}
                                  >
                                    <span>読み込めません</span>
                                    <span className="underline">
                                      タップで再試行
                                    </span>
                                  </button>
                                )}
                                {m.imagePath && !dmImageLoadFailed[m.id] && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={dmImageUrls[m.id]}
                                    alt="添付画像"
                                    onClick={() => {
                                      const url = dmImageUrls[m.id];
                                      if (url)
                                        setDmLightbox({ messageId: m.id, url });
                                    }}
                                    onError={() => {
                                      if (dmImageUrls[m.id]) {
                                        // eslint-disable-next-line no-console
                                        console.error(
                                          "添付画像の読み込みに失敗しました",
                                          m.id,
                                          dmImageUrls[m.id],
                                        );
                                        setDmImageLoadFailed((prev) => ({
                                          ...prev,
                                          [m.id]: true,
                                        }));
                                      }
                                    }}
                                    className={`block max-h-56 max-w-full rounded-md object-contain ${
                                      m.message ? "mb-1" : ""
                                    } ${
                                      dmImageUrls[m.id]
                                        ? "cursor-pointer"
                                        : "min-h-16 min-w-16 animate-pulse bg-slate-600"
                                    }`}
                                  />
                                )}
                                <p className="whitespace-pre-wrap break-words">
                                  {renderTextWithMentions(m.message, [
                                    "全員",
                                    ...groupMembers.map((gm) => gm.displayName),
                                  ])}
                                </p>
                              </div>
                              </div>
                              <p className="mt-0.5 text-[10px] text-slate-400">
                                {formatDmMessageTime(m.createdAt)}
                              </p>
                              {groupedReactions.length > 0 && (
                                <div className="mt-0.5 flex flex-wrap gap-1">
                                  {groupedReactions.map((g) => (
                                    <button
                                      key={g.emoji}
                                      type="button"
                                      onClick={() => {
                                        if (g.mine) {
                                          handleGroupReactionSelect(
                                            m,
                                            g.emoji,
                                          );
                                        }
                                      }}
                                      className={`rounded-full border px-1.5 py-0.5 text-[11px] leading-none ${
                                        g.mine
                                          ? "cursor-pointer border-emerald-400 bg-emerald-500/20 text-emerald-100"
                                          : "cursor-default border-slate-600 bg-slate-800/70 text-slate-200"
                                      }`}
                                    >
                                      {g.emoji}
                                    </button>
                                  ))}
                                </div>
                              )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      {groupError && (
                        <p className="border-t border-slate-700 px-3 py-1 text-[10px] text-red-400">
                          {groupError}
                        </p>
                      )}
                      {groupPendingImages.length > 0 && (
                        <div className="flex gap-2 overflow-x-auto border-t border-slate-700 bg-slate-800/60 px-3 py-2">
                          {groupPendingImages.map((p) => (
                            <div
                              key={p.id}
                              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-700/70 py-1 pl-1 pr-2"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setDmLightbox({
                                    messageId: null,
                                    url: p.previewUrl,
                                  })
                                }
                                className="shrink-0"
                                aria-label="添付画像を拡大表示"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={p.previewUrl}
                                  alt=""
                                  className="h-8 w-8 rounded object-cover"
                                />
                              </button>
                              <div className="min-w-0 max-w-[110px] text-[10px] text-slate-300">
                                <p className="truncate font-medium">
                                  {p.file.name}
                                </p>
                                {p.width && p.height && (
                                  <p className="text-slate-500">
                                    {p.width}×{p.height}
                                  </p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => cancelGroupPendingImage(p.id)}
                                disabled={groupImageUploading}
                                aria-label="添付を取り消す"
                                className="shrink-0 text-slate-400 hover:text-white disabled:opacity-30"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {groupUploadProgress && (
                        <div className="border-t border-slate-700 bg-slate-800/60 px-3 py-2">
                          <div className="mb-1 flex items-center justify-between text-[10px] text-slate-300">
                            <span>
                              {groupUploadProgress.phase === "uploading"
                                ? `アップロード中 (${groupUploadProgress.index + 1}/${groupUploadProgress.total}) ${groupUploadProgress.percent}%`
                                : `圧縮中… (${groupUploadProgress.index + 1}/${groupUploadProgress.total})`}
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
                            <div
                              className={`h-full rounded-full bg-emerald-500 ${
                                groupUploadProgress.phase === "uploading"
                                  ? "transition-all"
                                  : "animate-pulse"
                              }`}
                              style={{
                                width:
                                  groupUploadProgress.phase === "uploading"
                                    ? `${groupUploadProgress.percent}%`
                                    : "100%",
                              }}
                            />
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 border-t border-slate-700 p-2">
                        <input
                          ref={groupImageInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            const files = Array.from(e.target.files ?? []);
                            e.target.value = "";
                            if (files.length > 0) stageGroupImages(files);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => groupImageInputRef.current?.click()}
                          disabled={groupImageUploading || groupSending}
                          title="画像を添付"
                          aria-label="画像を添付"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-600 text-sm font-semibold leading-none text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                        >
                          {groupImageUploading ? "…" : "+"}
                        </button>
                        <div className="relative min-w-0 flex-1">
                          {groupMentionQuery &&
                            groupMentionCandidates.length > 0 && (
                              <div className="absolute bottom-full left-0 right-0 z-30 mb-1 max-h-40 overflow-y-auto rounded-lg bg-slate-800 py-1 text-xs text-white shadow-lg">
                                {groupMentionCandidates.map((c) => (
                                  <button
                                    key={c.key}
                                    type="button"
                                    // mousedownでフォーカスが入力欄から
                                    // 外れる前にonClickより先に発火させ、
                                    // blurでポップアップが消える競合を防ぐ
                                    // (onMouseDownでpreventDefaultして
                                    // フォーカス移動自体を止める)。
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() =>
                                      selectGroupMentionCandidate(c.label)
                                    }
                                    className="block w-full px-3 py-1.5 text-left hover:bg-slate-700"
                                  >
                                    @{c.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          {/* 色付きオーバーレイ(@メンション部分だけ紫色)。
                              クリック等は下の実textareaへ素通しする
                              (pointer-events-none)。実textarea側は文字色を
                              透明にし、キャレットのみ見せることで、見た目上
                              このオーバーレイの色付きテキストだけが見える
                              ようにしている(ネイティブのinput/textareaは
                              文字ごとに色を変えられないための代替手段)。 */}
                          <div
                            aria-hidden
                            className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-lg border border-transparent bg-slate-800 px-2.5 py-1.5 text-xs text-white"
                          >
                            {renderTextWithMentions(groupInput, [
                              "全員",
                              ...groupMembers.map((m) => m.displayName),
                            ])}
                          </div>
                          <textarea
                            ref={groupInputRef}
                            value={groupInput}
                            onChange={handleGroupInputChange}
                            onKeyDown={(e) => {
                              if (e.nativeEvent.isComposing) return;
                              if (
                                e.key === "Enter" &&
                                groupMentionQuery &&
                                groupMentionCandidates.length > 0
                              ) {
                                e.preventDefault();
                                selectGroupMentionCandidate(
                                  groupMentionCandidates[0].label,
                                );
                                return;
                              }
                              if (e.key === "Escape" && groupMentionQuery) {
                                setGroupMentionQuery(null);
                                return;
                              }
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                sendGroupMessage();
                              }
                            }}
                            onPaste={(e) => {
                              const items = e.clipboardData?.items;
                              if (!items) return;
                              const imageFiles: File[] = [];
                              for (let i = 0; i < items.length; i++) {
                                const item = items[i];
                                if (item.type.startsWith("image/")) {
                                  const file = item.getAsFile();
                                  if (file) imageFiles.push(file);
                                }
                              }
                              if (imageFiles.length > 0) {
                                e.preventDefault();
                                stageGroupImages(imageFiles);
                              }
                            }}
                            maxLength={500}
                            rows={1}
                            placeholder="メッセージを入力"
                            className="relative w-full resize-none overflow-hidden rounded-lg border border-slate-600 bg-transparent px-2.5 py-1.5 text-xs text-transparent caret-white outline-none placeholder:text-slate-400 focus:border-slate-400"
                          />
                        </div>
                        <button
                          onClick={sendGroupMessage}
                          disabled={
                            (!groupInput.trim() &&
                              groupPendingImages.length === 0) ||
                            groupSending ||
                            groupImageUploading
                          }
                          className="flex h-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 px-3 text-xs font-semibold leading-none text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          {groupImageUploading ? "送信中..." : "送信"}
                        </button>
                      </div>
                    </>
                  );
                })()}
          </div>
            )}

            {sidebarTab === "notifications" && (
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-2">
                {mentionsLoading && mentions.length === 0 ? (
                  <p className="mt-4 text-center text-[11px] text-slate-500">
                    読み込み中...
                  </p>
                ) : mentionsError ? (
                  <p className="mt-4 text-center text-[11px] text-red-400">
                    {mentionsError}
                  </p>
                ) : mentions.length === 0 ? (
                  <p className="mt-4 text-center text-[11px] text-slate-500">
                    通知はありません
                  </p>
                ) : (
                  mentions.map((mention) => (
                    <button
                      key={mention.id}
                      type="button"
                      onClick={() => handleMentionClick(mention)}
                      className={`block w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                        mention.readAt
                          ? "border-slate-700 bg-transparent text-slate-300 hover:bg-white/5"
                          : "border-purple-400/60 bg-purple-500/10 text-white hover:bg-purple-500/15"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-semibold">
                          {mention.mentionerName}さんから
                          {mention.isEveryone ? "全員宛て" : ""}
                          メンションされました
                        </span>
                        {!mention.readAt && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-purple-400" />
                        )}
                      </div>
                      {mention.messagePreview && (
                        <p className="mt-1 truncate text-[11px] text-slate-300">
                          {truncateForPreview(mention.messagePreview)}
                        </p>
                      )}
                      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-400">
                        <span className="min-w-0 truncate">
                          👥 {mention.groupName}
                        </span>
                        <span className="shrink-0">
                          {formatDmListTime(mention.createdAt)}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}

            {sidebarTab === "settings" && (
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-2">
                <div>
                  <p className="mb-2 text-xs font-semibold text-slate-400">
                    アバター
                  </p>
                  <AvatarPicker
                    selected={settingsAvatar}
                    onSelect={setSettingsAvatar}
                  />
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold text-slate-400">
                    表示名
                  </p>
                  <input
                    value={settingsNameInput}
                    onChange={(e) => setSettingsNameInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveSettings()}
                    placeholder="例:みく"
                    className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-slate-400"
                  />
                </div>

                <div className="flex gap-4">
                  <div>
                    <p className="mb-2 text-xs font-semibold text-slate-400">
                      ステータス
                    </p>
                    <div className="flex flex-col gap-2">
                      {(
                        Object.keys(PRESENCE_STATUS_LABELS) as PresenceStatus[]
                      ).map((status) => (
                        <label
                          key={status}
                          className="flex items-center gap-2 text-sm text-slate-200"
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
                            style={{
                              backgroundColor: PRESENCE_STATUS_COLORS[status],
                            }}
                          />
                          {PRESENCE_STATUS_LABELS[status]}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="mb-2 text-xs font-semibold text-slate-400">
                      吹き出し
                    </p>
                    <label className="mb-2 flex items-center gap-2 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={settingsShowMessage}
                        onChange={(e) =>
                          setSettingsShowMessage(e.target.checked)
                        }
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
                      className="w-full rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-white outline-none focus:border-slate-400"
                    />
                    <p className="mt-1 text-[10px] text-slate-400">
                      {settingsMessageInput.length}/{MESSAGE_MAX_LENGTH}文字
                    </p>
                  </div>
                </div>

                <button
                  onClick={saveSettings}
                  className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                >
                  保存する
                </button>

                {(isAccountAdmin || isMaster) && (
                  <div className="space-y-2 border-t border-slate-700 pt-4">
                    {isAccountAdmin && (
                      <Link
                        href="/admin"
                        className="block w-full rounded-lg bg-slate-800 py-2 text-center text-sm font-semibold text-slate-200 hover:bg-slate-700"
                      >
                        管理画面へ
                      </Link>
                    )}
                    {isMaster && (
                      <Link
                        href="/master"
                        className="block w-full rounded-lg bg-emerald-900/40 py-2 text-center text-sm font-semibold text-emerald-300 hover:bg-emerald-900/60"
                      >
                        マスター画面へ
                      </Link>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* サイドバーのリサイズハンドル(PC版のみ)。下限は既存の固定幅
            (SIDEBAR_MIN_WIDTH)、上限は画面幅の50%。 */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="サイドバーの幅を変更"
          onPointerDown={handleSidebarResizeStart}
          onPointerMove={handleSidebarResizeMove}
          onPointerUp={handleSidebarResizeEnd}
          onPointerCancel={handleSidebarResizeEnd}
          className="hidden w-[3px] shrink-0 cursor-col-resize touch-none bg-slate-700 hover:bg-emerald-500 active:bg-emerald-500 sm:order-2 sm:block"
        />
      </div>

      {/* チャット添付画像の拡大プレビュー。送受信済み画像はmessageIdありで
          保存ボタンを表示し、送信前プレビュー(dmPendingImage由来)は
          messageIdがnullのため保存ボタンを出さない(手元のファイルを
          そのまま保存できても意味が無いため)。 */}
      {dmLightbox && (
        <div
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/90 p-4"
          onClick={() => setDmLightbox(null)}
        >
          <button
            type="button"
            onClick={() => setDmLightbox(null)}
            aria-label="閉じる"
            className="absolute right-4 top-4 text-2xl text-white hover:text-slate-300"
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={dmLightbox.url}
            alt="添付画像"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[80vh] max-w-full rounded-lg object-contain"
          />
          {dmLightbox.messageId && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                downloadDmLightboxImage();
              }}
              disabled={dmLightboxDownloading}
              className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
            >
              {dmLightboxDownloading ? "保存中..." : "画像を保存"}
            </button>
          )}
        </div>
      )}

      {/* DMメッセージのコピーメニュー用の背景(外側タップで閉じる)。
          部分コピーモード中は選択ハンドルのドラッグ操作を妨げてしまう
          ため、この全画面divは出さない(外側タップでの閉じる処理は
          下のdocumentレベルのpointerdownリスナーで代替する)。 */}
      {dmContextMenu && (
        <div className="fixed inset-0 z-40" onClick={closeDmCopyUi} />
      )}

      {/* DMメッセージの右クリック/長押しメニュー */}
      {dmContextMenu &&
        (() => {
          const point = getDmBubbleTopRight(dmContextMenu.message.id);
          if (!point) return null;
          // メニュー幅を固定し、本来は吹き出しの右上端に右揃えする位置
          // (point.x - MENU_WIDTH)を、画面左右端からはみ出さないよう
          // クランプする(groupContextMenuの左右クランプと同じ考え方。
          // スマホで画面左端に近い相手メッセージの吹き出しにこのメニューを
          // 出すと、絵文字ボタンが画面外に出て押せなくなっていたため)。
          const MENU_WIDTH = 160;
          const panelRect = dmScrollRef.current?.getBoundingClientRect();
          const minLeft = (panelRect?.left ?? 0) + 8;
          const maxLeft = (panelRect?.right ?? window.innerWidth) - MENU_WIDTH - 8;
          const left = Math.min(Math.max(point.x - MENU_WIDTH, minLeft), maxLeft);
          return (
            <div
              className="fixed z-50 w-40 overflow-hidden rounded-lg bg-slate-800 text-xs font-semibold text-white shadow-xl"
              style={{
                left,
                top: point.y,
                transform: "translateY(calc(-100% - 6px))",
              }}
            >
              {dmContextMenu.source === "touch" && (
                // スマホの長押しは既存のコピー/編集/削除メニューと同じ
                // ジェスチャーのため、絵文字リアクションの選択もこの
                // メニューの先頭にまとめる(PCはホバーバーで別途対応)。
                <div className="flex items-center justify-center gap-0.5 border-b border-slate-700 px-1.5 py-1.5">
                  {REACTION_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() =>
                        handleDmReactionSelect(dmContextMenu.message, emoji)
                      }
                      className="flex h-7 w-7 items-center justify-center rounded-full text-base hover:bg-slate-700"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
              {dmContextMenu.source === "mouse" && dmContextMenu.selectedText ? (
                // PCで既に範囲選択済みの状態から開いた場合は、その場コピー
                // だけを1項目で出す(「部分コピー」との二度手間を避ける)。
                <button
                  type="button"
                  onClick={() => {
                    copyDmText(dmContextMenu.selectedText);
                    closeDmCopyUi();
                  }}
                  className="block w-full px-3 py-2 text-left hover:bg-slate-700"
                >
                  選択範囲をコピー
                </button>
              ) : (
                <>
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
                  {dmContextMenu.source === "touch" && (
                    // スマホの長押しには「事前選択」が無いため、部分選択に
                    // 入るための入口として部分コピーを出す。
                    <button
                      type="button"
                      onClick={() => {
                        setDmSelectionModeMessageId(dmContextMenu.message.id);
                        setDmContextMenu(null);
                      }}
                      className="block w-full border-t border-slate-700 px-3 py-2 text-left hover:bg-slate-700"
                    >
                      部分コピー
                    </button>
                  )}
                </>
              )}
              {dmContextMenu.message.isSelf && (
                // 自分が送信したメッセージにのみ、編集・削除を出す。
                <>
                  <button
                    type="button"
                    onClick={() => {
                      startEditDmMessage(dmContextMenu.message);
                      closeDmCopyUi();
                    }}
                    className="block w-full border-t border-slate-700 px-3 py-2 text-left hover:bg-slate-700"
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = dmContextMenu.message;
                      closeDmCopyUi();
                      if (
                        window.confirm(
                          "このメッセージを削除します。よろしいですか?",
                        )
                      ) {
                        deleteDmMessage(target);
                      }
                    }}
                    className="block w-full border-t border-slate-700 px-3 py-2 text-left text-red-300 hover:bg-slate-700"
                  >
                    削除
                  </button>
                </>
              )}
            </div>
          );
        })()}

      {/* スマホ用移動ボタン(sm以上の画面では非表示)。参加者一覧
          ドロワー(ハンバーガーメニュー)を開いている間はトーク画面と
          重なって送信ボタンが押せなくなるため非表示にする。 */}
      {!showParticipants && (
        <TouchControls
          onPress={handleTouchPress}
          onRelease={handleTouchRelease}
        />
      )}

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
                onClick={() => {
                  setExpandedMedia(null);
                  // 画面共有は視聴終了と同時に購読も止める(見ている人が
                  // いない間は不要な帯域を使わないため)。
                  if (expandedMedia.kind === "screen") {
                    setSelectedScreenSharerId(null);
                  }
                }}
                className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-lg text-white hover:bg-black/80"
                aria-label="全画面表示を閉じる"
              >
                ✕
              </button>
            </div>
          );
        })()}

      {/* 会議室の入室確認ポップアップ */}
      {pendingMeetingEntry && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-[260px] rounded-xl bg-white p-6 text-center shadow-xl">
            <p className="mb-4 text-sm font-semibold text-slate-800">
              会議室に入室しますか?
            </p>
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={() => declineMeetingEntry(pendingMeetingEntry.zoneId)}
                className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300"
              >
                いいえ
              </button>
              <button
                type="button"
                onClick={() => confirmMeetingEntry(pendingMeetingEntry.zoneId)}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                はい
                <br />
                (Enter)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 施錠者以外が鍵を操作しようとした際のエラー(3秒で自動的に消える) */}
      {lockPermissionError && (
        <div className="pointer-events-none fixed inset-x-0 top-6 z-[60] flex justify-center px-4">
          <div className="rounded-lg bg-black/80 px-4 py-2 text-center text-sm text-white shadow-xl">
            鍵を閉めた人しか開けることはできません
          </div>
        </div>
      )}

      {/* プラン変更による強制退出の通知(最前面に表示し、少ししてから
          window.location.reload()で新プランの制限を反映し直す) */}
      {/* ワープ演出:一瞬暗転させてから元に戻る(瞬間移動そのものは
          裏で即座に行われる)。常にマウントしたままopacityだけ切り替える
          ことで、CSSのtransitionがきちんと効くようにしている。 */}
      <div
        aria-hidden
        className={`pointer-events-none fixed inset-0 z-[90] bg-black transition-opacity duration-200 ${
          warpFading ? "opacity-100" : "opacity-0"
        }`}
      />

      {forceLeaveMessage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-xl">
            <p className="text-sm font-semibold text-slate-800">
              {forceLeaveMessage}
            </p>
          </div>
        </div>
      )}

      {/* グループチャット作成モーダル */}
      {showCreateGroupModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-bold text-slate-800">
              グループチャット作成
            </h2>
            <hr className="mb-4 mt-2 border-slate-200" />

            <p className="mb-2 text-xs font-semibold text-slate-500">
              参加者(現在ルームに入室中の人のみ選べます)
            </p>
            <div className="mb-4 max-h-64 space-y-1 overflow-y-auto">
              {playerList.filter((p) => p.id !== selfId.current && p.userId)
                .length === 0 && (
                <p className="text-xs text-slate-500">
                  現在、他に入室中の参加者がいません。
                </p>
              )}
              {playerList
                .filter((p) => p.id !== selfId.current && p.userId)
                .map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 rounded px-1 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={createGroupSelectedIds.has(p.userId as string)}
                      onChange={(e) => {
                        const userId = p.userId as string;
                        setCreateGroupSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(userId);
                          else next.delete(userId);
                          return next;
                        });
                      }}
                    />
                    <span className="truncate">{p.name}</span>
                  </label>
                ))}
            </div>

            {createGroupError && (
              <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                {createGroupError}
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowCreateGroupModal(false);
                  setCreateGroupError(null);
                }}
                className="flex-1 rounded-lg bg-slate-200 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300"
              >
                キャンセル
              </button>
              <button
                onClick={handleCreateGroup}
                disabled={createGroupSelectedIds.size === 0 || creatingGroup}
                className="flex-1 rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {creatingGroup ? "作成中..." : "作成"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* グループ一覧の右クリックメニュー */}
      {groupContextMenu && (
        <div
          className="fixed z-[70] w-40 overflow-hidden rounded-lg bg-slate-800 text-sm text-white shadow-xl"
          style={{
            // スマホ画面右端から出た項目を長押しした場合、メニュー(幅160px)
            // が画面外にはみ出さないよう、右端に余白(12px)を残してクランプ
            // する(左端も同様に余白を確保する)。
            left: Math.min(
              Math.max(groupContextMenu.x, 12),
              window.innerWidth - 160 - 12,
            ),
            top: groupContextMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              const current = chatThreads.find(
                (t) => t.threadId === groupContextMenu.groupId,
              );
              setRenamingGroupId(groupContextMenu.groupId);
              setRenameGroupInput(current?.threadName ?? "");
              setRenameGroupError(null);
              setGroupContextMenu(null);
            }}
            className="block w-full px-3 py-2 text-left hover:bg-slate-700"
          >
            グループ名変更
          </button>
          <button
            type="button"
            onClick={() => {
              setLeavingGroupId(groupContextMenu.groupId);
              setLeaveGroupError(null);
              setGroupContextMenu(null);
            }}
            className="block w-full border-t border-slate-700 px-3 py-2 text-left text-red-300 hover:bg-slate-700"
          >
            このチャットから退出
          </button>
        </div>
      )}

      {/* グループメッセージの長押しメニュー(絵文字リアクションのみ)。
          グループメッセージには元々コピー/編集/削除メニューが無いため、
          dmContextMenuと違いこのメニューは絵文字選択専用。 */}
      {groupMessageContextMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setGroupMessageContextMenu(null)}
        />
      )}
      {groupMessageContextMenu &&
        (() => {
          const point = getGroupBubbleTopRight(
            groupMessageContextMenu.message.id,
          );
          if (!point) return null;
          // DMの長押しメニューと同じ理由で、画面左右端からはみ出さない
          // ようクランプする。
          const MENU_WIDTH = 200;
          const panelRect = groupScrollRef.current?.getBoundingClientRect();
          const minLeft = (panelRect?.left ?? 0) + 8;
          const maxLeft = (panelRect?.right ?? window.innerWidth) - MENU_WIDTH - 8;
          const left = Math.min(Math.max(point.x - MENU_WIDTH, minLeft), maxLeft);
          return (
            <div
              className="fixed z-50 flex w-[200px] items-center justify-center gap-0.5 rounded-full bg-slate-800 px-1.5 py-1.5 shadow-xl"
              style={{
                left,
                top: point.y,
                transform: "translateY(calc(-100% - 6px))",
              }}
            >
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() =>
                    handleGroupReactionSelect(
                      groupMessageContextMenu.message,
                      emoji,
                    )
                  }
                  className="flex h-8 w-8 items-center justify-center rounded-full text-base text-white hover:bg-slate-700"
                >
                  {emoji}
                </button>
              ))}
            </div>
          );
        })()}

      {/* グループ名変更モーダル */}
      {renamingGroupId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-bold text-slate-800">
              グループ名変更
            </h2>
            <hr className="mb-4 mt-2 border-slate-200" />
            <input
              value={renameGroupInput}
              onChange={(e) => setRenameGroupInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRenameGroupSave()}
              maxLength={100}
              placeholder="グループ名"
              className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
            {renameGroupError && (
              <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                {renameGroupError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setRenamingGroupId(null)}
                className="flex-1 rounded-lg bg-slate-200 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300"
              >
                キャンセル
              </button>
              <button
                onClick={handleRenameGroupSave}
                disabled={renamingGroupSaving}
                className="flex-1 rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {renamingGroupSaving ? "保存中..." : "保存する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* グループ退出の確認モーダル */}
      {leavingGroupId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-xl">
            <p className="mb-4 text-sm font-semibold text-slate-800">
              このチャットから退出しますか?
              <br />
              自分の画面からは履歴が消え、以後の通知も届かなくなります。
              他のメンバーには退出したことが通知されます。
            </p>
            {leaveGroupError && (
              <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                {leaveGroupError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setLeavingGroupId(null)}
                className="flex-1 rounded-lg bg-slate-200 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300"
              >
                キャンセル
              </button>
              <button
                onClick={handleLeaveGroupConfirm}
                disabled={leavingGroupBusy}
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {leavingGroupBusy ? "退出中..." : "退出する"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
