"use client";

type Props = {
  onPress: (key: string) => void;
  onRelease: (key: string) => void;
};

export default function TouchControls({ onPress, onRelease }: Props) {
  const btnClass =
    "flex h-14 w-14 items-center justify-center rounded-full bg-white/25 text-xl font-bold text-white backdrop-blur-sm select-none active:bg-white/50";

  // ボタンごとに対応するキーをkeysDownに追加/削除するイベントをまとめて生成
  const bind = (key: string) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      (e.target as HTMLButtonElement).setPointerCapture(e.pointerId);
      onPress(key);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      onRelease(key);
    },
    onPointerCancel: () => onRelease(key),
    onPointerLeave: () => onRelease(key),
  });

  return (
    <div
      className="fixed bottom-24 left-4 z-50 grid grid-cols-3 grid-rows-3 gap-1 sm:hidden"
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
