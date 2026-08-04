"use client";

import { useEffect, useRef, useState } from "react";
import type { MapTemplate, Obstacle, MeetingZone } from "@/lib/types";
import {
  MAP_WIDTH,
  NEW_ITEM_SIZE,
  clampPosition,
  clampSize,
  randomItemId,
} from "@/lib/types";
import {
  updateTemplateLayout,
  replaceTemplateImage,
  renameTemplate,
} from "./actions";
import { uploadTemplateImageClient } from "./uploadTemplateImage";

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

const MAX_DISPLAY_WIDTH = 720;

// テンプレートの背景画像上に障害物・ミーティングエリアを配置編集する。
// マップ編集はここに一本化されており、個々のルームでは編集できない。
export default function TemplateEditor({
  template,
  onClose,
}: {
  template: MapTemplate;
  onClose: () => void;
}) {
  const [obstacles, setObstacles] = useState<Obstacle[]>(template.obstacles);
  const [meetingZones, setMeetingZones] = useState<MeetingZone[]>(
    template.meetingZones,
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
  const dragState = useRef<DragState | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [baseSize, setBaseSize] = useState(MAX_DISPLAY_WIDTH);
  const [zoom, setZoom] = useState(1);

  // 画面(特に縦幅が小さいノートPCなど)にマップ全体が収まるよう、表示の
  // 基準サイズを「横幅に入る幅」と「縦幅に入る高さ」の小さい方に合わせて
  // 動的に決める。MAP_WIDTH===MAP_HEIGHT(正方形)なので1辺の長さだけで良い。
  // (CSSのaspect-ratio+max-heightだけだと横幅と縦幅が独立して決まってしまい、
  // マップの下側がコンテナからはみ出て見えなくなっていたため、JS側で
  // 実測して正方形を保証する)
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const recompute = () => {
      const availableWidth = el.clientWidth;
      const availableHeight = window.innerHeight * 0.6;
      setBaseSize(
        Math.max(240, Math.min(MAX_DISPLAY_WIDTH, availableWidth, availableHeight)),
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

  // 障害物・ミーティングエリアの位置調整がしやすいよう、拡大表示できる
  // ようにしている。拡大時は表示ウィンドウ(baseSize四方)は変えず、中身の
  // マップ側をrenderedSizeまで大きくしてスクロールで見る(transform:scaleで
  // 見た目だけ拡大するとoverflow-autoのスクロール範囲計算があいまいに
  // なるため、実際のpx幅・高さとして拡大している)。
  const renderedSize = baseSize * zoom;
  const scale = renderedSize / MAP_WIDTH;

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

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragState.current;
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / scale;
    const dy = (e.clientY - drag.startY) / scale;
    const setList = drag.itemType === "obstacle" ? setObstacles : setMeetingZones;
    setList((prev) =>
      prev.map((item) => {
        if (item.id !== drag.id) return item;
        if (drag.mode === "move") {
          const pos = clampPosition(
            drag.originX + dx,
            drag.originY + dy,
            item.width,
            item.height,
          );
          return { ...item, ...pos };
        }
        const size = clampSize(
          item.x,
          item.y,
          drag.originWidth + dx,
          drag.originHeight + dy,
        );
        return { ...item, ...size };
      }),
    );
  };

  const handlePointerUp = () => {
    dragState.current = null;
  };

  const addObstacle = () => {
    setObstacles((prev) => [
      ...prev,
      {
        id: randomItemId("obstacle"),
        x: 100,
        y: 100,
        width: NEW_ITEM_SIZE,
        height: NEW_ITEM_SIZE,
        label: "🧱 障害物",
      },
    ]);
  };

  const addMeetingZone = () => {
    setMeetingZones((prev) => [
      ...prev,
      {
        id: randomItemId("meeting"),
        x: 100,
        y: 100,
        width: NEW_ITEM_SIZE * 2,
        height: NEW_ITEM_SIZE * 2,
        label: "ミーティングエリア",
      },
    ]);
  };

  const removeObstacle = (id: string) =>
    setObstacles((prev) => prev.filter((o) => o.id !== id));
  const removeMeetingZone = (id: string) =>
    setMeetingZones((prev) => prev.filter((z) => z.id !== id));

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      await updateTemplateLayout(template.id, obstacles, meetingZones);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
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
      await renameTemplate(template.id, trimmed);
      setName(trimmed);
      setEditingName(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "テンプレート名の変更に失敗しました");
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
      await replaceTemplateImage(template.id, url);
      setBackgroundImageUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "画像の変更に失敗しました");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        {editingName ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              className="rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
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
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-slate-800">{name}</p>
            <button
              onClick={() => setEditingName(true)}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              名前変更
            </button>
          </div>
        )}
        <button
          onClick={onClose}
          className="text-xs text-slate-500 hover:text-slate-800"
        >
          閉じる
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
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
        <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          {uploading ? "アップロード中..." : "背景画像を変更"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageChange}
            disabled={uploading}
          />
        </label>
        <button
          onClick={handleSave}
          disabled={saving}
          className="ml-auto rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          {saving ? "保存中..." : "レイアウトを保存"}
        </button>
      </div>

      <div ref={measureRef} className="w-full" style={{ maxWidth: MAX_DISPLAY_WIDTH }}>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">
            拡大 {Math.round(zoom * 100)}%
          </span>
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
            className="w-28"
          />
          <button
            onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.5) * 100) / 100))}
            disabled={zoom >= 3}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            ＋
          </button>
          {zoom !== 1 && (
            <button
              onClick={() => setZoom(1)}
              className="text-xs text-slate-500 underline hover:text-slate-800"
            >
              リセット
            </button>
          )}
        </div>

        <div
          className="relative touch-none overflow-auto rounded-lg border border-slate-300 bg-slate-700"
          style={{ width: baseSize, height: baseSize }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <div
            className="relative"
            style={{
              width: renderedSize,
              height: renderedSize,
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
                className="absolute cursor-move rounded-xl border border-slate-300 bg-slate-500/50 p-2"
                style={{
                  left: zone.x * scale,
                  top: zone.y * scale,
                  width: zone.width * scale,
                  height: zone.height * scale,
                }}
              >
                <span className="text-xs text-white">{zone.label}</span>
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
          </div>
        </div>
      </div>
    </div>
  );
}
