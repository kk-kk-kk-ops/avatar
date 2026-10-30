import Link from 'next/link';
import { SITE } from '@/lib/site-info';

/** デザインカンプの赤 */
const RED = '#D80003';

/**
 * 右側のイラスト（オフィスの見取り図＋キャラクター＋ステータスの吹き出し）
 * 750×530 の箱を基準に、各パーツを % で配置しています（PC・スマホ共通）
 */
function OfficeIllustration() {
  const parts = [
    { src: '/lp/status-woman.png', w: 416, h: 174, left: 22.4, top: 22.8, width: 26.5 },
    { src: '/lp/status-man.png', w: 396, h: 180, left: 48.4, top: 38.5, width: 25 },
    { src: '/lp/char-goo.png', w: 546, h: 364, left: 60, top: 2.6, width: 34.7 },
    { src: '/lp/char-tora.png', w: 470, h: 246, left: 2.3, top: 75.8, width: 30 },
    { src: '/lp/char-gorira.png', w: 450, h: 246, left: 68.7, top: 66.8, width: 28.7 },
  ];
  return (
    <div className="relative aspect-[750/530] w-full">
      <img
        src="/lp/room.png"
        alt="Globyのオンラインオフィスの画面イメージ。会議室や執務スペースにメンバーが集まっている様子"
        width={696}
        height={452}
        className="absolute left-[4.5%] top-[9.4%] w-[92.8%]"
      />
      {parts.map((p) => (
        <img
          key={p.src}
          src={p.src}
          alt=""
          aria-hidden="true"
          width={p.w}
          height={p.h}
          className="absolute"
          style={{ left: `${p.left}%`, top: `${p.top}%`, width: `${p.width}%` }}
        />
      ))}
    </div>
  );
}

/**
 * ファーストビュー（デザインカンプ準拠）
 * PC（1024px以上）は 1440×960（リボン画像の高さ）を基準に、画面幅に合わせて全体を拡大縮小します。
 * スマホは「コピー → ボタン → イラスト」の縦並びです。
 */
export function HeroFirstView() {
  return (
    <section className="relative overflow-hidden bg-white">
      <div className="relative mx-auto w-full max-w-[1440px] px-5 pb-14 pt-10 lg:aspect-[1440/960] lg:p-0">
        {/* 背景の装飾（背景画像（リボン＋透かし文字）・スクロール） */}
        <img src="/lp/fvback.png" alt="" aria-hidden="true" width={1440} height={960}
          className="pointer-events-none absolute left-0 top-[38%] w-[170%] max-w-none select-none opacity-70 lg:top-0 lg:w-full lg:opacity-100" />
        <img src="/lp/scroll.png" alt="" aria-hidden="true" width={174} height={271}
          className="pointer-events-none absolute hidden select-none lg:left-[46.7%] lg:top-[72.9%] lg:block lg:w-[6.1%]" />

        <div className="relative grid gap-10 lg:static lg:block">
          {/* コピーとボタン */}
          <div className="relative lg:absolute lg:left-[4.6%] lg:top-[14.5%] lg:w-[46%]">
            <h1 className="text-[clamp(1.6rem,7.6vw,2.25rem)] lg:text-[clamp(2rem,3.95vw,3.55rem)] font-black leading-[1.35] text-[#111] lg:whitespace-nowrap">
              オンラインに、
              <br />
              もう一つの<span style={{ color: RED }}>オフィス</span>を。
            </h1>
            <p className="mt-5 text-[clamp(1.05rem,2.05vw,1.85rem)] font-bold leading-[1.8] text-[#222] lg:mt-[min(2.6vw,37px)] lg:whitespace-nowrap">
              アバターで集まり、話し、つながる。
              <br />
              仲間と集まれるオンライン空間「{SITE.serviceName}」
            </p>
            <div className="mt-8 w-full max-w-[570px] lg:mt-[min(3.75vw,54px)] lg:w-[86%]">
              <Link
                href={SITE.signupPath}
                className="group flex h-[clamp(3.5rem,5.7vw,5.1rem)] w-full items-center justify-center gap-4 rounded-full text-[clamp(1.05rem,1.6vw,1.45rem)] font-bold text-white shadow-[0_8px_20px_rgba(216,0,3,0.25)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
                style={{ backgroundColor: RED, outlineColor: RED }}
              >
                無料で始める
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[1.1em] w-[1.1em] transition-transform group-hover:translate-x-1 motion-reduce:transition-none" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </Link>
              <p className="mt-3 text-center text-[clamp(0.75rem,1.05vw,0.95rem)] font-bold text-[#555]">
                ブラウザですぐ使えます・アプリのインストール不要
              </p>
            </div>
          </div>

          {/* イラスト */}
          <div className="relative mx-auto w-full max-w-[560px] lg:absolute lg:left-[45.8%] lg:top-[10.4%] lg:mx-0 lg:w-[52.1%] lg:max-w-none">
            <OfficeIllustration />
          </div>
        </div>
      </div>
    </section>
  );
}
