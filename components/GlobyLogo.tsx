// 入室の仕組みの作り替え 段階E-5-1の見直し(2026-11-24)。会議室の中の
// ヘッダー(components/AvatarSpace.tsx)と、入室前の画面・ルーム0件の
// 画面の両方で使う、ロゴ部分(白い丸+アイコン画像+「Globy」の文字)の
// 共有部品。会議室の中の見た目は変えない(元のJSXをそのまま切り出した
// だけ)。
export default function GlobyLogo() {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Globy" className="h-5 w-5 object-contain" />
      </div>
      <span className="hidden text-sm font-semibold text-white sm:inline">
        Globy
      </span>
    </div>
  );
}
