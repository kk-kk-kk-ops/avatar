'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BRAND, SITE } from '@/lib/site-info';

/** デザインカンプの赤 */
const RED = '#D80003';

const NAV = [
  { href: '/lp#features', label: '機能・特徴' },
  { href: '/lp#pricing', label: '料金プラン' },
  { href: '/lp#security', label: 'セキュリティ' },
  { href: 'https://grovina-studio.com/about', label: '会社概要', external: true },
];

/**
 * LP・規約ページ共通のヘッダー（デザインカンプ準拠）
 * 白背景・右寄せの小さめメニュー（区切り線あり）・赤い角丸の「お問い合わせ」ボタン
 * 1024px 未満はハンバーガーメニュー
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);

  const NavLink = ({ item, className, onClick }: { item: (typeof NAV)[number]; className: string; onClick?: () => void }) =>
    item.external ? (
      <a href={item.href} className={className} onClick={onClick}>{item.label}</a>
    ) : (
      <Link href={item.href} className={className} onClick={onClick}>{item.label}</Link>
    );

  return (
    <header className="relative z-20 w-full bg-white" style={{ fontFamily: BRAND.font }}>
      <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between gap-8 px-5 lg:h-[112px] lg:px-[4.6%]">
        {/* カンプでは空欄ですが、サービス名がわかるようにロゴを置いています（不要なら削除） */}
        <Link href="/lp" className="flex items-center gap-3" onClick={() => setOpen(false)}>
          <img src="/grovina/logo.png" alt="GROVINA STUDIO" width={246} height={75} className="h-auto w-[120px] lg:w-[150px]" />
          <span className="border-l border-[#ddd] pl-3 text-base font-bold text-[#222] lg:text-lg">{SITE.serviceName}</span>
        </Link>

        <div className="hidden items-center gap-10 lg:flex">
          <nav aria-label="メインメニュー">
            <ul className="flex items-center">
              {NAV.map((n, i) => (
                <li key={n.href} className={`px-5 text-sm font-bold ${i > 0 ? 'border-l border-[#e5e5e5]' : ''}`}>
                  <NavLink item={n} className="text-[#333] transition-colors hover:text-[#D80003]" />
                </li>
              ))}
            </ul>
          </nav>
          <a
            href={SITE.contactUrl}
            className="inline-flex h-[55px] w-[216px] items-center justify-center rounded-lg text-[15px] font-bold text-white transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ backgroundColor: RED, outlineColor: RED }}
          >
            お問い合わせ
          </a>
        </div>

        <button
          type="button"
          className="flex h-8 w-8 shrink-0 flex-col items-center justify-center gap-1.5 lg:hidden"
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
        <div className="absolute left-0 top-full w-full bg-white shadow-[0_8px_16px_rgba(0,0,0,0.08)] lg:hidden">
          <ul className="py-2 text-center">
            {NAV.map((n) => (
              <li key={n.href} className="border-b border-[#eee]">
                <NavLink item={n} className="block px-6 py-3.5 font-bold text-[#333]" onClick={() => setOpen(false)} />
              </li>
            ))}
            <li className="border-b border-[#eee]">
              <Link href={SITE.loginPath} className="block px-6 py-3.5 font-bold text-[#333]" onClick={() => setOpen(false)}>
                ログイン
              </Link>
            </li>
          </ul>
          <a href={SITE.contactUrl} className="flex h-14 items-center justify-center font-bold text-white" style={{ backgroundColor: RED }}>
            お問い合わせ
          </a>
        </div>
      )}
    </header>
  );
}
