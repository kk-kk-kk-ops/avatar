import { CONTAINER, LP_LINKS, RedButton, SectionLabel } from './lp-ui';

/**
 * 「主な機能」セクション(デザインカンプ準拠)
 * 左:見出しと説明文 / 右:灰色の丸アイコン4つ(少しずらした配置)
 */

const W = { stroke: '#fff', strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const ICONS = {
  voice: (
    <svg viewBox="0 0 64 48" aria-hidden="true" className="h-full w-full">
      <path {...W} d="M6 18h8l14-10v32L14 30H6z" />
      <path {...W} d="M36 14v20M42 10v28M48 14v20M54 8v32" />
    </svg>
  ),
  video: (
    <svg viewBox="0 0 64 48" aria-hidden="true" className="h-full w-full">
      <rect {...W} x="8" y="6" width="38" height="26" rx="2" />
      <path {...W} d="M4 36h36" />
      <rect {...W} x="42" y="16" width="16" height="28" rx="3" />
      <path {...W} d="M48 40h4" />
    </svg>
  ),
  share: (
    <svg viewBox="0 0 64 48" aria-hidden="true" className="h-full w-full">
      <rect {...W} x="6" y="4" width="52" height="34" rx="2" />
      <path {...W} d="M24 4v34M6 21h18M32 44h0M26 38v6h12v-6M22 44h20" />
      <circle {...W} cx="15" cy="10" r="2.6" />
      <path {...W} d="M10 18c0-3 2.4-4.6 5-4.6s5 1.6 5 4.6" />
      <circle {...W} cx="15" cy="27" r="2.6" />
      <path {...W} d="M10 35c0-3 2.4-4.6 5-4.6s5 1.6 5 4.6" />
      <circle {...W} cx="41" cy="16" r="5" />
      <path {...W} d="M31 34c0-6 4.6-9 10-9s10 3 10 9" />
    </svg>
  ),
  chat: (
    <svg viewBox="0 0 64 48" aria-hidden="true" className="h-full w-full">
      <path {...W} d="M28 6c-8.8 0-16 5.6-16 12.6 0 3.6 1.9 6.8 5 9.1L14 35l8.2-4.2c1.8.4 3.8.6 5.8.6" />
      <ellipse {...W} cx="40" cy="28" rx="14" ry="12" />
      <path {...W} d="M48 38l4 8-9-5" />
      <path {...W} d="M34 28h.01M40 28h.01M46 28h.01" strokeWidth={3} />
    </svg>
  ),
};

/** 丸の位置(% は右側の配置エリア 368×355 に対する割合) */
const FEATURES = [
  { key: 'voice', label: '音声通話', left: '2%', top: '0%' },
  { key: 'video', label: 'ビデオ通話', left: '52.4%', top: '0%' },
  { key: 'share', label: '画面共有', left: '0%', top: '54.9%' },
  { key: 'chat', label: 'チャット', left: '56.5%', top: '54.9%' },
] as const;

function Circle({ icon, label, className = '', style }: { icon: React.ReactNode; label: string; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`flex aspect-square flex-col items-center justify-center rounded-full bg-[#828282] ${className}`}
      style={style}
    >
      <span className="block h-[34%] w-[46%]">{icon}</span>
      <span className="mt-[6%] text-[clamp(0.75rem,1vw,0.9rem)] font-medium tracking-wider text-white">{label}</span>
    </div>
  );
}

export function MainFeatures() {
  return (
    <section aria-labelledby="features-title">
      <div className={`${CONTAINER} pb-20 pt-20 lg:pb-[90px] lg:pt-[150px]`}>
        <SectionLabel>主な機能</SectionLabel>

        <div className="mt-8 grid items-center gap-12 lg:mt-[60px] lg:grid-cols-[minmax(0,1fr)_368px] lg:gap-16 xl:grid-cols-[minmax(0,1fr)_368px_100px]">
          <div>
            <h2 id="features-title" className="text-[clamp(1.75rem,3.2vw,2.875rem)] font-bold leading-[1.55] text-[#111]">
              入った瞬間から、
              <br />
              どこで何をするかがわかる。
            </h2>
            <p className="mt-8 max-w-[500px] text-[clamp(1rem,1.3vw,1.2rem)] leading-[1.9] text-[#222] lg:mt-[50px]">
              部屋に入れば、会議室やもくもく作業スペースがひと目でわかる配置。
              <br />
              話したいときは会議室へ、集中したいときは作業部屋へ。はじめての人でも迷いません。
            </p>
          </div>

          {/* PC:カンプどおり少しずらした配置 */}
          <div className="relative mx-auto hidden aspect-[368/355] w-full max-w-[368px] lg:block">
            {FEATURES.map((f) => (
              <Circle key={f.key} icon={ICONS[f.key]} label={f.label} className="absolute w-[43.5%]" style={{ left: f.left, top: f.top }} />
            ))}
          </div>

          {/* スマホ・タブレット:2×2 */}
          <ul className="mx-auto grid w-full max-w-[340px] grid-cols-2 gap-5 lg:hidden">
            {FEATURES.map((f) => (
              <li key={f.key}>
                <Circle icon={ICONS[f.key]} label={f.label} />
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-16 lg:mt-[130px]">
          <RedButton href={LP_LINKS.features}>機能を詳しく見る</RedButton>
        </div>
      </div>
    </section>
  );
}
