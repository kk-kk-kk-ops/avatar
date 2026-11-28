// 入室の仕組みの作り替え 段階E-5-1の見直し(2026-11-24)。会議室の中の
// ヘッダー(components/AvatarSpace.tsx)と、入室前の画面・ルーム0件の
// 画面の両方で使う、ロゴ部分の共有部品。
// 2026-11-28変更: ホームページ(/lp)と同じロゴ(/lp/logo-globy.png、
// 「Globy」のワードマーク)に統一。SP(画面が狭い時)は横に長いワードマーク
// だと窮屈なため、今回のSEO対応で作成した「G」マークのみの画像
// (public/icon-g.png。app/icon.pngと同じ内容)を、白い丸の背景の上に表示する
// (以前の白丸+アイコンの見た目を踏襲)。
// 2026-11-28追加修正: どちらのロゴも濃い色のマークのため、暗いヘッダーの
// 上では白い背景を敷かないと見えにくい。PCは四角い白背景+余白、SPは
// 丸の白背景を大きくして余白を増やした(アイコン自体の大きさは変えない)。
export default function GlobyLogo() {
  return (
    <div className="flex shrink-0 items-center">
      {/* SP:Gマークのみ。丸の白背景を大きくし、中のアイコンは同じ大きさの
          まま余白を増やしている */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white sm:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-g.png" alt="Globy" className="h-6 w-6 object-contain" />
      </div>
      {/* PC:ホームページと同じ「Globy」ロゴ。四角い白背景+余白を敷く */}
      <div className="hidden items-center rounded-md bg-white px-3 py-2 sm:flex">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/lp/logo-globy.png"
          alt="Globy"
          width={480}
          height={150}
          className="h-6 w-auto object-contain"
        />
      </div>
    </div>
  );
}
