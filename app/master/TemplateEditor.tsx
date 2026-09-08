"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import type {
  MapTemplate,
  Obstacle,
  MeetingZone,
  WarpPoint,
  PlacedObject,
  TemplateObjectImage,
} from "@/lib/types";
import {
  NEW_ITEM_SIZE,
  MIN_ITEM_SIZE,
  MIN_OBSTACLE_WIDTH,
  MIN_OBSTACLE_HEIGHT,
  AVATAR_HITBOX_WIDTH,
  AVATAR_HITBOX_HEIGHT,
  WARP_CHANNELS,
  WARP_POINT_RADIUS,
  clampPosition,
  clampSize,
  randomItemId,
  rectIntersectsObstacle,
  rectIntersectsRect,
} from "@/lib/types";
import {
  updateTemplateLayout,
  updateTemplateObjectLibrary,
  replaceTemplateImage,
  renameTemplate,
} from "./actions";
import {
  uploadTemplateImageClient,
  uploadTemplateObjectImageClient,
} from "./uploadTemplateImage";
import ConfirmModal from "@/components/ConfirmModal";
import TemplateRoomPreview from "./TemplateRoomPreview";
import { useTemplateEditorGuard } from "./templateEditorGuard";

type ItemType = "obstacle" | "zone" | "object";

// コピー(Ctrl+C・「コピー」吹き出し)したアイテムの見た目情報。貼り付け時に
// 同じ種類のアイテムを新しいidで作り直すために使う。DBには一切保存しない
// その場限りのクリップボード。
type CopiedItemTemplate =
  | { itemType: "obstacle"; width: number; height: number; rotation: number; label: string }
  | {
      itemType: "zone";
      width: number;
      height: number;
      label: string;
      kind: MeetingZone["kind"];
    }
  | {
      itemType: "object";
      width: number;
      height: number;
      rotation: number;
      imageUrl: string;
    };

// 元に戻す/やり直すのために保持する、レイアウトの一時点の状態(「保存」で
// 一括保存される項目一式と同じ範囲)。DBには一切保存しない。
type LayoutSnapshot = {
  obstacles: Obstacle[];
  meetingZones: MeetingZone[];
  mapWidth: number;
  mapHeight: number;
  spawnPoint: { x: number; y: number } | null;
  warpPoints: WarpPoint[];
  placedObjects: PlacedObject[];
};

type DragState =
  | {
      mode: "move";
      itemType: ItemType;
      id: string;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }
  | {
      mode: "resize";
      itemType: ItemType;
      id: string;
      startX: number;
      startY: number;
      originWidth: number;
      originHeight: number;
      // リサイズハンドルのドラッグ量(画面/マップ座標系)を、回転した壁
      // 自身のローカル座標系(=幅・高さの増減方向)へ変換するために使う。
      // 壁以外(ミーティングエリア等)は常に0。
      rotationDeg: number;
    }
  | {
      // 壁・オブジェクトの回転ドラッグ。中心からポインタへの角度の変化量を
      // 回転角へ反映する(ミーティングエリア等は回転非対応)。
      mode: "rotate";
      itemType: "obstacle" | "object";
      id: string;
      centerX: number;
      centerY: number;
      startAngleDeg: number;
      originRotationDeg: number;
    };

const MAX_DISPLAY_WIDTH = 1200;
const MIN_MAP_SIZE = 400;
const MAX_MAP_SIZE = 8000;

// ワープのチャンネル(A/B/C)ごとの表示色(半透明)。lib/types.tsに置くと
// Tailwindのcontentスキャン対象外(app/**・components/**のみ)になり
// クラスが生成されないため、ここ(app/**配下)にクラス文字列そのままで
// 持たせる。AvatarSpace.tsx側にも同じ内容を別途持たせている。
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

// サイドバーのボタン表示名(「Aワープ」等の記号ではなく、上の表示色と
// 対応した色名で案内する)。
const WARP_CHANNEL_NAMES: Record<"A" | "B" | "C", string> = {
  A: "赤",
  B: "黄",
  C: "青",
};

function clampMapSize(rawInput: string, fallback: number): number {
  const parsed = Number(rawInput);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(MAX_MAP_SIZE, Math.max(MIN_MAP_SIZE, parsed));
}

