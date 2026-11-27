import { CONTAINER, LP_LINKS, RedButton, SectionLabel, SectionTitle } from './lp-ui';

/**
 * LP 後半のセクション(デザインカンプ準拠)
 * - SoftBackdrop:「主な機能」からフッターまでの、ふんわりしたピンクの背景
 * - TrialCta:「まずは30日間〜」「さあ、もうひとつのオフィスへ。」(見出しだけ違う同じ形)
 * - HowToStart:「簡単3ステップで、すぐに始められます。」
 * - SecurityIntro:「安心してご利用いただくために」
 */

/** ふんわりしたピンクの背景(カンプのぼかしを CSS のグラデーションで再現) */
export function SoftBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative"
      style={{
        backgroundColor: '#FFFCFD',
        backgroundImage: [
          'radial-gradient(ellipse 38% 9% at 62% 22%, rgba(250,196,206,0.45), transparent 70%)',
          'radial-gradient(ellipse 30% 7% at 0% 42%, rgba(248,186,196,0.5), transparent 70%)',
          'radial-gradient(ellipse 34% 8% at 55% 58%, rgba(250,200,208,0.4), transparent 70%)',
          'radial-gradient(ellipse 30% 8% at 100% 68%, rgba(248,190,200,0.45), transparent 70%)',
          'radial-gradient(ellipse 34% 8% at 8% 80%, rgba(250,205,214,0.4), transparent 70%)',
          'radial-gradient(ellipse 32% 7% at 80% 90%, rgba(250,198,206,0.4), transparent 70%)',
        ].join(', '),
      }}
    >
      {children}
    </div>
  );
}

const TRIAL_TEXT = (
  <>
    ビデオ通話や画面共有もたっぷり使えるプランで、Globyの使い心地をチームで試してみてください。
    <br className="hidden md:inline" />
    体験のあとは、人数に合わせてプランを選べます。
  </>
);

export function TrialCta({ title, id }: { title: string; id: string }) {
  return (
    <section aria-labelledby={id}>
      <div className={`${CONTAINER} py-16 text-center lg:py-[80px]`}>
        <h2 id={id} className="text-[clamp(1.5rem,3.1vw,2.75rem)] font-bold leading-[1.5] text-[#111]">
          {title}
        </h2>
        <p className="mx-auto mt-6 max-w-[880px] text-[clamp(0.95rem,1.2vw,1.1rem)] leading-[1.9] text-[#222] lg:mt-[36px]">
          {TRIAL_TEXT}
        </p>
        <div className="mt-10 lg:mt-[56px]">
          <RedButton href={LP_LINKS.pricing}>料金プランを見る</RedButton>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { num: '01', title: '登録', text: 'メールアドレスで登録。', bg: '#FBEFEE' },
  { num: '02', title: '管理画面にログイン', text: '登録後、そのまま管理画面に入れます。', bg: '#FCE5E5' },
  { num: '03', title: '招待URLを送る', text: 'ボタンひとつで招待URLを発行。メンバーに送れば、すぐに集まれます。', bg: '#FFD2D2' },
];

export function HowToStart() {
  return (
    <section aria-labelledby="howto-title">
      <div className={`${CONTAINER} pb-16 pt-24 lg:pb-[100px] lg:pt-[200px]`}>
        <SectionLabel>はじめ方</SectionLabel>
        <div className="mt-6 lg:mt-[36px]">
          <SectionTitle>
            <span id="howto-title">簡単3ステップで、すぐに始められます。</span>
          </SectionTitle>
        </div>

        <ol className="mt-12 grid gap-4 lg:mt-[70px] lg:grid-cols-3 lg:gap-[16px]">
          {STEPS.map((s) => (
            <li
              key={s.num}
              className="rounded-[16px] px-6 pb-12 pt-5 [clip-path:polygon(0_0,100%_0,100%_calc(100%_-_26px),50%_100%,0_calc(100%_-_26px))] lg:min-h-[248px] lg:rounded-r-none lg:pb-8 lg:pr-[60px] lg:[clip-path:polygon(0_0,calc(100%_-_34px)_0,100%_50%,calc(100%_-_34px)_100%,0_100%)]"
              style={{ backgroundColor: s.bg }}
            >
              <span aria-hidden="true" className="block text-[clamp(2rem,3vw,2.6rem)] font-bold leading-none tracking-tight text-[#B8A3A3]">
                {s.num}
              </span>
              <h3 className="mt-4 text-[clamp(1.2rem,1.75vw,1.55rem)] font-medium text-[#222]">
                <span className="sr-only">ステップ{Number(s.num)}:</span>
                {s.title}
              </h3>
              <p className="mt-2 text-[clamp(0.85rem,1.05vw,0.95rem)] leading-[1.85] text-[#333]">{s.text}</p>
            </li>
          ))}
        </ol>

        <div className="mt-14 lg:mt-[76px]">
          <RedButton href={LP_LINKS.start}>今すぐ無料で始めてみる</RedButton>
        </div>
      </div>
    </section>
  );
}

export function SecurityIntro() {
  return (
    <section aria-labelledby="security-title">
      <div className={`${CONTAINER} pb-12 pt-24 lg:pb-[60px] lg:pt-[200px]`}>
        <SectionLabel>セキュリティ</SectionLabel>
        <div className="mt-6 lg:mt-[30px]">
          <SectionTitle>
            <span id="security-title">安心してご利用いただくために</span>
          </SectionTitle>
        </div>
        <p className="mt-6 text-[clamp(0.95rem,1.2vw,1.1rem)] leading-[1.9] text-[#222] lg:mt-[44px]">
          通信の暗号化、不正ログイン対策、管理者による入室管理など、安心して使える仕組みを整えています。
        </p>
        <div className="mt-12 lg:mt-[90px]">
          <RedButton href={LP_LINKS.security}>セキュリティ詳細を見る</RedButton>
        </div>
      </div>
    </section>
  );
}
