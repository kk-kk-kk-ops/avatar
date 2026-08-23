"use client";

import { useEffect, useRef, useState } from "react";
import type { MapTemplate, Obstacle, MeetingZone } from "@/lib/types";
import {
  NEW_ITEM_SIZE,
  AVATAR_HITBOX_WIDTH,
  AVATAR_HITBOX_HEIGHT,
  clampPosition,
  clampSize,
  randomItemId,
  rectIntersectsRect,
} from "@/lib/types";
import {
  updateTemplateLayout,
  replaceTemplateImage,
  renameTemplate,
} from "./actions";
import { uploadTemplateImageClient } from "./uploadTemplateImage";
import ConfirmModal from "@/components/ConfirmModal";
import TemplateRoomPreview from "./TemplateRoomPreview";

type ItemType = "obstacle" | "zone";

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
    };

const MAX_DISPLAY_WIDTH = 1200;
const MIN_MAP_SIZE = 400;
const MAX_MAP_SIZE = 8000;

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
  const [obstacles, setObstacles] = useState<Obstacle[]>(template.obstacles);
  const [meetingZones, setMeetingZones] = useState<MeetingZone[]>(
    template.meetingZones,
  );
  // 入室時のアバター初期位置(中心座標)。1点のみ持てる。未設定ならnull
  // (=マップ中心にスポーンする従来の挙動のまま)。
  const [spawnPoint, setSpawnPoint] = useState<{ x: number; y: number } | null>(
    template.spawnPoint,
  );
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(
    template.backgroundImageUrl,
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(template.name);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(template.name);
  const [renaming, setRenaming] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
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
  const measureRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(MAX_DISPLAY_WIDTH);
  const [availableHeight, setAvailableHeight] = useState(600);
  const [zoom, setZoom] = useState(1);

  // 画面(特に縦幅が小さいノートPCなど)にマップ全体が収まるよう、
  // 「横幅に入る幅」「縦幅に入る高さ」を実測しておく(依存はマウント時の
  // リサイズだけで、マップサイズが変わったときの再計算はfitScale側で
  // 都度行う)。
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const recompute = () => {
      setAvailableWidth(el.clientWidth);
      setAvailableHeight(window.innerHeight * 0.75);
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

  const handlePointerDown = (
    e: React.PointerEvent,
    itemType: ItemType,
    id: string,
    mode: "move" | "resize",
  ) => {
    e.stopPropagation();
    const list = itemType === "obstacle" ? obstacles : meetingZones;
    const item = list.find((i) => i.id === id);
    if (!item) return;
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
      const size = clampSize(
        item.x,
        item.y,
        drag.originWidth + dx,
        drag.originHeight + dy,
        mapWidth,
        mapHeight,
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
      obstacles.some((o) => rectIntersectsRect(x, y, halfW, halfH, o)) ||
      meetingZones.some((z) => rectIntersectsRect(x, y, halfW, halfH, z))
    );
  };

  const handlePointerMove = (e: React.PointerEvent) => {
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
    const dx = (e.clientX - drag.startX) / scale;
    const dy = (e.clientY - drag.startY) / scale;
    if (drag.itemType === "obstacle") {
      setObstacles((prev) => applyDrag(prev, drag, dx, dy));
    } else {
      setMeetingZones((prev) => applyDrag(prev, drag, dx, dy));
    }
  };

  const handlePointerUp = () => {
    dragState.current = null;
    spawnDragState.current = null;
  };

  const handleSpawnPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!spawnPoint) return;
    spawnDragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: spawnPoint.x,
      originY: spawnPoint.y,
    };
  };

  // 「＋アバター初期位置」ボタン: 今見えている範囲の中心へ(既に置いてい
  // れば移動、未設置なら新規設置)。1点しか持たないstateなので、これだけで
  // 「もう一度押すと元の位置を消して再設置」を満たす。
  const setSpawnToVisibleCenter = () => {
    const center = getVisibleCenterMapPoint();
    const half = avatarSizePx / 2;
    const x = Math.min(Math.max(center.x, half), mapWidth - half);
    const y = Math.min(Math.max(center.y, half), mapHeight - half);
    if (spawnOverlapsAnyZone(x, y)) {
      setError(
        "表示中の中心が障害物・ミーティングエリアと重なっているため、アバター初期位置を設置できませんでした。別の位置にスクロールしてからもう一度お試しください。",
      );
      return;
    }
    setError(null);
    setSpawnPoint({ x, y });
  };

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
        label: "🧱 障害物",
      },
    ]);
  };

  const addMeetingZone = () => {
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

  const removeObstacle = (id: string) =>
    setObstacles((prev) => prev.filter((o) => o.id !== id));
  const removeMeetingZone = (id: string) =>
    setMeetingZones((prev) => prev.filter((z) => z.id !== id));

  const handleSaveAndClose = async () => {
    setError(null);
    setSaving(true);
    try {
      const result = await updateTemplateLayout(
        template.id,
        obstacles,
        meetingZones,
        mapWidth,
        mapHeight,
        spawnPoint,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "画像の変更に失敗しました");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-start gap-4">
      {/* 編集項目サイドバー: 名前変更〜各種編集操作を上から順に並べ、
          一番下に「保存し終了」「保存せず終了」ボタンを置く。高さは
          プレビュー(マップサイズ)に関わらず常に画面の高さいっぱいまで
          伸ばす(sticky + 100vh基準の高さ指定)。 */}
      <div className="sticky top-20 flex h-[calc(100vh-6.5rem)] w-64 shrink-0 flex-col gap-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 md:top-6 md:h-[calc(100vh-3rem)]">
        <div>
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
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={addObstacle}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          >
            ＋障害物
          </button>
          <button
            onClick={addMeetingZone}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          >
            ＋ミーティングエリア
          </button>
          <button
            onClick={addConferenceRoom}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          >
            ＋会議室
          </button>
          <button
            onClick={addAnnouncementZone}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          >
            ＋全体アナウンスエリア
          </button>
          <button
            onClick={setSpawnToVisibleCenter}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          >
            ＋アバター初期位置
          </button>
          <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-center text-xs font-semibold text-slate-600 hover:bg-slate-50">
            {uploading ? "アップロード中..." : "背景画像を変更"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageChange}
              disabled={uploading}
            />
          </label>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold text-slate-500">マップサイズ</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step={100}
              value={mapWidthInput}
              onChange={(e) => setMapWidthInput(e.target.value)}
              onBlur={() => setMapWidthInput(String(mapWidth))}
              className="w-20 rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-slate-500"
            />
            <span className="text-xs text-slate-400">×</span>
            <input
              type="number"
              step={100}
              value={mapHeightInput}
              onChange={(e) => setMapHeightInput(e.target.value)}
              onBlur={() => setMapHeightInput(String(mapHeight))}
              className="w-20 rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-slate-500"
            />
            <span className="text-xs text-slate-400">px</span>
          </div>
          <button
            onClick={applyImageNaturalSize}
            disabled={measuringImageSize}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            {measuringImageSize ? "取得中..." : "デフォルト(画像の実サイズ)"}
          </button>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold text-slate-500">
            拡大 {Math.round(zoom * 100)}%
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setZoom((z) => Math.max(1, Math.round((z - 0.5) * 100) / 100))}
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
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full"
            />
            <button
              onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.5) * 100) / 100))}
              disabled={zoom >= 3}
              className="rounded border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              ＋
            </button>
          </div>
          {zoom !== 1 && (
            <button
              onClick={() => setZoom(1)}
              className="mt-1 text-xs text-slate-500 underline hover:text-slate-800"
            >
              リセット
            </button>
          )}
        </div>

        <button
          onClick={() => setPreviewOpen(true)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          プレビュー
        </button>

        <div className="mt-auto flex flex-col gap-2">
          <button
            onClick={handleSaveAndClose}
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {saving ? "保存中..." : "レイアウトを保存し終了"}
          </button>
          <button
            onClick={() => setDiscardConfirmOpen(true)}
            disabled={saving}
            className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            レイアウトを保存せず終了
          </button>
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

      {previewOpen && (
        <TemplateRoomPreview
          mapWidth={mapWidth}
          mapHeight={mapHeight}
          backgroundImageUrl={backgroundImageUrl}
          avatarSizePx={avatarSizePx}
          spawnPoint={spawnPoint}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {/* 編集キャンバス: 残り幅いっぱい(画面右端)まで広げる */}
      <div ref={measureRef} className="min-w-0 flex-1">
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
          >
            {meetingZones.map((zone) => (
              <div
                key={zone.id}
                onPointerDown={(e) => handlePointerDown(e, "zone", zone.id, "move")}
                className={`absolute cursor-move rounded-xl border p-2 ${
                  zone.kind === "conference"
                    ? "border-green-300 bg-lime-200/25"
                    : zone.kind === "announcement"
                      ? "border-amber-300 bg-amber-200/60"
                      : "border-slate-300 bg-slate-500/50"
                }`}
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
              </div>
            ))}

            {obstacles.map((o) => (
              <div
                key={o.id}
                onPointerDown={(e) => handlePointerDown(e, "obstacle", o.id, "move")}
                className="absolute flex cursor-move items-center justify-center rounded border border-amber-400 bg-amber-500/60 text-center text-[10px] text-white"
                style={{
                  left: o.x * scale,
                  top: o.y * scale,
                  width: o.width * scale,
                  height: o.height * scale,
                }}
              >
                {o.label}
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => removeObstacle(o.id)}
                  className="absolute right-0 top-0 rounded bg-red-600 px-1.5 text-[10px] leading-4 text-white"
                >
                  ×
                </button>
                <div
                  onPointerDown={(e) =>
                    handlePointerDown(e, "obstacle", o.id, "resize")
                  }
                  className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize bg-slate-200"
                />
              </div>
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
                  onClick={() => setSpawnPoint(null)}
                  className="absolute -right-1 -top-1 rounded bg-red-600 px-1.5 text-[10px] leading-4 text-white"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
