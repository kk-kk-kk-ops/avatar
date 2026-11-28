// 入室の仕組みの作り替え 段階E-5-1の見直し(2026-11-24)。会議室の中の
// ヘッダー(components/AvatarSpace.tsx)と、入室前の画面・ルーム0件の
// 画面の両方で使う、ロゴ部分の共有部品。
// 2026-11-28変更: 今回のSEO対応で作成した「G」マークのみの画像
// (public/icon-g.png。app/icon.pngと同じ内容)を、白い丸の背景の上に
// 表示する。当初PCだけ/lp/logo-globy.png(「Globy」のワードマーク)に
// 統一したが、ユーザー指示により「PC版もSP版と同じGのみのロゴ」に
// 変更し、PC/SPともこの丸ロゴに統一した(PCは少し大きく表示)。
export default function GlobyLogo() {
  return (
    <div className="flex shrink-0 items-center">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white sm:h-12 sm:w-12">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-g.png" alt="Globy" className="h-6 w-6 object-contain sm:h-7 sm:w-7" />
      </div>
    </div>
  );
}
