import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome';
import { BILLING, BRAND, FEATURES, PLANS, SITE, TRIAL, yen } from '@/lib/site-info';

export const metadata: Metadata = {
  title: `${SITE.serviceName}｜リンクひとつで集まれる、オンラインの部屋`,
  description:
    'ビデオ会議、画面共有、チャットをひとつに。社外の人もリンクから参加できる、ブラウザで使えるオンラインの部屋です。',
};

/** ヒーローに置く「部屋」の見本。装飾なので読み上げ対象外 */
function RoomPreview() {
  const people = [
    { name: 'みなと', tone: 'bg-sky-200 text-sky-900' },
    { name: 'ひより', tone: 'bg-amber-200 text-amber-900' },
    { name: 'ゲスト', tone: 'bg-emerald-200 text-emerald-900' },
  ];
  return (
    <div aria-hidden="true" className="min-w-0 rounded-2xl bg-slate-800 p-3 shadow-2xl ring-1 ring-white/10">
      <div className="flex items-center justify-between px-2 pb-3 text-xs text-slate-400">
        <span>定例ミーティング</span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#E5342E]" />3人が参加中
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <div className="grid min-w-0 grid-cols-1 gap-3">
          <div className="flex aspect-video flex-col justify-between rounded-xl bg-white p-4">
            <div className="h-2 w-1/3 rounded bg-slate-300" />
            <div className="space-y-2">
              <div className="h-2 w-full rounded bg-slate-200" />
              <div className="h-2 w-4/5 rounded bg-slate-200" />
              <div className="h-2 w-3/5 rounded bg-[#F8B6B7]" />
            </div>
            <p className="text-[11px] text-slate-500">ひよりさんが画面を共有しています</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {people.map((p) => (
              <div key={p.name} className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-lg bg-slate-700">
                <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${p.tone}`}>
                  {p.name.slice(0, 1)}
                </span>
                <span className="text-[11px] text-slate-300">{p.name}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="hidden flex-col gap-2 rounded-xl bg-slate-700/60 p-3 text-[12px] sm:flex">
          <p className="w-fit rounded-lg rounded-tl-none bg-slate-600 px-2.5 py-1.5 text-slate-100">資料のリンク送ります</p>
          <p className="ml-auto w-fit rounded-lg rounded-tr-none bg-[#E5342E] px-2.5 py-1.5 text-white">ありがとうございます！</p>
          <p className="w-fit rounded-lg rounded-tl-none bg-slate-600 px-2.5 py-1.5 text-slate-100">@みなと 3ページ目を見てください</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-slate-900 px-3 py-2 text-[12px]">
        <span className="min-w-0 truncate text-slate-400">globy.grovina-studio.com/invite/••••••</span>
        <span className="shrink-0 rounded-md bg-white px-2.5 py-1 font-semibold text-slate-900">リンクをコピー</span>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="bg-white text-slate-900" style={{ fontFamily: BRAND.font }}>
      {/* ヒーロー */}
      <SiteHeader />
      <section className="bg-slate-900">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-14 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:pt-16">
          <div className="min-w-0">
            <h1 className="text-[2rem] font-bold leading-[1.35] text-white sm:text-5xl sm:leading-[1.3]">
              社外の人とも、
              <br />
              リンクひとつで
              <br />
              同じ部屋に。
            </h1>
            <p className="mt-6 max-w-[32rem] text-base leading-8 text-slate-300">
              {SITE.serviceName}は、ビデオ会議、画面共有、チャットをひとつにまとめたオンラインの部屋です。ブラウザだけで使えて、ゲストはアカウントを作らずに参加できます。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={SITE.loginPath}
                className="rounded-full bg-[#E5342E] px-7 py-3.5 font-bold text-white hover:bg-[#C92B25] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                無料で始める
              </Link>
              <Link
                href="#pricing"
                className="rounded-full px-7 py-3.5 font-bold text-white ring-1 ring-white/30 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                料金を見る
              </Link>
            </div>
            <p className="mt-4 text-sm text-slate-400">メールアドレスかGoogleアカウントで登録できます。</p>
          </div>
          <RoomPreview />
        </div>
      </section>

      {/* 機能 */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-6 px-5 py-20">
        <h2 className="text-2xl font-bold sm:text-3xl">打ち合わせに必要なものは、ここにそろっています</h2>
        <p className="mt-3 max-w-[40rem] leading-8 text-slate-600">
          会議ツール、チャットツール、ファイル共有をあちこち行き来する必要はありません。
        </p>
        <dl className="mt-12 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title}>
              <dt className="flex items-center gap-3 text-lg font-bold">
                <span className="h-3 w-3 rotate-45 bg-[#E5342E]" aria-hidden="true" />
                {f.title}
              </dt>
              <dd className="mt-2 leading-7 text-slate-600">{f.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 使い方(順番のある手順) */}
      <section className="bg-slate-50">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-2xl font-bold sm:text-3xl">始め方は3ステップ</h2>
          <ol className="mt-12 grid gap-8 md:grid-cols-3">
            {[
              { t: 'アカウントを作る', b: 'メールアドレスかGoogleアカウントで登録します。' },
              { t: '部屋をつくる', b: 'チームや取引先ごとに、会議とチャットの部屋を用意します。' },
              { t: 'リンクを送る', b: '招待リンクを送れば、相手はクリックするだけで参加できます。' },
            ].map((s, i) => (
              <li key={s.t} className="relative pl-14">
                <span className="absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-lg font-bold text-white">
                  {i + 1}
                </span>
                <p className="text-lg font-bold">{s.t}</p>
                <p className="mt-2 leading-7 text-slate-600">{s.b}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 料金 */}
      <section id="pricing" className="mx-auto max-w-6xl scroll-mt-6 px-5 py-20">
        <h2 className="text-2xl font-bold sm:text-3xl">料金プラン</h2>
        <p className="mt-3 text-slate-600">表示はすべて税込の月額です。</p>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((p) => (
            <div
              key={p.id}
              className={`flex flex-col rounded-2xl p-6 ${
                p.recommended ? 'bg-slate-900 text-white shadow-xl' : 'border border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">{p.name}</h3>
                {p.recommended && (
                  <span className="rounded-full bg-[#E5342E] px-2.5 py-0.5 text-xs font-bold text-white">おすすめ</span>
                )}
              </div>
              <p className={`mt-1 text-sm ${p.recommended ? 'text-slate-300' : 'text-slate-500'}`}>{p.summary}</p>
              <p className="mt-6 text-3xl font-bold">
                {yen(p.monthlyPrice)}
                <span className={`ml-1 text-sm font-normal ${p.recommended ? 'text-slate-300' : 'text-slate-500'}`}>/月</span>
              </p>
              <ul className={`mt-6 flex-1 space-y-2 text-sm ${p.recommended ? 'text-slate-200' : 'text-slate-600'}`}>
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <Link
                href={SITE.loginPath}
                className={`mt-8 rounded-full py-3 text-center font-bold ${
                  p.recommended ? 'bg-[#E5342E] text-white hover:bg-[#C92B25]' : 'bg-slate-100 text-slate-900 hover:bg-slate-200'
                }`}
              >
                {p.monthlyPrice === 0 ? '無料で始める' : `${p.name}を申し込む`}
              </Link>
            </div>
          ))}
        </div>
        <div className="mt-8 space-y-1 text-sm leading-7 text-slate-600">
          <p>有料プランは{BILLING.cycle}です。{BILLING.cancelRule}</p>
          <p>{BILLING.refundRule}</p>
          {TRIAL.enabled && <p>{TRIAL.description}</p>}
          <p>
            詳しくは
            <Link href="/tokushoho" className="text-[#C92B25] underline underline-offset-2">特定商取引法に基づく表記</Link>
            と
            <Link href="/terms" className="text-[#C92B25] underline underline-offset-2">利用規約</Link>
            をご確認ください。
          </p>
        </div>
      </section>

      {/* よくある質問 */}
      <section id="faq" className="scroll-mt-6 bg-slate-50">
        <div className="mx-auto max-w-3xl px-5 py-20">
          <h2 className="text-2xl font-bold sm:text-3xl">よくある質問</h2>
          <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            {[
              { q: 'アプリのインストールは必要ですか？', a: '必要ありません。パソコンのブラウザ（Google Chrome、Microsoft Edge、Safariの最新版）から使えます。' },
              { q: '社外の人を招待するには、相手にも登録が必要ですか？', a: '招待リンクを送るだけで、相手はアカウントを作らずに参加できます。' },
              { q: '解約はいつでもできますか？', a: `${BILLING.cancelHow}${BILLING.cancelRule}` },
              { q: '支払い方法は何がありますか？', a: `${BILLING.paymentMethod}に対応しています。` },
              { q: '導入の相談はできますか？', a: `運営元の${SITE.operatorTradeName}が、お問い合わせフォームから相談を受け付けています。` },
            ].map((item) => (
              <details key={item.q} className="group px-6 py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E5342E] [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span className="text-xl text-slate-400 transition-transform group-open:rotate-45 motion-reduce:transition-none" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p className="mt-3 leading-7 text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* 最後の呼びかけ */}
      <section className="bg-[#E5342E]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-16 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white sm:text-3xl">次の打ち合わせから、{SITE.serviceName}で。</h2>
            <p className="mt-2 text-white/80">まずはFreeプランで試してみてください。</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href={SITE.loginPath} className="rounded-full bg-white px-7 py-3.5 font-bold text-[#C92B25] hover:bg-[#FDECEC]">
              無料で始める
            </Link>
            <a href={SITE.contactUrl} className="rounded-full px-7 py-3.5 font-bold text-white ring-1 ring-white/60 hover:bg-white/10">
              導入について相談する
            </a>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
