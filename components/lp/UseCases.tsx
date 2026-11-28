import { CONTAINER, SectionLabel, SectionTitle } from './lp-ui';

/**
 * 「利用シーン」セクション(デザインカンプ準拠)
 * 1280px 以上:中央の街のイラストを4枚のカードが四隅から囲む配置
 * それ未満:イラスト → カード(タブレットは2列)
 */

const CARD_BG = '#CC8E8E';

const S = { stroke: '#fff', strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const ICONS = {
  company: (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="h-full w-full">
      <path {...S} d="M7 28V4h18v24M4 28h24" />
      <path {...S} d="M11 9h3M18 9h3M11 14h3M18 14h3M11 19h3M18 19h3M14 28v-4h4v4" />
    </svg>
  ),
  freelance: (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="h-full w-full">
      <rect {...S} x="6" y="6" width="20" height="14" rx="1.5" />
      <path {...S} d="M3 24h26l-2 3H5z M9 9h14" />
    </svg>
  ),
  community: (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="h-full w-full">
      <circle {...S} cx="16" cy="9" r="3.2" />
      <circle {...S} cx="7" cy="12" r="2.6" />
      <circle {...S} cx="25" cy="12" r="2.6" />
      <path {...S} d="M10 26v-4.5c0-3.6 2.7-6 6-6s6 2.4 6 6V26M3 25v-3c0-2.6 1.8-4.4 4.2-4.4M29 25v-3c0-2.6-1.8-4.4-4.2-4.4" />
    </svg>
  ),
  education: (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="h-full w-full">
      <path {...S} d="M2 12 16 6l14 6-14 6z" />
      <path {...S} d="M8 15v6c0 2 3.6 4 8 4s8-2 8-4v-6M27 13v8" />
      <path d="M25.5 21h3l.6 4h-4.2z" fill="#fff" />
    </svg>
  ),
};

type UseCase = {
  key: keyof typeof ICONS;
  catch: string;
  title: string;
  text: string;
  /** 1280px 以上での位置(配置エリア 1264×660 に対する割合) */
  pos: React.CSSProperties;
};

const CASES: UseCase[] = [
  {
    key: 'company',
    catch: '離れた場所でも、ひとつのチームで。',
    title: '会社・チーム',
    text: '部署や拠点が離れていても、同じ空間にいるようにスムーズにコミュニケーションできます。',
    pos: { left: 0, top: 0 },
  },
  {
    key: 'freelance',
    catch: 'ひとりでも、つながる安心感',
    title: 'フリーランス',
    text: '自宅やカフェから気軽に参加。仕事に集中しながら、必要なときに仲間と話せる環境が手に入ります。',
    pos: { right: 0, top: 0 },
  },
  {
    key: 'community',
    catch: '同じ興味でつながり、学び合える。',
    title: 'コミュニティ',
    text: '共通のテーマや目的で集まり、情報交換やイベントを通して新しいつながりが生まれます。',
    pos: { left: 0, bottom: 0 },
  },
  {
    key: 'education',
    catch: '学びを深め、成長を加速する。',
    title: '教育',
    text: 'オンライン講座やグループワーク、メンバー限定のイベントなど、目的に合わせた学びの場を作れます。',
    pos: { right: 0, bottom: 0 },
  },
];

function Card({ c, className = '', style }: { c: UseCase; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={className} style={style}>
      <p className="text-center text-[clamp(0.75rem,0.95vw,0.9rem)] tracking-wide" style={{ color: CARD_BG }}>
        ＼{c.catch}／
      </p>
      <div className="mt-1 rounded-[14px] px-7 pb-6 pt-5 text-white lg:px-[50px]" style={{ backgroundColor: CARD_BG }}>
        <h3 className="flex items-center gap-3 text-[clamp(1.35rem,2vw,1.75rem)] font-medium">
          <span className="block h-[1.15em] w-[1.15em] shrink-0">{ICONS[c.key]}</span>
          {c.title}
        </h3>
        <p className="mt-2 text-[clamp(0.85rem,1.05vw,0.95rem)] leading-[1.85]">{c.text}</p>
      </div>
    </div>
  );
}

export function UseCases() {
  return (
    <section aria-labelledby="usecases-title">
      <div className={`${CONTAINER} pb-20 pt-20 lg:pb-[150px] lg:pt-[90px]`}>
        <SectionLabel>利用シーン</SectionLabel>
        <div className="mt-6 lg:mt-[36px]">
          <SectionTitle>
            <span id="usecases-title">チームのかたちに合わせて</span>
          </SectionTitle>
        </div>

        {/* 1280px 以上:カンプどおりの配置。中央のイラストは最前面(z-20)に
            し、カードの上に重なっても隠れないようにしている(カードは
            z-10のまま、四隅 0%/100% 固定)。大きさはFigmaの実寸
            476×318px(1264×660pxの配置エリアに対する比率、ユーザー
            指示・2026-11-28)。 */}
        <div className="relative mt-[60px] hidden aspect-[1264/660] w-full xl:block">
          {CASES.map((c) => (
            <Card key={c.key} c={c} className="absolute z-10 w-[35.8%]" style={c.pos} />
          ))}
          <img
            src="/lp/top/usecase-town.png"
            alt="会議室・作業スペース・休憩スペースが広場を囲む街のイラスト"
            width={952}
            height={636}
            className="absolute z-20"
            style={{ left: '29.1%', top: '20%', width: '37.7%' }}
          />
        </div>

        {/* 1280px 未満 */}
        <div className="mt-10 xl:hidden">
          <img
            src="/lp/top/usecase-town.png"
            alt="会議室・作業スペース・休憩スペースが広場を囲む街のイラスト"
            width={952}
            height={636}
            className="mx-auto w-full max-w-[480px]"
          />
          <ul className="mt-10 grid gap-8 sm:grid-cols-2">
            {CASES.map((c) => (
              <li key={c.key}>
                <Card c={c} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
