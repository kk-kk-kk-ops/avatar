import Link from 'next/link';
import type { ReactNode } from 'react';
import { SITE } from '@/lib/site-info';

export function SiteHeader({ dark = false }: { dark?: boolean }) {
  const brand = dark ? 'text-white' : 'text-slate-900';
  const link = dark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900';
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
      <Link href="/lp" className={`flex items-center gap-2 text-lg font-bold ${brand}`}>
        {/* 既存のロゴ画像(public/logo-icon.png)を使用 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-icon.png" alt="" className={`h-7 w-7 ${dark ? 'invert' : ''}`} />
        {SITE.serviceName}
      </Link>
      <nav className="flex items-center gap-5 text-sm" aria-label="メインメニュー">
        <Link href="/lp#features" className={`hidden sm:inline ${link}`}>機能</Link>
        <Link href="/lp#pricing" className={`hidden sm:inline ${link}`}>料金</Link>
        <Link href="/lp#faq" className={`hidden sm:inline ${link}`}>よくある質問</Link>
        <Link
          href={SITE.loginPath}
          className={`rounded-full px-4 py-2 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 ${
            dark ? 'bg-white text-slate-900 hover:bg-slate-100' : 'bg-slate-900 text-white hover:bg-slate-700'
          }`}
        >
          ログイン
        </Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 text-sm text-slate-600 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-bold text-slate-900">{SITE.serviceName}</p>
          <p className="mt-1">
            運営：
            <a href={SITE.studioUrl} className="underline underline-offset-2 hover:text-slate-900">
              {SITE.operatorTradeName}
            </a>
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="規約・お問い合わせ">
          <Link href="/terms" className="hover:text-slate-900">利用規約</Link>
          <Link href="/privacy" className="hover:text-slate-900">プライバシーポリシー</Link>
          <Link href="/tokushoho" className="hover:text-slate-900">特定商取引法に基づく表記</Link>
          <a href={SITE.contactUrl} className="hover:text-slate-900">お問い合わせ</a>
        </nav>
      </div>
      <p className="pb-8 text-center text-xs text-slate-400">© {SITE.operatorTradeName}</p>
    </footer>
  );
}

/** 利用規約・プライバシーポリシー・特商法表記の共通レイアウト */
export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <SiteHeader />
      </div>
      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{title}</h1>
        <p className="mt-3 text-sm text-slate-500">
          制定日：{SITE.enactedAt}　最終改定日：{SITE.updatedAt}
        </p>
        <div className="mt-10 space-y-10 text-[15px] leading-8 text-slate-700">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}

export function Article({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 border-l-4 border-red-600 pl-3 text-lg font-bold text-slate-900">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function Items({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-2 pl-6 marker:text-slate-400">{children}</ol>;
}
