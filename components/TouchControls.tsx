"use client";

import { useEffect, useRef } from "react";

type Props = {
  onPress: (key: string) => void;
  onRelease: (key: string) => void;
};

export default function TouchControls({ onPress, onRelease }: Props) {
  const btnClass =
    "flex h-14 w-14 items-center justify-center rounded-full bg-white/25 text-xl font-bold text-white backdrop-blur-sm select-none active:bg-white/50";

  // どのpointerIdがどのキーを押しているかを記録しておく。ボタン自体の
  // onPointerUp/onPointerCancelがモバイル端末(特にiOS Safari)で
  // 確実に発火しないことがあり、それが起きるとキーが押しっぱなしの
  // まま残ってアバターが操作不能なまま動き続けてしまう(SP版で「何も
  // 押していないのに勝手に左上へ動き続ける」不具合の原因)。
  // window全体のpointerup/pointercancelを保険として監視し、ボタン側の
  // イベントが漏れても必ずキーを解放できるようにする。
  const activePointers = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    const releaseByPointerId = (e: PointerEvent) => {
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

  // ボタンごとに対応するキーをkeysDownに追加/削除するイベントをまとめて生成
  const bind = (key: string) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      (e.target as HTMLButtonElement).setPointerCapture(e.pointerId);
      activePointers.current.set(e.pointerId, key);
      onPress(key);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      activePointers.current.delete(e.pointerId);
      onRelease(key);
    },
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => {
      activePointers.current.delete(e.pointerId);
      onRelease(key);
    },
    onPointerLeave: (e: React.PointerEvent<HTMLButtonElement>) => {
      activePointers.current.delete(e.pointerId);
      onRelease(key);
    },
  });

  return (
    <div
      className="fixed bottom-[10px] right-8 z-50 grid grid-cols-3 grid-rows-3 gap-0 sm:hidden"
      style={{ touchAction: "none" }}
    >
      <div />
      <button {...bind("arrowup")} className={`${btnClass} col-start-2 row-start-1`}>
        ↑
      </button>
      <div />

      <button {...bind("arrowleft")} className={`${btnClass} col-start-1 row-start-2`}>
        ←
      </button>
      <div className="col-start-2 row-start-2" />
      <button {...bind("arrowright")} className={`${btnClass} col-start-3 row-start-2`}>
        →
      </button>

      <div />
      <button {...bind("arrowdown")} className={`${btnClass} col-start-2 row-start-3`}>
        ↓
      </button>
      <div />
    </div>
  );
}
