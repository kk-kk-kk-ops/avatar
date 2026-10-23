/**
 * 「Globyとは」セクション（デザインカンプ準拠）
 * カンプ（1440px幅）の寸法をそのまま使っています。画像は 2 倍サイズで書き出されたものを半分の大きさで表示。
 * PC：左にテキスト・右にオフィス画像、下に特徴 5 つを横並び
 * タブレット：特徴は 3 列 / スマホ：縦並び・特徴は 2 列
 */

const FEATURES = [
  // icon：アイコン画像の幅を、丸い背景（384px）に対する割合（%）で指定
  { icon: '/lp/about/globytowa_hanasu.png', w: 220, h: 220, title: '気軽に話せる', text: ['近くに行くだけで', 'すぐに会話が始められます'] },
  { icon: '/lp/about/globytowa_shizen.png', w: 214, h: 158, title: '自然に集まれる', text: ['同じ空間で働くことでチームのつながりが生まれます'] },
  { icon: '/lp/about/globytowa_sanka.png', w: 242, h: 204, title: 'どこからでも参加', text: ['場所を選ばず同じ空間で働けます'] },
  { icon: '/lp/about/globytowa_kaigi.png', w: 220, h: 196, title: '会議もスムーズ', text: ['会議室に集まってすぐにミーティングができます'] },
  { icon: '/lp/about/globytowa_zatsudan.png', w: 220, h: 220, title: '雑談も楽しめる', text: ['仕事の合間にリラックスした交流も'] },
];

export function AboutGloby() {
  return (
    <section id="about" className="bg-white">
      <div className="mx-auto w-full max-w-[1440px] px-5 py-16 sm:px-10 lg:px-[160px] lg:pb-[120px] lg:pt-[80px]">
        {/* 上段：テキスト＋画像 */}
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,494px)_minmax(0,561px)] lg:justify-between lg:gap-8">
          <div>
            <p className="text-[clamp(0.95rem,1.25vw,1.125rem)] font-medium text-[#111]">Globyとは</p>
            <h2 className="mt-6 text-[clamp(1.75rem,3.2vw,2.875rem)] font-bold leading-[1.55] text-[#111] lg:mt-[56px]">
              会議も、雑談も。
              <br />
              みんなが集まる場所。
            </h2>
            <p className="mt-6 text-[clamp(1rem,1.3vw,1.2rem)] leading-[1.8] text-[#222] lg:mt-[40px]">
              Globyは、一緒に働くメンバーがアバターを選んで、ひとつのオンライン空間に集まるサービスです。
              <br />
              誰がどこにいるのかがひと目でわかり、話したい相手のそばに行けば、そのまま会話が始まります。
            </p>
          </div>
          <img
            src="/lp/about/globytowa_room.png"
            alt="Globyのオンラインオフィスを上から見た画面イメージ。会議室・執務スペース・休憩スペースが並んでいる"
            width={1118}
            height={744}
            className="mx-auto w-full max-w-[561px] lg:mx-0 lg:mt-[12px]"
          />
        </div>

        {/* 下段：特徴 5 つ */}
        <ul className="mt-14 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:mt-[56px] lg:grid-cols-5 lg:gap-x-6">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex flex-col items-center text-center">
              {/* 丸い背景（globytowa_backimg）の中央にアイコンを重ねる */}
              <div className="relative w-full max-w-[192px]">
                <img src="/lp/about/globytowa_backimg.png" alt="" aria-hidden="true" width={384} height={374} className="block w-full" />
                <img
                  src={f.icon}
                  alt=""
                  aria-hidden="true"
                  width={f.w}
                  height={f.h}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                  style={{ width: `${(f.w / 384) * 100}%` }}
                />
              </div>
              <h3 className="mt-5 text-[clamp(1.05rem,1.55vw,1.4rem)] font-medium text-[#111] lg:mt-[24px]">{f.title}</h3>
              <p className="mt-2 max-w-[200px] text-[clamp(0.8rem,1.05vw,0.95rem)] leading-[1.7] text-[#333]">
                {f.text.map((line, i) => (
                  <span key={i}>
                    {i > 0 && <br />}
                    {line}
                  </span>
                ))}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
