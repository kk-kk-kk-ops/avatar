import { CONTAINER } from './lp-ui';

/**
 * 「こんなお悩みありませんか?」セクション(デザインカンプ準拠)
 * 1280px 以上:中央のキャラクターを4つの吹き出しが囲む配置(カンプどおり)
 * それ未満:吹き出しを縦(タブレットは2列)に並べ、最後にキャラクター
 */

type Bubble = {
  title: React.ReactNode;
  text: React.ReactNode;
  /** 吹き出しのしっぽの位置(キャラクターのいる側) */
  tail: 'left' | 'right';
  /** 1280px 以上での位置(% は吹き出しエリア 1264×575 に対する割合) */
  pos: { left: string; top: string };
};

const BUBBLES: Bubble[] = [
  {
    title: '返事待ちで、仕事が止まる',
    text: 'すぐ確認したいことがあっても、チャットの返事はいつ来るかわからない。',
    tail: 'right',
    pos: { left: '11.2%', top: '0%' },
  },
  {
    title: 'チームの様子が見えない。',
    text: (
      <>
        誰が働いていて、誰が忙しそうなのか。
        <br />
        リモートではわからない。
      </>
    ),
    tail: 'left',
    pos: { left: '55.2%', top: '0%' },
  },
  {
    title: 'ひとりで働いていると、孤独を感じる',
    text: '一日誰とも話さずに終わる日もある。',
    tail: 'right',
    pos: { left: '0%', top: '53.9%' },
  },
  {
    title: (
      <>
        少人数のチームに、
        <br />
        ちょうど良いツールがない
      </>
    ),
    text: '機能が多すぎたり、料金が大人数向けだったり。',
    tail: 'left',
    pos: { left: '69.9%', top: '53.9%' },
  },
];

function SpeechBubble({ b, className = 'relative', style }: { b: Bubble; className?: string; style?: React.CSSProperties }) {
  // className には位置の指定(relative か absolute)を必ず含める
  return (
    <div className={className} style={style}>
      <div className="relative z-10 rounded-[6px] border-2 border-[#222] bg-white px-6 pb-7 pt-6 xl:min-h-[170px]">
        <p className="text-[clamp(1.1rem,1.55vw,1.4rem)] font-medium leading-[1.55] text-[#222]">{b.title}</p>
        <p className="mt-2 text-[clamp(0.85rem,1.05vw,0.95rem)] leading-[1.75] text-[#444]">{b.text}</p>
      </div>
      {/* しっぽ(白で枠の線を消し、斜めの線だけ見せる) */}
      <svg
        aria-hidden="true"
        viewBox="0 0 48 26"
        className={`absolute -bottom-[22px] z-20 h-[26px] w-[48px] ${b.tail === 'right' ? 'right-[8%]' : 'left-[8%] -scale-x-100'}`}
      >
        <path d="M4 3 L40 24 L28 3" fill="#fff" stroke="#222" strokeWidth="2" strokeLinejoin="round" />
        <rect x="5" y="0" width="22" height="4.5" fill="#fff" />
      </svg>
    </div>
  );
}

export function PainPoints() {
  return (
    <section aria-labelledby="pain-title" className="bg-[#FDF3F2]">
      <div className={`${CONTAINER} pb-24 pt-16 lg:pb-[140px] lg:pt-[110px]`}>
        <h2 id="pain-title" className="text-center text-[clamp(1.6rem,3.2vw,2.875rem)] font-bold text-[#111]">
          こんなお悩みありませんか?
        </h2>

        {/* 1280px 以上:カンプどおりの配置 */}
        <div className="relative mt-[90px] hidden aspect-[1264/575] w-full xl:block">
          {BUBBLES.map((b, i) => (
            <SpeechBubble key={i} b={b} className="absolute w-[30.3%]" style={b.pos} />
          ))}
          <img
            src="/lp/top/pain-character.png"
            alt=""
            aria-hidden="true"
            width={620}
            height={670}
            className="absolute"
            style={{ left: '37%', top: '45.2%', width: '22.5%' }}
          />
        </div>

        {/* 1280px 未満:縦並び */}
        <div className="mt-12 xl:hidden">
          <ul className="grid gap-x-8 gap-y-12 sm:grid-cols-2">
            {BUBBLES.map((b, i) => (
              <li key={i}>
                <SpeechBubble b={b} />
              </li>
            ))}
          </ul>
          <img
            src="/lp/top/pain-character.png"
            alt=""
            aria-hidden="true"
            width={620}
            height={670}
            className="mx-auto mt-12 w-[180px] sm:w-[220px]"
          />
        </div>
      </div>
    </section>
  );
}
