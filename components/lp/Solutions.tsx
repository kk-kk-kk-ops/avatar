import { CONTAINER, RED } from './lp-ui';

/**
 * 「Globyなら解決できます」セクション(デザインカンプ準拠)
 * 上の「お悩み」セクションのピンク地に、白い面が弧を描いて重なる形です。
 */

const ITEMS = [
  {
    img: '/lp/top/solution-talk.png',
    alt: 'アバター同士が近づいて会話している様子',
    title: 'そばに行けば、すぐ話せる',
    text: '相手のアバターに近づくだけで、会話を始められます。',
  },
  {
    img: '/lp/top/solution-overview.png',
    alt: 'オフィス全体にメンバーのアバターが並んでいる様子',
    title: 'みんなの様子がひと目でわかる。',
    text: 'オフィスを見渡すように、チームの状況を確認できます。',
  },
  {
    img: '/lp/top/solution-together.png',
    alt: '休憩スペースに複数のメンバーが集まっている様子',
    title: 'ひとりでも、仲間と一緒に働いている感覚に。',
    text: '同じ空間にみんながいるから、雑談も自然に生まれます。',
  },
  {
    img: '/lp/top/solution-simple.png',
    alt: 'マイク・カメラ・画面共有などのシンプルな操作ボタン',
    title: '少人数のチームに、ちょうどいいシンプルさと価格',
    text: '必要な機能に絞ったシンプル設計。月2,980円(税込)から使えます。',
  },
];

/** 見出し左右の赤い集中線 */
function Accent({ flip = false }: { flip?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 44" className={`h-[0.85em] w-auto shrink-0 ${flip ? '-scale-x-100' : ''}`}>
      <path d="M6 8 L24 30 L14 34 Z" fill={RED} />
      <path d="M26 2 L30 30 L22 30 Z" fill={RED} />
      <path d="M2 30 L22 36 L18 42 Z" fill={RED} />
    </svg>
  );
}

export function Solutions() {
  return (
    <section aria-labelledby="solutions-title" className="bg-[#FDF3F2]">
      <div className="rounded-t-[50%_60px] bg-white lg:rounded-t-[50%_110px]">
        <div className={`${CONTAINER} pb-24 pt-14 lg:pb-[150px] lg:pt-[50px]`}>
          <h2
            id="solutions-title"
            className="flex items-center justify-center gap-[0.5em] text-center text-[clamp(1.5rem,3vw,2.6rem)] font-bold text-[#111]"
          >
            <Accent />
            Globyなら解決できます
            <Accent flip />
          </h2>

          <ul className="mt-12 grid gap-x-12 gap-y-10 lg:mt-[110px] lg:grid-cols-2 lg:gap-y-[36px]">
            {ITEMS.map((it) => (
              <li key={it.title} className="flex items-start gap-5 lg:gap-6">
                <img
                  src={it.img}
                  alt={it.alt}
                  width={298}
                  height={224}
                  className="w-[120px] shrink-0 sm:w-[150px]"
                />
                <div className="pt-1 lg:pt-[18px]">
                  <h3 className="text-[clamp(1rem,1.3vw,1.15rem)] font-bold leading-[1.6] text-[#111]">{it.title}</h3>
                  <p className="mt-1.5 text-[clamp(0.85rem,1.05vw,0.95rem)] leading-[1.75] text-[#333]">{it.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