// テンプレートの背景画像上に障害物・ミーティングエリアを配置編集する。
// マップ編集はここに一本化されており、個々のルームでは編集できない。
export default function TemplateEditor({
  template,
  avatarSizePx,
  onClose,
}: {
  template: MapTemplate;
  avatarSizePx: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [obstacles, setObstacles] = useState<Obstacle[]>(template.obstacles);
  const [meetingZones, setMeetingZones] = useState<MeetingZone[]>(
    template.meetingZones,
  );
  // 入室時のアバター初期位置(中心座標)。1点のみ持てる。未設定ならnull
  // (=マップ中心にスポーンする従来の挙動のまま)。
  const [spawnPoint, setSpawnPoint] = useState<{ x: number; y: number } | null>(
    template.spawnPoint,
  );
  const [warpPoints, setWarpPoints] = useState<WarpPoint[]>(
    template.warpPoints,
  );
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(
    template.backgroundImageUrl,
  );
  // オブジェクト登録(2026-09追加)。objectLibraryは登録済み画像の一覧
  // (背景画像と同じく、アップロードのたびに即時保存する。placedObjects
  // は他の壁・エリア等と同じく「保存」ボタンで一括保存する)。
  const [objectLibrary, setObjectLibrary] = useState<TemplateObjectImage[]>(
    template.objectLibrary,
  );
  const [placedObjects, setPlacedObjects] = useState<PlacedObject[]>(
    template.placedObjects,
  );
  const [selectedLibraryImageId, setSelectedLibraryImageId] = useState<
    string | null
  >(null);
  // マップ上の壁・エリア・オブジェクトのうち、選択中の1個(コピー・
  // 貼り付け・枠を赤くするハイライトの対象)。ライブラリの選択
  // (selectedLibraryImageId、「挿入」対象を選ぶためのもの)とは別の概念。
  const [selectedItem, setSelectedItem] = useState<{
    itemType: ItemType;
    id: string;
  } | null>(null);
  // コピーしたアイテムの見た目情報。DBには保存せず、このタブを閉じるまでの
  // その場限りのクリップボードとして扱う。
  const copiedItemTemplateRef = useRef<CopiedItemTemplate | null>(null);
  // 右クリックした位置に出す「貼り付け」吹き出し。地図座標(mapX/mapY)で
  // 持ち、表示位置は他のアイテムと同じくレンダー時にscaleを掛けて求める
  // (拡大縮小してもズレない)。
  const [pasteBubbleAt, setPasteBubbleAt] = useState<{
    mapX: number;
    mapY: number;
  } | null>(null);
  const [registeringObject, setRegisteringObject] = useState(false);
  const [deletingLibraryImage, setDeletingLibraryImage] = useState(false);
  const [saving, setSaving] = useState(false);
  // router.refresh()(サーバー側の最新データの反映)が完了するまで
  // onClose()を遅らせるためのフラグ。refreshingがfalseに戻った時点で
  // 一覧側propsが最新化されたとみなして画面遷移する。
  const [refreshing, startRefreshTransition] = useTransition();
  const pendingCloseRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(template.name);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(template.name);
  const [renaming, setRenaming] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [warpHelpOpen, setWarpHelpOpen] = useState(false);
  const [objectHelpOpen, setObjectHelpOpen] = useState(false);
  // 保存していないレイアウト変更があるかどうか(MasterDashboardのサイドバー
  // 経由での画面遷移ガードに使う。詳細はtemplateEditorGuard.tsx参照)。
  // 初回マウント時点の値(=DBから読み込んだそのまま)は「未保存の変更」
  // ではないため、最初の1回だけは無視する。
  const [dirty, setDirty] = useState(false);
  const dirtyEffectMountedRef = useRef(false);
  const templateEditorGuard = useTemplateEditorGuard();
  // 入力欄には生の文字列を持たせ、自由に打ち直せるようにする(数値state
  // に直接min/maxで丸めていると、例えば1900を消して2500と打ち直す途中の
  // 「2」の時点でMIN_MAP_SIZEまで丸められてしまい、自由に入力できな
  // かったため)。実際の計算に使う数値はここから都度導出し、範囲外や
  // 未入力の場合だけテンプレートの元の値にフォールバックする。
  const [mapWidthInput, setMapWidthInput] = useState(String(template.width));
  const [mapHeightInput, setMapHeightInput] = useState(String(template.height));
  const mapWidth = clampMapSize(mapWidthInput, template.width);
  const mapHeight = clampMapSize(mapHeightInput, template.height);
  const [measuringImageSize, setMeasuringImageSize] = useState(false);

  // 「保存」ボタンで一括保存される項目(壁・エリア・マップサイズ・
  // アバター初期位置・ワープ・配置オブジェクト)のいずれかが変化したら
  // dirtyを立てる。背景画像・オブジェクトライブラリ・名前は変更した
  // 時点で即座にDBへ保存されるため、ここには含めない。
  useEffect(() => {
    if (!dirtyEffectMountedRef.current) {
      dirtyEffectMountedRef.current = true;
      return;
    }
    setDirty(true);
  }, [obstacles, meetingZones, mapWidth, mapHeight, spawnPoint, warpPoints, placedObjects]);

  // アップロード画像の実ピクセルサイズを取得し、マップサイズ欄へ反映する。
  const applyImageNaturalSize = () => {
    setMeasuringImageSize(true);
    const img = new Image();
    img.onload = () => {
      setMapWidthInput(String(img.naturalWidth));
      setMapHeightInput(String(img.naturalHeight));
      setMeasuringImageSize(false);
    };
    img.onerror = () => setMeasuringImageSize(false);
    img.src = backgroundImageUrl;
  };

  // 「作成」直後(まだ一度もレイアウト保存していない=マップサイズが
  // テンプレート作成時のDBデフォルト値のまま)の初回編集時だけ、手動で
  // 「デフォルト」を押さなくても最初からアップロード画像の実サイズを
  // 表示する。一度でも保存されるとマップサイズはDBデフォルトから
  // 変わるため、2回目以降の編集では保存された値をそのまま尊重する。
  useEffect(() => {
    if (template.width !== 1900 || template.height !== 1900) return;
    applyImageNaturalSize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dragState = useRef<DragState | null>(null);
  // アバター初期位置は配列アイテムではなく単一の点なので、障害物/エリアの
  // 汎用ドラッグ(dragState/applyDrag)には乗せず、専用の最小限のドラッグ
  // 状態で扱う。
  const spawnDragState = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  // ワープポイントも点(円)なので、アバター初期位置と同じ考え方の専用
  // ドラッグ状態にする。
  const warpDragState = useRef<{
    id: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(MAX_DISPLAY_WIDTH);
  const [availableHeight, setAvailableHeight] = useState(600);
  const [zoom, setZoom] = useState(1);

  // 画面(特に縦幅が小さいノートPCなど)にマップ全体が収まるよう、
  // 「横幅に入る幅」「縦幅に入る高さ」を実測しておく(依存はマウント時の
  // リサイズだけで、マップサイズが変わったときの再計算はfitScale側で
  // 都度行う)。高さは画面の一定割合(0.75)ではなく、キャンバス自体が
  // 画面上で始まる位置(getBoundingClientRect().top)を実測し、そこから
  // 画面下端までの残り高さいっぱいを使う(サイドバーと同じく画面高さ
  // いっぱいまで広がるようにするため)。
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const BOTTOM_MARGIN = 24;
    const recompute = () => {
      setAvailableWidth(el.clientWidth);
      const top = el.getBoundingClientRect().top;
      setAvailableHeight(
        Math.max(300, window.innerHeight - top - BOTTOM_MARGIN),
      );
    };
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(el);
    window.addEventListener("resize", recompute);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, []);

  // マップ全体(mapWidth×mapHeight)が画面に収まる縮尺。障害物・ミーティング
  // エリアの位置調整がしやすいよう、これとは別に拡大表示もできるように
  // している。拡大時は表示ウィンドウ(viewportWidth×viewportHeight)は
  // 変えず、中身のマップ側だけ大きくしてスクロールで見る(transform:scaleで
  // 見た目だけ拡大するとoverflow-autoのスクロール範囲計算があいまいに
  // なるため、実際のpx幅・高さとして拡大している)。
  const fitScale = Math.min(availableWidth / mapWidth, availableHeight / mapHeight);
  const viewportWidth = mapWidth * fitScale;
  const viewportHeight = mapHeight * fitScale;
  const scale = fitScale * zoom;
  const renderedWidth = mapWidth * scale;
  const renderedHeight = mapHeight * scale;

  // 拡大縮小は、表示中の範囲の左上を基準にするとその場所が固定されて
  // しまい「左上に向かって拡大される」ように見える(2026-09報告)。
  // 常に画面の真ん中を基準に拡大縮小されて見えるよう、変更前に画面
  // 中央が指している地図上の座標を覚えておき、拡大縮小後にその座標が
  // 再び画面中央に来る位置までスクロールし直す。
  const zoomFocusRef = useRef<{ x: number; y: number } | null>(null);
  const changeZoom = (nextZoom: number) => {
    const el = scrollRef.current;
    if (el) {
      zoomFocusRef.current = {
        x: (el.scrollLeft + el.clientWidth / 2) / scale,
        y: (el.scrollTop + el.clientHeight / 2) / scale,
      };
    }
    setZoom(nextZoom);
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const focus = zoomFocusRef.current;
    zoomFocusRef.current = null;
    if (!el || !focus) return;
    el.scrollLeft = focus.x * scale - el.clientWidth / 2;
    el.scrollTop = focus.y * scale - el.clientHeight / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // ---- 元に戻す/やり直す ----
  // 直近30件(MAX_HISTORY)までの「変更前の状態」をブラウザのメモリ上
  // (refのみ。stateにもDBにも保存しない)に保持するだけの機能。保存して
  // 終了する・画面を閉じる・タブを切り替えるといった操作でこのコンポー
  // ネント自体が破棄されれば履歴も一緒に消えるため、DBを圧迫することは
  // ない(そもそも一度もDBへ書き込んでいない)。
  const MAX_HISTORY = 30;
  const undoStackRef = useRef<LayoutSnapshot[]>([]);
  const redoStackRef = useRef<LayoutSnapshot[]>([]);
  // ボタンのdisabled表示のためだけに件数をstateにも反映する
  // (スタック本体はrefのまま。件数が変わった時だけ再描画すればよい)。
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);

  const snapshotLayout = (): LayoutSnapshot => ({
    obstacles,
    meetingZones,
    mapWidth,
    mapHeight,
    spawnPoint,
    warpPoints,
    placedObjects,
  });

  // 壁・エリア・ワープ・配置オブジェクト・マップサイズ・アバター初期位置の
  // いずれかを変更する操作の「直前」に呼ぶ。ドラッグ(移動・リサイズ・
  // 回転)は掴んだ瞬間に1回だけ、追加・削除は実行前に1回、入力欄は
  // フォーカス時に1回呼ぶことで、1操作につき1履歴になるようにしている
  // (ドラッグ中の1px単位の変化ごとに履歴を積まないため)。
  const pushUndo = () => {
    undoStackRef.current = [...undoStackRef.current, snapshotLayout()].slice(
      -MAX_HISTORY,
    );
    redoStackRef.current = [];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(0);
  };

  const applySnapshot = (snap: LayoutSnapshot) => {
    setObstacles(snap.obstacles);
    setMeetingZones(snap.meetingZones);
    setMapWidthInput(String(snap.mapWidth));
    setMapHeightInput(String(snap.mapHeight));
    setSpawnPoint(snap.spawnPoint);
    setWarpPoints(snap.warpPoints);
    setPlacedObjects(snap.placedObjects);
  };

  const handleUndo = () => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, snapshotLayout()].slice(
      -MAX_HISTORY,
    );
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    applySnapshot(prev);
  };

  const handleRedo = () => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const next = stack[stack.length - 1];
    redoStackRef.current = stack.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, snapshotLayout()].slice(
      -MAX_HISTORY,
    );
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    applySnapshot(next);
  };

  const handlePointerDown = (
    e: React.PointerEvent,
    itemType: ItemType,
    id: string,
    mode: "move" | "resize",
  ) => {
    e.stopPropagation();
    const list =
      itemType === "obstacle"
        ? obstacles
        : itemType === "object"
          ? placedObjects
          : meetingZones;
    const item = list.find((i) => i.id === id);
    if (!item) return;
    setSelectedItem({ itemType, id });
    setPasteBubbleAt(null);
    pushUndo();
    dragState.current =
      mode === "move"
        ? {
            mode,
            itemType,
            id,
            startX: e.clientX,
            startY: e.clientY,
            originX: item.x,
            originY: item.y,
          }
        : {
            mode,
            itemType,
            id,
            startX: e.clientX,
            startY: e.clientY,
            originWidth: item.width,
            originHeight: item.height,
            rotationDeg:
              itemType === "obstacle" || itemType === "object"
                ? (item as Obstacle | PlacedObject).rotation ?? 0
                : 0,
          };
  };

  // 壁・オブジェクトの回転ハンドルのドラッグ開始。ハンドルの親要素(壁/
  // オブジェクト本体のdiv、CSSで既に回転済み)のgetBoundingClientRectは
  // 回転しても中心位置が変わらないため、それを中心(画面座標)としてそのまま
  // 使える。以降はスクロールやズームのスケール換算を挟まず、画面座標上の
  // 角度の変化量だけで回転量を計算する。
  const handleRotatePointerDown = (
    e: React.PointerEvent,
    itemType: "obstacle" | "object",
    id: string,
    rotation: number,
  ) => {
    e.stopPropagation();
    const wallEl = (e.currentTarget as HTMLElement).parentElement;
    if (!wallEl) return;
    setSelectedItem({ itemType, id });
    setPasteBubbleAt(null);
    pushUndo();
    const rect = wallEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    dragState.current = {
      mode: "rotate",
      itemType,
      id,
      centerX,
      centerY,
      startAngleDeg:
        (Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180) /
        Math.PI,
      originRotationDeg: rotation,
    };
  };

  // Obstacle/MeetingZoneのどちらであっても位置・サイズの計算内容は同じだが、
  // MeetingZoneにkindフィールドが増えたことで2つのsetState関数の型が食い違い、
  // 1つの共通コールバックとして呼び出すとTypeScriptが引数の型を推論できなく
  // なるため、setObstacles/setMeetingZonesをそれぞれ個別に呼び分ける。
  const applyDrag = <T extends { id: string; x: number; y: number; width: number; height: number }>(
    prev: T[],
    drag: DragState,
    dx: number,
    dy: number,
    minWidth: number = MIN_ITEM_SIZE,
    minHeight: number = MIN_ITEM_SIZE,
  ): T[] =>
    prev.map((item) => {
      if (item.id !== drag.id) return item;
      if (drag.mode === "move") {
        const pos = clampPosition(
          drag.originX + dx,
          drag.originY + dy,
          item.width,
          item.height,
          mapWidth,
          mapHeight,
        );
        return { ...item, ...pos };
      }
      if (drag.mode !== "resize") return item;
      // リサイズハンドルのドラッグ量(画面/マップ座標系)を、壁自身が
      // 回転しているローカル座標系(幅・高さの増減方向)へ逆回転させて
      // 変換する。回転していなければrotationDeg=0なのでdx,dyそのまま。
      const rad = (drag.rotationDeg * Math.PI) / 180;
      const localDx = dx * Math.cos(rad) + dy * Math.sin(rad);
      const localDy = -dx * Math.sin(rad) + dy * Math.cos(rad);
      const size = clampSize(
        item.x,
        item.y,
        drag.originWidth + localDx,
        drag.originHeight + localDy,
        mapWidth,
        mapHeight,
        minWidth,
        minHeight,
      );
      return { ...item, ...size };
    });

  // アバター初期位置が、障害物・ミーティングエリア(種類問わず)と重なって
  // いないかを判定する。実際のゲーム内の当たり判定サイズ(AVATAR_HITBOX_*)
  // で判定する(編集画面上の表示サイズavatarSizePxは見た目用の別値のため)。
  const spawnOverlapsAnyZone = (x: number, y: number) => {
    const halfW = AVATAR_HITBOX_WIDTH / 2;
    const halfH = AVATAR_HITBOX_HEIGHT / 2;
    return (
      obstacles.some((o) => rectIntersectsObstacle(x, y, halfW, halfH, o)) ||
      meetingZones.some((z) => rectIntersectsRect(x, y, halfW, halfH, z))
    );
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const warpDrag = warpDragState.current;
    if (warpDrag) {
      const dx = (e.clientX - warpDrag.startX) / scale;
      const dy = (e.clientY - warpDrag.startY) / scale;
      const x = Math.min(
        Math.max(warpDrag.originX + dx, WARP_POINT_RADIUS),
        mapWidth - WARP_POINT_RADIUS,
      );
      const y = Math.min(
        Math.max(warpDrag.originY + dy, WARP_POINT_RADIUS),
        mapHeight - WARP_POINT_RADIUS,
      );
      setWarpPoints((prev) =>
        prev.map((w) => (w.id === warpDrag.id ? { ...w, x, y } : w)),
      );
      return;
    }
    const spawnDrag = spawnDragState.current;
    if (spawnDrag) {
      const dx = (e.clientX - spawnDrag.startX) / scale;
      const dy = (e.clientY - spawnDrag.startY) / scale;
      const half = avatarSizePx / 2;
      const x = Math.min(Math.max(spawnDrag.originX + dx, half), mapWidth - half);
      const y = Math.min(Math.max(spawnDrag.originY + dy, half), mapHeight - half);
      // 障害物・ミーティングエリアと重なる位置へはドラッグできないように
      // する(重ならない位置に来るまで、現在位置に留まる)。
      if (!spawnOverlapsAnyZone(x, y)) {
        setError(null);
        setSpawnPoint({ x, y });
      }
      return;
    }
    const drag = dragState.current;
    if (!drag) return;
    if (drag.mode === "rotate") {
      const angleDeg =
        (Math.atan2(e.clientY - drag.centerY, e.clientX - drag.centerX) *
          180) /
        Math.PI;
      let rotation =
        (drag.originRotationDeg + (angleDeg - drag.startAngleDeg) + 360) %
        360;
      // Shift押下中は15度単位にスナップし、意図しない中途半端な角度に
      // なりにくくする。
      if (e.shiftKey) rotation = Math.round(rotation / 15) * 15;
      if (drag.itemType === "object") {
        setPlacedObjects((prev) =>
          prev.map((o) => (o.id === drag.id ? { ...o, rotation } : o)),
        );
      } else {
        setObstacles((prev) =>
          prev.map((o) => (o.id === drag.id ? { ...o, rotation } : o)),
        );
      }
      return;
    }
    const dx = (e.clientX - drag.startX) / scale;
    const dy = (e.clientY - drag.startY) / scale;
    if (drag.itemType === "obstacle") {
      setObstacles((prev) =>
        applyDrag(prev, drag, dx, dy, MIN_OBSTACLE_WIDTH, MIN_OBSTACLE_HEIGHT),
      );
    } else if (drag.itemType === "object") {
      setPlacedObjects((prev) => applyDrag(prev, drag, dx, dy));
    } else {
      setMeetingZones((prev) => applyDrag(prev, drag, dx, dy));
    }
  };

  const handlePointerUp = () => {
    dragState.current = null;
    spawnDragState.current = null;
    warpDragState.current = null;
  };

  const handleWarpPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const point = warpPoints.find((w) => w.id === id);
    if (!point) return;
    pushUndo();
    warpDragState.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      originX: point.x,
      originY: point.y,
    };
  };

  // ワープ(A/B/Cチャンネルは1ペア=丸2つまで。ボタンは既にペアがある
  // チャンネルでは無効化するため、ここでは新規追加のみを考える)。
  // 2つの丸は少しずらして両方が重ならずに見えるよう、中心から左右に
  // ずらして配置する。
  const addWarpPair = (channel: (typeof WARP_CHANNELS)[number]) => {
    pushUndo();
    const center = getVisibleCenterMapPoint();
    const offset = WARP_POINT_RADIUS + 20;
    const clamp = (x: number, y: number) => ({
      x: Math.min(Math.max(x, WARP_POINT_RADIUS), mapWidth - WARP_POINT_RADIUS),
      y: Math.min(Math.max(y, WARP_POINT_RADIUS), mapHeight - WARP_POINT_RADIUS),
    });
    const p1 = clamp(center.x - offset, center.y);
    const p2 = clamp(center.x + offset, center.y);
    setWarpPoints((prev) => [
      ...prev,
      { id: randomItemId("warp"), channel, ...p1 },
      { id: randomItemId("warp"), channel, ...p2 },
    ]);
  };

  const removeWarpPair = (channel: string) => {
    pushUndo();
    setWarpPoints((prev) => prev.filter((w) => w.channel !== channel));
  };

  const updateWarpLabel = (id: string, label: string) =>
    setWarpPoints((prev) =>
      prev.map((w) => (w.id === id ? { ...w, label } : w)),
    );

  const handleSpawnPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!spawnPoint) return;
    pushUndo();
    spawnDragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: spawnPoint.x,
      originY: spawnPoint.y,
    };
  };

  // アバター初期位置のデフォルト設置: 背景画像(マップ)の中心付近で、障害物・
  // ミーティングエリアと重ならない位置を探す。以前は専用ボタンで手動設置
  // していたが、DBに座標が無い(=まだ一度もレイアウト保存していない)
  // 初回編集時に自動で呼び出すようにした(下のuseEffect参照)。
  const SPAWN_SEARCH_STEP = 20;
  const findDefaultSpawnPoint = () => {
    const half = avatarSizePx / 2;
    const clampX = (x: number) => Math.min(Math.max(x, half), mapWidth - half);
    const clampY = (y: number) => Math.min(Math.max(y, half), mapHeight - half);
    const cx = mapWidth / 2;
    const cy = mapHeight / 2;
    const maxRing = Math.ceil(
      Math.max(mapWidth, mapHeight) / SPAWN_SEARCH_STEP,
    );
    // マップ中心から外側へ正方形のリング状に候補点を広げながら、障害物・
    // ミーティングエリアと重ならない最初の位置を採用する(見つからなければ
    // 中心自体が最も近い妥協案として扱う場合はnullを返し、呼び出し側で
    // エラーにする)。
    for (let ring = 0; ring <= maxRing; ring++) {
      if (ring === 0) {
        const x = clampX(cx);
        const y = clampY(cy);
        if (!spawnOverlapsAnyZone(x, y)) return { x, y };
        continue;
      }
      const r = ring * SPAWN_SEARCH_STEP;
      for (let dx = -r; dx <= r; dx += SPAWN_SEARCH_STEP) {
        for (const dy of [-r, r]) {
          const x = clampX(cx + dx);
          const y = clampY(cy + dy);
          if (!spawnOverlapsAnyZone(x, y)) return { x, y };
        }
      }
      for (let dy = -r + SPAWN_SEARCH_STEP; dy <= r - SPAWN_SEARCH_STEP; dy += SPAWN_SEARCH_STEP) {
        for (const dx of [-r, r]) {
          const x = clampX(cx + dx);
          const y = clampY(cy + dy);
          if (!spawnOverlapsAnyZone(x, y)) return { x, y };
        }
      }
    }
    return null;
  };

  const setSpawnToDefaultPosition = () => {
    const point = findDefaultSpawnPoint();
    if (!point) {
      setError(
        "壁・ミーティングエリアが多く、アバター初期位置を設置できる空きスペースが見つかりませんでした。配置を見直してください。",
      );
      return;
    }
    setError(null);
    setSpawnPoint(point);
  };

  // テンプレート作成直後、まだ一度もレイアウト保存しておらずアバター初期
  // 位置の座標がDBに無い(spawnPointがnull)場合だけ、初回編集画面表示時に
  // 自動でプレビュー中央付近へ設置する。マウント時の1回だけ実行すればよく、
  // 以後は手動でドラッグして動かした位置がそのまま保存対象になる。
  useEffect(() => {
    if (spawnPoint !== null) return;
    setSpawnToDefaultPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 新規アイテムを追加する位置。固定座標(旧: 常に100,100=マップ左上)だと
  // ズームして画面外を見ている最中に追加した際、新しいアイテムが画面外の
  // 左上に置かれて見失ってしまうため、常に「今スクロールして見えている
  // 範囲の中心」の地図座標を返す。
  const getVisibleCenterMapPoint = () => {
    const el = scrollRef.current;
    if (!el) return { x: mapWidth / 2, y: mapHeight / 2 };
    return {
      x: (el.scrollLeft + el.clientWidth / 2) / scale,
      y: (el.scrollTop + el.clientHeight / 2) / scale,
    };
  };

  const addObstacle = () => {
    pushUndo();
    const center = getVisibleCenterMapPoint();
    const pos = clampPosition(
      center.x - NEW_ITEM_SIZE / 2,
      center.y - NEW_ITEM_SIZE / 2,
      NEW_ITEM_SIZE,
      NEW_ITEM_SIZE,
      mapWidth,
      mapHeight,
    );
    setObstacles((prev) => [
      ...prev,
      {
        id: randomItemId("obstacle"),
        ...pos,
        width: NEW_ITEM_SIZE,
        height: NEW_ITEM_SIZE,
        label: "🧱 壁",
      },
    ]);
  };

  const addMeetingZone = () => {
    pushUndo();
    const center = getVisibleCenterMapPoint();
    const pos = clampPosition(
      center.x - NEW_ITEM_SIZE,
      center.y - NEW_ITEM_SIZE,
      NEW_ITEM_SIZE * 2,
      NEW_ITEM_SIZE * 2,
      mapWidth,
      mapHeight,
    );
    setMeetingZones((prev) => [
      ...prev,
      {
        id: randomItemId("meeting"),
        ...pos,
        width: NEW_ITEM_SIZE * 2,
        height: NEW_ITEM_SIZE * 2,
        label: "ミーティングエリア",
        kind: "meeting",
      },
    ]);
  };

  // 「会議室」: 機能(同じエリア内での自動音声接続)はミーティングエリアと
  // 全く同じだが、バーチャル空間内では見た目に出さない(透明・枠なし・
  // ラベル非表示)エリア。編集画面でだけ薄緑色+「会議室」と表示される。
  const addConferenceRoom = () => {
    pushUndo();
    const center = getVisibleCenterMapPoint();
    const pos = clampPosition(
      center.x - NEW_ITEM_SIZE,
      center.y - NEW_ITEM_SIZE,
      NEW_ITEM_SIZE * 2,
      NEW_ITEM_SIZE * 2,
      mapWidth,
      mapHeight,
    );
    setMeetingZones((prev) => [
      ...prev,
      {
        id: randomItemId("conference"),
        ...pos,
        width: NEW_ITEM_SIZE * 2,
        height: NEW_ITEM_SIZE * 2,
        label: "会議室",
        kind: "conference",
      },
    ]);
  };

  // 「全体アナウンスエリア」: 同エリア内の自動音声接続に加えて、このエリア内で
  // マイクONの人の音声はルーム内全員に一方的に届く(受信専用の人には届かない)。
  // 見た目はミーティングエリアと同様に枠・ラベルを表示する(編集画面では
  // 区別しやすいよう琥珀色で表示)。
  const addAnnouncementZone = () => {
    pushUndo();
    const center = getVisibleCenterMapPoint();
    const pos = clampPosition(
      center.x - NEW_ITEM_SIZE,
      center.y - NEW_ITEM_SIZE,
      NEW_ITEM_SIZE * 2,
      NEW_ITEM_SIZE * 2,
      mapWidth,
      mapHeight,
    );
    setMeetingZones((prev) => [
      ...prev,
      {
        id: randomItemId("announcement"),
        ...pos,
        width: NEW_ITEM_SIZE * 2,
        height: NEW_ITEM_SIZE * 2,
        label: "全体アナウンスエリア",
        kind: "announcement",
      },
    ]);
  };

  // 作業エリア:音声通話・ビデオ通話・画面共有をすべて利用不可にするエリア。
  // 見た目はミーティングエリアと同様に枠・ラベルを表示する(編集画面では
  // 区別しやすいよう水色で表示)。
  const addWorkArea = () => {
    pushUndo();
    const center = getVisibleCenterMapPoint();
    const pos = clampPosition(
      center.x - NEW_ITEM_SIZE,
      center.y - NEW_ITEM_SIZE,
      NEW_ITEM_SIZE * 2,
      NEW_ITEM_SIZE * 2,
      mapWidth,
      mapHeight,
    );
    setMeetingZones((prev) => [
      ...prev,
      {
        id: randomItemId("work"),
        ...pos,
        width: NEW_ITEM_SIZE * 2,
        height: NEW_ITEM_SIZE * 2,
        label: "作業エリア",
        kind: "work",
      },
    ]);
  };

  // 削除したアイテムが選択中だった場合は選択を解除する(赤枠・コピー
  // 吹き出しが消えたアイテムに付いたままにならないように)。
  const deselectIfRemoved = (itemType: ItemType, id: string) =>
    setSelectedItem((prev) =>
      prev?.itemType === itemType && prev.id === id ? null : prev,
    );

  const removeObstacle = (id: string) => {
    pushUndo();
    setObstacles((prev) => prev.filter((o) => o.id !== id));
    deselectIfRemoved("obstacle", id);
  };
  const removeMeetingZone = (id: string) => {
    pushUndo();
    setMeetingZones((prev) => prev.filter((z) => z.id !== id));
    deselectIfRemoved("zone", id);
  };
  const removePlacedObject = (id: string) => {
    pushUndo();
    setPlacedObjects((prev) => prev.filter((o) => o.id !== id));
    deselectIfRemoved("object", id);
  };

  // 「オブジェクト登録」: 選択したPNG画像をアップロードし、ライブラリに
  // 即時追加・保存する(背景画像の変更と同じ考え方。詳細はobjectLibrary
  // stateのコメント参照)。
  const handleRegisterObjectImage = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setRegisteringObject(true);
    try {
      const url = await uploadTemplateObjectImageClient(file);
      const next = [
        ...objectLibrary,
        { id: randomItemId("object-image"), imageUrl: url },
      ];
      const result = await updateTemplateObjectLibrary(template.id, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setObjectLibrary(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "画像の登録に失敗しました");
    } finally {
      setRegisteringObject(false);
    }
  };

  // ライブラリから選択中の画像を削除する(Storage上の実ファイルは削除
  // しない。理由はTemplateObjectImage型のコメント参照。既に配置済みの
  // インスタンスの表示を壊さないため)。
  const handleDeleteLibraryImage = async () => {
    if (!selectedLibraryImageId) return;
    setError(null);
    setDeletingLibraryImage(true);
    try {
      const next = objectLibrary.filter((o) => o.id !== selectedLibraryImageId);
      const result = await updateTemplateObjectLibrary(template.id, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setObjectLibrary(next);
      setSelectedLibraryImageId(null);
    } finally {
      setDeletingLibraryImage(false);
    }
  };

  // ライブラリから選択中の画像をマップの中央へ配置する。画像の実サイズ
  // (縦横比)を測ってから、長辺が150pxに収まるデフォルトサイズで配置する
  // (壁と違い実際に見える画像のため、いびつな正方形に潰れないようにする)。
  // 位置・サイズ・回転は配置後に壁と同じ操作で自由に変更できる。
  const insertPlacedObject = () => {
    const image = objectLibrary.find((o) => o.id === selectedLibraryImageId);
    if (!image) return;
    pushUndo();
    const placeWithSize = (width: number, height: number) => {
      const center = getVisibleCenterMapPoint();
      const pos = clampPosition(
        center.x - width / 2,
        center.y - height / 2,
        width,
        height,
        mapWidth,
        mapHeight,
      );
      const id = randomItemId("placed-object");
      setPlacedObjects((prev) => [
        ...prev,
        { id, ...pos, width, height, imageUrl: image.imageUrl },
      ]);
      setSelectedItem({ itemType: "object", id });
      setPasteBubbleAt(null);
    };
    const DEFAULT_LONG_SIDE = 150;
    const el = new Image();
    el.onload = () => {
      const naturalWidth = el.naturalWidth || NEW_ITEM_SIZE;
      const naturalHeight = el.naturalHeight || NEW_ITEM_SIZE;
      const toDefault = DEFAULT_LONG_SIDE / Math.max(naturalWidth, naturalHeight);
      placeWithSize(
        Math.max(MIN_ITEM_SIZE, Math.round(naturalWidth * toDefault)),
        Math.max(MIN_ITEM_SIZE, Math.round(naturalHeight * toDefault)),
      );
    };
    // 画像の実サイズが取得できない場合も、壁と同じデフォルト正方形で配置する。
    el.onerror = () => placeWithSize(NEW_ITEM_SIZE, NEW_ITEM_SIZE);
    el.src = image.imageUrl;
  };

  // ---- 壁・エリア・オブジェクトのコピー・貼り付け ----
  // 選択中のアイテムの種類・サイズ・角度等をその場限りのクリップボード
  // (copiedItemTemplateRef、DBには保存しない)へコピーする。「コピー」
  // 吹き出しのクリック・Ctrl+Cのどちらからも呼ぶ。
  const copySelectedItem = () => {
    if (!selectedItem) return;
    if (selectedItem.itemType === "obstacle") {
      const target = obstacles.find((o) => o.id === selectedItem.id);
      if (!target) return;
      copiedItemTemplateRef.current = {
        itemType: "obstacle",
        width: target.width,
        height: target.height,
        rotation: target.rotation ?? 0,
        label: target.label,
      };
    } else if (selectedItem.itemType === "zone") {
      const target = meetingZones.find((z) => z.id === selectedItem.id);
      if (!target) return;
      copiedItemTemplateRef.current = {
        itemType: "zone",
        width: target.width,
        height: target.height,
        label: target.label,
        kind: target.kind,
      };
    } else {
      const target = placedObjects.find((o) => o.id === selectedItem.id);
      if (!target) return;
      copiedItemTemplateRef.current = {
        itemType: "object",
        width: target.width,
        height: target.height,
        rotation: target.rotation ?? 0,
        imageUrl: target.imageUrl,
      };
    }
  };

  // コピー済みのアイテムを指定した地図座標(中心)へ貼り付ける。
  // 「貼り付け」吹き出しのクリック・Ctrl+Vのどちらからも呼ぶ。
  const pasteCopiedItemAt = (mapX: number, mapY: number) => {
    const copied = copiedItemTemplateRef.current;
    if (!copied) return;
    pushUndo();
    const pos = clampPosition(
      mapX - copied.width / 2,
      mapY - copied.height / 2,
      copied.width,
      copied.height,
      mapWidth,
      mapHeight,
    );
    if (copied.itemType === "obstacle") {
      const id = randomItemId("obstacle");
      setObstacles((prev) => [
        ...prev,
        {
          id,
          ...pos,
          width: copied.width,
          height: copied.height,
          label: copied.label,
          rotation: copied.rotation,
        },
      ]);
      setSelectedItem({ itemType: "obstacle", id });
    } else if (copied.itemType === "zone") {
      const id = randomItemId("zone");
      setMeetingZones((prev) => [
        ...prev,
        {
          id,
          ...pos,
          width: copied.width,
          height: copied.height,
          label: copied.label,
          kind: copied.kind,
        },
      ]);
      setSelectedItem({ itemType: "zone", id });
    } else {
      const id = randomItemId("placed-object");
      setPlacedObjects((prev) => [
        ...prev,
        {
          id,
          ...pos,
          width: copied.width,
          height: copied.height,
          rotation: copied.rotation,
          imageUrl: copied.imageUrl,
        },
      ]);
      setSelectedItem({ itemType: "object", id });
    }
    setPasteBubbleAt(null);
  };

  // Ctrl+Vでの貼り付け位置は、右クリック位置が無いため「挿入」と同じく
  // 現在スクロールして見えている範囲の中心にする。
  const pasteCopiedItemAtViewCenter = () => {
    const center = getVisibleCenterMapPoint();
    pasteCopiedItemAt(center.x, center.y);
  };

  // router.refresh()完了後にonClose()する(refreshingがfalseに戻った
  // タイミングで実行)。
  useEffect(() => {
    if (pendingCloseRef.current && !refreshing) {
      pendingCloseRef.current = false;
      setSaving(false);
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshing]);

  const handleSaveAndClose = async () => {
    setError(null);
    setSaving(true);
    const result = await updateTemplateLayout(
      template.id,
      obstacles,
      meetingZones,
      mapWidth,
      mapHeight,
      spawnPoint,
      warpPoints,
      placedObjects,
    );
    if (!result.ok) {
      setError(result.error);
      setSaving(false);
      return;
    }
    setDirty(false);
    // revalidatePath("/master")はサーバー側のキャッシュを無効化する
    // だけで、既に開いている(ナビゲーションを伴わない)このページの
    // テンプレート一覧props(TemplateManagerのtemplates)には自動反映
    // されない。router.refresh()が必要だが、これは呼び出し側で完了を
    // 待てない(Promiseを返さない)ため、useTransitionのpending状態が
    // falseに戻るまでonClose()を遅らせる。そうしないと、保存直後に
    // 同じテンプレートを開き直した際に保存前の古いobstaclesから再
    // スタートしてしまい、そのまま保存すると直前の変更が消えてしまう
    // (「保存中...」の表示のまま、反映が終わるまで画面遷移しない)。
    pendingCloseRef.current = true;
    startRefreshTransition(() => {
      router.refresh();
    });
  };

  // MasterDashboardのサイドバー経由(タブ切り替え・「管理画面へ」・
  // 「ルームへ」)での画面遷移ガードから呼ばれる保存処理。ナビゲーション
  // 先が決まっているのはMasterDashboard側のため、ここでは保存だけ行い、
  // onClose()は呼ばない(タブが切り替わればこの画面自体がアンマウント
  // されるため、明示的に閉じる必要が無い)。
  const saveLayoutForGuard = useCallback(async (): Promise<boolean> => {
    setError(null);
    const result = await updateTemplateLayout(
      template.id,
      obstacles,
      meetingZones,
      mapWidth,
      mapHeight,
      spawnPoint,
      warpPoints,
      placedObjects,
    );
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setDirty(false);
    router.refresh();
    return true;
  }, [
    template.id,
    obstacles,
    meetingZones,
    mapWidth,
    mapHeight,
    spawnPoint,
    warpPoints,
    placedObjects,
    router,
  ]);

  // 保存していない変更があるかどうかと、保存処理そのものをMasterDashboard
  // 側へ登録しておく(詳細はtemplateEditorGuard.tsx参照)。dirtyの値が
  // 変わるたびに登録し直すことで、常に最新の状態を参照できるようにする。
  useEffect(() => {
    templateEditorGuard?.setGuard({
      isDirty: () => dirty,
      save: saveLayoutForGuard,
    });
    return () => {
      templateEditorGuard?.setGuard(null);
    };
  }, [templateEditorGuard, dirty, saveLayoutForGuard]);

  const handleRename = async () => {
    setError(null);
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setError("テンプレート名を入力してください");
      return;
    }
    setRenaming(true);
    try {
      const result = await renameTemplate(template.id, trimmed);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName(trimmed);
      setEditingName(false);
      router.refresh();
    } finally {
      setRenaming(false);
    }
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const url = await uploadTemplateImageClient(file);
      const result = await replaceTemplateImage(template.id, url);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBackgroundImageUrl(url);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "画像の変更に失敗しました");
    } finally {
      setUploading(false);
    }
  };

  // ---- キーボードショートカット(Ctrl+Z/Ctrl+Y/Ctrl+C/Ctrl+V) ----
  // Mac配列も考慮しCmdキー(metaKey)も同様に扱う。名前変更・マップサイズ・
  // ワープの名前欄などテキスト入力中は、ブラウザ標準のテキスト編集用
  // Undo/Redo・コピー&ペーストを優先させたいため、フォーカスが input/
  // textareaにある間は何もしない。呼び出す関数(handleUndo等)は毎レンダー
  // 作り直されるため、useSessionGuard.tsと同じくrefへ常に最新のものを
  // 入れておき、リスナー自体はマウント時に1回だけ登録する。
  const handleUndoRef = useRef(handleUndo);
  handleUndoRef.current = handleUndo;
  const handleRedoRef = useRef(handleRedo);
  handleRedoRef.current = handleRedo;
  const copySelectedItemRef = useRef(copySelectedItem);
  copySelectedItemRef.current = copySelectedItem;
  const pasteCopiedItemAtViewCenterRef = useRef(pasteCopiedItemAtViewCenter);
  pasteCopiedItemAtViewCenterRef.current = pasteCopiedItemAtViewCenter;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndoRef.current();
      } else if (key === "y") {
        e.preventDefault();
        handleRedoRef.current();
      } else if (key === "c") {
        e.preventDefault();
        copySelectedItemRef.current();
      } else if (key === "v") {
        e.preventDefault();
        pasteCopiedItemAtViewCenterRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const isItemSelected = (itemType: ItemType, id: string) =>
    selectedItem?.itemType === itemType && selectedItem.id === id;

  // 選択中のアイテムに表示する「コピー」吹き出しのクラス名(壁・エリア・
  // オブジェクトで共通の見た目・挙動)。
  const copyBubbleClassName =
    "absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-white shadow hover:bg-slate-700";

  return (
    <div className="flex items-start gap-4">
      {/* 編集項目サイドバー: 名前変更〜各種編集操作を上から順に並べる
          スクロール領域と、常に画面外へスクロールしなくても押せる
          「プレビュー」「保存して終了」「保存せず終了」の固定ボックスを
          縦に並べる。外枠(この要素)の高さを画面いっぱいに固定し
          (sticky + 100vh基準)、スクロール領域はflex-1で残りの高さを
          自動的に埋める(固定ボックス側の高さ変化にも自動追従する)。 */}
      <div className="sticky top-20 flex h-[calc(100vh-6.5rem)] w-64 shrink-0 flex-col gap-3 md:top-6 md:h-[calc(100vh-3rem)]">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-500">ルーム名</p>
          {editingName ? (
            <div className="flex flex-wrap items-center gap-1">
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRename()}
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
              />
              <button
                onClick={handleRename}
                disabled={renaming}
                className="rounded bg-slate-900 px-2 py-1 text-xs font-semibold text-white disabled:opacity-60"
              >
                保存
              </button>
              <button
                onClick={() => {
                  setEditingName(false);
                  setNameInput(name);
                }}
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600"
              >
                キャンセル
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-bold text-slate-800">{name}</p>
              <button
                onClick={() => setEditingName(true)}
                className="shrink-0 rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                名前変更
              </button>
            </div>
          )}
          <label className="mt-2 block cursor-pointer rounded-lg bg-slate-800 px-3 py-1.5 text-center text-xs font-semibold text-white hover:bg-slate-700">
            {uploading ? "アップロード中..." : "ルーム背景変更"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageChange}
              disabled={uploading}
            />
          </label>
        </div>

        <div className="flex items-center gap-1.5">
          <p className="text-xs font-semibold text-slate-500">エリア</p>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            title="エリアの説明を表示"
            className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-400 text-[10px] font-bold leading-none text-slate-500 hover:bg-slate-100"
          >
            ？
          </button>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              onClick={addObstacle}
              className="flex-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
            >
              ＋壁
            </button>
            <button
              onClick={addMeetingZone}
              className="flex-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
            >
              ＋ミーティング
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={addConferenceRoom}
              className="flex-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
            >
              ＋会議
            </button>
            <button
              onClick={addWorkArea}
              className="flex-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
            >
              ＋作業
            </button>
          </div>
          <button
            onClick={addAnnouncementZone}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          >
            ＋全体アナウンス
          </button>
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-semibold text-slate-500">ワープ</p>
            <button
              type="button"
              onClick={() => setWarpHelpOpen(true)}
              title="ワープの説明を表示"
              className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-400 text-[10px] font-bold leading-none text-slate-500 hover:bg-slate-100"
            >
              ？
            </button>
          </div>
          {WARP_CHANNELS.map((channel) => {
            const pair = warpPoints.filter((w) => w.channel === channel);
            const hasPair = pair.length > 0;
            return (
              <div key={channel} className="flex flex-col gap-1">
                <button
                  onClick={() => addWarpPair(channel)}
                  disabled={hasPair}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
                >
                  ＋{WARP_CHANNEL_NAMES[channel]}ワープ
                  {hasPair ? "(設置済み)" : ""}
                </button>
                {hasPair && (
                  <div className="flex gap-1">
                    {pair.map((w, i) => (
                      <input
                        key={w.id}
                        value={w.label ?? ""}
                        onFocus={pushUndo}
                        onChange={(e) => updateWarpLabel(w.id, e.target.value)}
                        placeholder={`丸${i + 1}の名前`}
                        maxLength={20}
                        className="w-1/2 min-w-0 rounded border border-slate-300 px-1.5 py-1 text-[11px] outline-none focus:border-slate-500"
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div>
          <div className="mb-1 flex items-center gap-1.5">
            <p className="text-xs font-semibold text-slate-500">オブジェクト</p>
            <button
              type="button"
              onClick={() => setObjectHelpOpen(true)}
              title="オブジェクトの説明を表示"
              className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-400 text-[10px] font-bold leading-none text-slate-500 hover:bg-slate-100"
            >
              ？
            </button>
          </div>
          <div className="rounded-lg border border-slate-200 p-2">
            {objectLibrary.length > 0 && (
              // 3列目(3行目)まではこの枠自体が中身に合わせて伸び、4行目
              // 以降はここだけスクロールして見る(max-h指定+overflow-y-auto)。
              <div className="mb-2 max-h-[154px] overflow-y-auto">
                <div className="grid grid-cols-4 gap-1.5">
                  {objectLibrary.map((image) => (
                    <button
                      key={image.id}
                      type="button"
                      onClick={() => setSelectedLibraryImageId(image.id)}
                      title="選択"
                      className={`flex aspect-square items-center justify-center overflow-hidden rounded border-2 bg-slate-50 p-1 ${
                        selectedLibraryImageId === image.id
                          ? "border-emerald-500"
                          : "border-transparent hover:border-slate-300"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.imageUrl}
                        alt="登録済みオブジェクト"
                        className="max-h-full max-w-full object-contain"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-1.5">
              <label className="flex-1 cursor-pointer rounded-lg border border-emerald-400 px-2 py-1.5 text-center text-xs font-semibold text-emerald-600 hover:bg-emerald-50">
                {registeringObject ? "登録中..." : "登録"}
                <input
                  type="file"
                  accept="image/png"
                  className="hidden"
                  onChange={handleRegisterObjectImage}
                  disabled={registeringObject}
                />
              </label>
              <button
                type="button"
                onClick={insertPlacedObject}
                disabled={!selectedLibraryImageId}
                className="flex-1 rounded-lg bg-slate-800 px-2 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
              >
                挿入
              </button>
              <button
                type="button"
                onClick={handleDeleteLibraryImage}
                disabled={!selectedLibraryImageId || deletingLibraryImage}
                className="flex-1 rounded-lg border border-red-300 px-2 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
              >
                {deletingLibraryImage ? "削除中..." : "削除"}
              </button>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold text-slate-500">マップサイズ</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step={100}
              value={mapWidthInput}
              onFocus={pushUndo}
              onChange={(e) => setMapWidthInput(e.target.value)}
              onBlur={() => setMapWidthInput(String(mapWidth))}
              className="w-20 rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-slate-500"
            />
            <span className="text-xs text-slate-400">×</span>
            <input
              type="number"
              step={100}
              value={mapHeightInput}
              onFocus={pushUndo}
              onChange={(e) => setMapHeightInput(e.target.value)}
              onBlur={() => setMapHeightInput(String(mapHeight))}
              className="w-20 rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-slate-500"
            />
            <span className="text-xs text-slate-400">px</span>
          </div>
          <button
            onClick={() => {
              pushUndo();
              applyImageNaturalSize();
            }}
            disabled={measuringImageSize}
            className="mt-2 w-full rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
          >
            {measuringImageSize ? "取得中..." : "デフォルト(画像の実サイズ)"}
          </button>
        </div>
      </div>

      {/* 「プレビュー」「保存して終了」「保存せず終了」の固定ボックス。
          上のスクロール領域とは別の箱にすることで、編集項目が増えて
          スクロールが必要になっても、常にスクロールせず押せる
          (2026-09報告: 以前は同じ箱の一番下にあり、保存するために
          毎回下までスクロールする必要があった)。 */}
      <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <button
          onClick={() => setPreviewOpen(true)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          プレビュー
        </button>

        <div className="flex gap-2">
          <button
            onClick={handleSaveAndClose}
            disabled={saving}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {saving ? "保存中..." : "保存して終了"}
          </button>
          <button
            onClick={() => setDiscardConfirmOpen(true)}
            disabled={saving}
            className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-400 disabled:opacity-60"
          >
            保存せず終了
          </button>
        </div>
      </div>
      </div>

      {discardConfirmOpen && (
        <ConfirmModal
          title="保存せず終了"
          message="保存せず終了しますがよろしいですか?"
          confirmLabel="終了する"
          onConfirm={onClose}
          onCancel={() => setDiscardConfirmOpen(false)}
        />
      )}

      {helpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold text-slate-800">エリアの説明</p>
              <button
                onClick={() => setHelpOpen(false)}
                aria-label="閉じる"
                className="rounded px-1.5 text-lg text-slate-400 hover:text-slate-700"
              >
                ×
              </button>
            </div>
            <div className="space-y-2 text-xs text-slate-600">
              <div>
                <p className="font-semibold text-slate-700">【壁】</p>
                <p>・通ることができないエリア</p>
                <p>・上の丸いハンドルをドラッグで回転(Shift押下で15度単位)</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700">【ミーティング】</p>
                <p>・複数人で音声・ビデオ通話・画面共有が可能</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700">【会議】</p>
                <p>・複数人で音声・ビデオ通話・画面共有が可能</p>
                <p>・鍵の開け閉めが可能(鍵を閉めた人のみ鍵を開けることができる)</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700">【作業】</p>
                <p>・音声・ビデオ通話・画面共有不可</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {warpHelpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold text-slate-800">ワープの説明</p>
              <button
                onClick={() => setWarpHelpOpen(false)}
                aria-label="閉じる"
                className="rounded px-1.5 text-lg text-slate-400 hover:text-slate-700"
              >
                ×
              </button>
            </div>
            <div className="space-y-2 text-xs text-slate-600">
              <div>
                <p className="font-semibold text-slate-700">【赤・黄・青ワープ】</p>
                <p>・同じ色の丸2つが1ペア。片方に入るともう片方へ瞬間移動(双方向)</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {objectHelpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold text-slate-800">オブジェクトの説明</p>
              <button
                onClick={() => setObjectHelpOpen(false)}
                aria-label="閉じる"
                className="rounded px-1.5 text-lg text-slate-400 hover:text-slate-700"
              >
                ×
              </button>
            </div>
            <div className="space-y-2 text-xs text-slate-600">
              <div>
                <p className="font-semibold text-slate-700">【オブジェクト】</p>
                <p>・登録した画像(PNGのみ)をマップに自由配置できる装飾</p>
                <p>・通ることができる(壁と違い当たり判定なし)</p>
                <p>・常にアバターより手前に表示される</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {previewOpen && (
        <TemplateRoomPreview
          mapWidth={mapWidth}
          mapHeight={mapHeight}
          backgroundImageUrl={backgroundImageUrl}
          avatarSizePx={avatarSizePx}
          spawnPoint={spawnPoint}
          placedObjects={placedObjects}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {/* 編集キャンバス: 残り幅いっぱい(画面右端)まで広げる */}
      <div ref={measureRef} className="relative min-w-0 flex-1">
        {/* 元に戻す/やり直す。プレビューエリア左上に固定表示し、中身を
            スクロールしても位置が動かないようscrollRefの外側(この
            relativeな親要素基準)に置く。 */}
        <div className="absolute left-2 top-2 z-10 flex gap-1.5">
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoCount === 0}
            title="元に戻す"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white/90 text-sm font-bold text-slate-700 shadow hover:bg-white disabled:opacity-40"
          >
            ←
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={redoCount === 0}
            title="やり直す"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white/90 text-sm font-bold text-slate-700 shadow hover:bg-white disabled:opacity-40"
          >
            →
          </button>
        </div>

        {/* 拡大。プレビューエリア下部中央に固定表示する。 */}
        <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-slate-300 bg-white/90 px-3 py-1.5 shadow">
          <button
            type="button"
            onClick={() => changeZoom(Math.max(1, Math.round((zoom - 0.5) * 100) / 100))}
            disabled={zoom <= 1}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            －
          </button>
          <input
            type="range"
            min={1}
            max={3}
            step={0.5}
            value={zoom}
            onChange={(e) => changeZoom(Number(e.target.value))}
            className="w-24"
          />
          <button
            type="button"
            onClick={() => changeZoom(Math.min(3, Math.round((zoom + 0.5) * 100) / 100))}
            disabled={zoom >= 3}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            ＋
          </button>
          <span className="w-9 shrink-0 text-xs text-slate-500">
            {Math.round(zoom * 100)}%
          </span>
          {zoom !== 1 && (
            <button
              type="button"
              onClick={() => changeZoom(1)}
              className="shrink-0 text-xs text-slate-500 underline hover:text-slate-800"
            >
              リセット
            </button>
          )}
        </div>

        <div
          ref={scrollRef}
          className="relative touch-none overflow-auto rounded-lg border border-slate-300 bg-slate-700"
          style={{ width: viewportWidth, height: viewportHeight }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <div
            className="relative"
            style={{
              width: renderedWidth,
              height: renderedHeight,
              backgroundImage: `url('${backgroundImageUrl}')`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
            }}
            onPointerDown={(e) => {
              // 何もない背景を左クリックした場合のみ発火する(壁・エリア・
              // オブジェクト自身のonPointerDownはstopPropagation済みのため
              // ここまで来ない)。選択中のアイテム・貼り付け吹き出しを
              // 両方解除する。
              if (e.button !== 0) return;
              setSelectedItem(null);
              setPasteBubbleAt(null);
            }}
            onContextMenu={(e) => {
              // コピー済みのアイテムが無ければ右クリックメニューを出す
              // 意味が無いため、ブラウザ標準の右クリックメニューのままにする。
              if (!copiedItemTemplateRef.current) return;
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              setPasteBubbleAt({
                mapX: (e.clientX - rect.left) / scale,
                mapY: (e.clientY - rect.top) / scale,
              });
            }}
          >
            {meetingZones.map((zone) => {
              const isSelected = isItemSelected("zone", zone.id);
              const zoneBgClass =
                zone.kind === "conference"
                  ? "bg-lime-200/25"
                  : zone.kind === "announcement"
                    ? "bg-amber-200/60"
                    : zone.kind === "work"
                      ? "bg-sky-200/60"
                      : "bg-slate-500/50";
              const zoneBorderClass = isSelected
                ? "border-2 border-red-500"
                : zone.kind === "conference"
                  ? "border-green-300"
                  : zone.kind === "announcement"
                    ? "border-amber-300"
                    : zone.kind === "work"
                      ? "border-sky-300"
                      : "border-slate-300";
              return (
                <div
                  key={zone.id}
                  onPointerDown={(e) => handlePointerDown(e, "zone", zone.id, "move")}
                  className={`absolute cursor-move rounded-xl border p-2 ${zoneBorderClass} ${zoneBgClass}`}
                  style={{
                    left: zone.x * scale,
                    top: zone.y * scale,
                    width: zone.width * scale,
                    height: zone.height * scale,
                  }}
                >
                  <span
                    className={`text-xs ${
                      zone.kind === "conference"
                        ? "text-green-900"
                        : zone.kind === "announcement"
                          ? "text-amber-900"
                          : zone.kind === "work"
                            ? "text-sky-900"
                            : "text-white"
                    }`}
                  >
                    {zone.label}
                  </span>
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => removeMeetingZone(zone.id)}
                    className="absolute right-1 top-1 rounded bg-red-600 px-1.5 text-[10px] leading-4 text-white"
                  >
                    ×
                  </button>
                  <div
                    onPointerDown={(e) =>
                      handlePointerDown(e, "zone", zone.id, "resize")
                    }
                    className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize bg-slate-200"
                  />
                  {isSelected && (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={copySelectedItem}
                      className={copyBubbleClassName}
                    >
                      コピー
                    </button>
                  )}
                </div>
              );
            })}

            {obstacles.map((o) => {
              const isSelected = isItemSelected("obstacle", o.id);
              return (
                <div
                  key={o.id}
                  onPointerDown={(e) => handlePointerDown(e, "obstacle", o.id, "move")}
                  className={`absolute flex cursor-move items-center justify-center rounded border bg-amber-500/60 text-center text-[10px] text-white ${
                    isSelected ? "border-2 border-red-500" : "border-amber-400"
                  }`}
                  style={{
                    left: o.x * scale,
                    top: o.y * scale,
                    width: o.width * scale,
                    height: o.height * scale,
                    transform: `rotate(${o.rotation ?? 0}deg)`,
                    transformOrigin: "50% 50%",
                  }}
                >
                  🧱 壁
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => removeObstacle(o.id)}
                    className="absolute right-0 top-0 rounded bg-red-600 px-1.5 text-[10px] leading-4 text-white"
                  >
                    ×
                  </button>
                  {/* 回転ハンドル: ドラッグで自由回転(Shift押下で15度単位スナップ)。
                      壁本体と一緒に回転するので、常に壁から見て「真上」に付いてくる。 */}
                  <div
                    onPointerDown={(e) =>
                      handleRotatePointerDown(e, "obstacle", o.id, o.rotation ?? 0)
                    }
                    title="ドラッグで回転(Shiftで15度単位)"
                    className="absolute -top-4 left-1/2 h-3 w-3 -translate-x-1/2 cursor-alias rounded-full border border-amber-600 bg-white"
                  />
                  <div
                    onPointerDown={(e) =>
                      handlePointerDown(e, "obstacle", o.id, "resize")
                    }
                    className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize bg-slate-200"
                  />
                  {isSelected && (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={copySelectedItem}
                      className={copyBubbleClassName}
                    >
                      コピー
                    </button>
                  )}
                </div>
              );
            })}

            {/* 装飾オブジェクト(2026-09追加)。壁と違い実際に画像として表示
                され、当たり判定は持たない。ドラッグ・リサイズ・回転の操作感は
                壁と共通(handlePointerDown/handleRotatePointerDownをitemType
                "object"で呼ぶ)。 */}
            {placedObjects.map((o) => {
              const isSelected = isItemSelected("object", o.id);
              return (
                <div
                  key={o.id}
                  onPointerDown={(e) => handlePointerDown(e, "object", o.id, "move")}
                  className={`absolute cursor-move rounded border ${
                    isSelected
                      ? "border-2 border-red-500"
                      : "border-dashed border-violet-400"
                  }`}
                  style={{
                    left: o.x * scale,
                    top: o.y * scale,
                    width: o.width * scale,
                    height: o.height * scale,
                    transform: `rotate(${o.rotation ?? 0}deg)`,
                    transformOrigin: "50% 50%",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={o.imageUrl}
                    alt="配置したオブジェクト"
                    draggable={false}
                    className="pointer-events-none h-full w-full select-none object-contain"
                  />
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => removePlacedObject(o.id)}
                    className="absolute right-0 top-0 rounded bg-red-600 px-1.5 text-[10px] leading-4 text-white"
                  >
                    ×
                  </button>
                  <div
                    onPointerDown={(e) =>
                      handleRotatePointerDown(e, "object", o.id, o.rotation ?? 0)
                    }
                    title="ドラッグで回転(Shiftで15度単位)"
                    className="absolute -top-4 left-1/2 h-3 w-3 -translate-x-1/2 cursor-alias rounded-full border border-violet-600 bg-white"
                  />
                  <div
                    onPointerDown={(e) =>
                      handlePointerDown(e, "object", o.id, "resize")
                    }
                    className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize bg-slate-200"
                  />
                  {/* コピー吹き出し: 選択中のオブジェクトにだけ表示する
                      (Ctrl+Cでも同じ動作)。 */}
                  {isSelected && (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={copySelectedItem}
                      className={copyBubbleClassName}
                    >
                      コピー
                    </button>
                  )}
                </div>
              );
            })}

            {warpPoints.map((w) => (
              <Fragment key={w.id}>
                {w.label && (
                  <div
                    className="pointer-events-none absolute flex justify-center"
                    style={{
                      left: (w.x - WARP_POINT_RADIUS) * scale,
                      top: (w.y - WARP_POINT_RADIUS) * scale,
                      width: WARP_POINT_RADIUS * 2 * scale,
                      transform: "translateY(-100%)",
                    }}
                  >
                    <span className="whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                      {w.label}
                    </span>
                  </div>
                )}
                <div
                  onPointerDown={(e) => handleWarpPointerDown(e, w.id)}
                  className={`absolute flex cursor-move items-center justify-center rounded-full border-2 text-xs font-bold text-white ${warpChannelClasses(w.channel)}`}
                  style={{
                    left: (w.x - WARP_POINT_RADIUS) * scale,
                    top: (w.y - WARP_POINT_RADIUS) * scale,
                    width: WARP_POINT_RADIUS * 2 * scale,
                    height: WARP_POINT_RADIUS * 2 * scale,
                  }}
                >
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => removeWarpPair(w.channel)}
                    title="このペア(丸2つ)をまとめて削除"
                    className="absolute -right-1 -top-1 rounded bg-red-600 px-1.5 text-[10px] leading-4 text-white"
                  >
                    ×
                  </button>
                </div>
              </Fragment>
            ))}

            {spawnPoint && (
              <div
                onPointerDown={handleSpawnPointerDown}
                className="absolute cursor-move rounded-full ring-2 ring-emerald-400"
                style={{
                  left: (spawnPoint.x - avatarSizePx / 2) * scale,
                  top: (spawnPoint.y - avatarSizePx / 2) * scale,
                  width: avatarSizePx * scale,
                  height: avatarSizePx * scale,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/avatar/goo/front.webp"
                  alt="アバター初期位置"
                  className="pointer-events-none h-full w-full object-contain"
                />
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    pushUndo();
                    setSpawnPoint(null);
                  }}
                  className="absolute -right-1 -top-1 rounded bg-red-600 px-1.5 text-[10px] leading-4 text-white"
                >
                  ×
                </button>
              </div>
            )}

            {/* 貼り付け吹き出し: 何かコピーした状態でマップを右クリックした
                位置に表示する。 */}
            {pasteBubbleAt && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() =>
                  pasteCopiedItemAt(pasteBubbleAt.mapX, pasteBubbleAt.mapY)
                }
                className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-slate-800 px-2 py-1 text-xs font-semibold text-white shadow hover:bg-slate-700"
                style={{
                  left: pasteBubbleAt.mapX * scale,
                  top: pasteBubbleAt.mapY * scale,
                }}
              >
                貼り付け
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
