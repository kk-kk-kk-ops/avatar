'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BRAND, SITE } from '@/lib/site-info';

const NAV = [
  { href: '/lp#features', label: '機能' },
  { href: '/lp#pricing', label: '料金' },
  { href: '/lp#faq', label: 'よくある質問' },
  { href: SITE.loginPath, label: 'ログイン' },
];

/** ホバーで下線が左から伸びる(GROVINA STUDIOのサイトと同じ動き) */
const underline =
  'pb-1 bg-[linear-gradient(#222,#222)] bg-no-repeat bg-left-bottom bg-[length:0%_1px] hover:bg-[length:100%_1px] transition-[background-size] duration-300 motion-reduce:transition-none';

/**
 * GROVINA STUDIO(grovina-studio.com)のヘッダーに合わせたデザイン
 * 白背景・左にロゴ・区切り線付きのメニュー・赤い丸ボタン・1280px未満はハンバーガーメニュー
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="relative z-10 w-full bg-white" style={{ fontFamily: BRAND.font }}>
      <div className="flex w-full items-center justify-between gap-12 px-5 py-4 xl:px-10">
        <Link href="/lp" className="mr-auto flex items-center gap-3" onClick={() => setOpen(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/grovina/logo.png" alt="GROVINA STUDIO" width={246} height={75} className="h-auto w-[150px] xl:w-[246px]" />
          <span className="border-l border-[#ddd] pl-3 text-lg font-bold text-[#222] xl:text-xl">{SITE.serviceName}</span>
        </Link>

        <nav className="hidden xl:block" aria-label="メインメニュー">
          <ul className="-mr-5 flex items-center gap-2">
            {NAV.map((n, i) => (
              <li key={n.href} className={i === 0 ? 'pr-5' : 'border-l border-[#ddd] px-5'}>
                <Link href={n.href} className={`text-base font-medium text-[#222] ${underline}`}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <Link
          href={SITE.loginPath}
          className="hidden whitespace-nowrap rounded-full border-2 border-[#E5342E] bg-[#E5342E] px-9 py-3.5 text-lg font-bold text-white transition-colors duration-200 hover:bg-white hover:text-[#E5342E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E5342E] xl:inline-flex"
        >
          無料で始める
        </Link>

        <button
          type="button"
          className="flex h-8 w-8 shrink-0 flex-col items-center justify-center gap-1.5 xl:hidden"
          aria-label={open ? 'メニューを閉じる' : 'メニューを開く'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`block h-0.5 w-full rounded bg-[#111] transition-transform duration-200 ${open ? 'translate-y-2 rotate-45' : ''}`} />
          <span className={`block h-0.5 w-full rounded bg-[#111] transition-opacity duration-200 ${open ? 'opacity-0' : ''}`} />
          <span className={`block h-0.5 w-full rounded bg-[#111] transition-transform duration-200 ${open ? '-translate-y-2 -rotate-45' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 top-full w-full bg-white shadow-[0_8px_16px_rgba(0,0,0,0.08)] xl:hidden">
          <ul className="py-2 text-center">
            {NAV.map((n) => (
              <li key={n.href} className="border-b border-[#eee]">
                <Link href={n.href} className="block px-6 py-3.5 font-medium text-[#222]" onClick={() => setOpen(false)}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href={SITE.loginPath}
            className="flex h-14 items-center justify-center bg-[#E5342E] text-lg font-bold text-white"
            onClick={() => setOpen(false)}
          >
            無料で始める
          </Link>
        </div>
      )}
    </header>
  );
}
