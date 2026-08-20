"use client";

import { useEffect, useRef } from "react";

type Props = {
  onPress: (key: string) => void;
  onRelease: (key: string) => void;
};

export default function TouchControls({ onPress, onRelease }: Props) {
  const btnClass =
    "flex h-14 w-14 items-center justify-center rounded-full bg-white/25 text-xl font-bold text-white backdrop-blur-sm select-none active:bg-white/50";

  const containerRef = useRef<HTMLDivElement>(null);

  // どのpointerIdがどのキーを押しているかを記録しておく(ボタンをまたいで
  // スライドした際、直前のキーだけを解放して新しいキーを押すために使う)。
  const activePointers = useRef<Map<number, string>>(new Map());
  // どのpointerIdがこのパッド上でpointerdownしたかを記録する。パッド全体で
  // pointerCaptureしているため、ボタンをまたいでスライドしても
  // onPointerMoveはこのコンポーネントに届き続ける。
  const trackedPointers = useRef<Set<number>>(new Set());

  // window全体のpointerup/pointercancelを保険として監視し、ボタン側の
  // イベントが漏れても必ずキーを解放できるようにする(iOS Safari等で
  // pointerup/cancelが確実に発火しないことがあり、それが起きるとキーが
  // 押しっぱなしのままアバターが操作不能なまま動き続けてしまうため)。
  useEffect(() => {
    const releaseByPointerId = (e: PointerEvent) => {
      trackedPointers.current.delete(e.pointerId);
      const key = activePointers.current.get(e.pointerId);
      if (key) {
        activePointers.current.delete(e.pointerId);
        onRelease(key);
      }
    };
    // タブの切り替え・アプリのバックグラウンド化などでpointerup自体が
    // 届かないケースに備え、押しっぱなしを全解除する保険も用意する。
    const releaseAll = () => {
      activePointers.current.forEach((key) => onRelease(key));
      activePointers.current.clear();
      trackedPointers.current.clear();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") releaseAll();
    };
    window.addEventListener("pointerup", releaseByPointerId);
    window.addEventListener("pointercancel", releaseByPointerId);
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pointerup", releaseByPointerId);
      window.removeEventListener("pointercancel", releaseByPointerId);
      window.removeEventListener("blur", releaseAll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [onRelease]);

  // 指定座標が矢印ボタンの上にあればそのキーを、パッド内だが隙間・中央に
  // あればnullを、パッド自体の外であればnullを返す(どちらもnullで区別しない
  // ことで「ボタン間の隙間を通過中」と「パッド外に出た」の両方で移動が
  // 一旦止まり、新しいボタンに触れた瞬間だけ再度押下扱いになる)。
  const keyAtPoint = (x: number, y: number): string | null => {
    const container = containerRef.current;
    if (!container) return null;
    const el = document.elementFromPoint(x, y);
    if (!el || !container.contains(el)) return null;
    const btn = el.closest<HTMLElement>("[data-touch-key]");
    return btn?.dataset.touchKey ?? null;
  };

  const updateDirection = (pointerId: number, x: number, y: number) => {
    const key = keyAtPoint(x, y);
    const prevKey = activePointers.current.get(pointerId) ?? null;
    if (key === prevKey) return;
    if (prevKey) {
      activePointers.current.delete(pointerId);
      onRelease(prevKey);
    }
    if (key) {
      activePointers.current.set(pointerId, key);
      onPress(key);
    }
  };

  const releaseTracked = (pointerId: number) => {
    trackedPointers.current.delete(pointerId);
    const key = activePointers.current.get(pointerId);
    if (key) {
      activePointers.current.delete(pointerId);
      onRelease(key);
    }
  };

  // pointerdown/move/up/cancelをパッド全体(親要素)でまとめて処理する。
  // ボタン個別にpointerCaptureすると、そのボタンの領域に指が固定されて
  // しまい隣のボタンへスライドしても検知できないため、パッド全体で
  // captureしてelementFromPointで現在触れているボタンを毎回判定し直す
  // 方式に変更した(長押し中に指を離さず方向転換できるようにするため)。
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    trackedPointers.current.add(e.pointerId);
    updateDirection(e.pointerId, e.clientX, e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!trackedPointers.current.has(e.pointerId)) return;
    updateDirection(e.pointerId, e.clientX, e.clientY);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    releaseTracked(e.pointerId);
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    releaseTracked(e.pointerId);
  };

  return (
    <div
      ref={containerRef}
      className="fixed bottom-8 right-8 z-50 grid grid-cols-3 grid-rows-3 gap-0 sm:hidden"
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div />
      <button
        data-touch-key="arrowup"
        className={`${btnClass} col-start-2 row-start-1`}
      >
        ↑
      </button>
      <div />

      <button
        data-touch-key="arrowleft"
        className={`${btnClass} col-start-1 row-start-2`}
      >
        ←
      </button>
      <div className="col-start-2 row-start-2" />
      <button
        data-touch-key="arrowright"
        className={`${btnClass} col-start-3 row-start-2`}
      >
        →
      </button>

      <div />
      <button
        data-touch-key="arrowdown"
        className={`${btnClass} col-start-2 row-start-3`}
      >
        ↓
      </button>
      <div />
    </div>
  );
}
