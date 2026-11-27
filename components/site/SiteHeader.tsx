'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BRAND } from '@/lib/site-info';
import { LP_LINKS, RED } from '@/components/lp/lp-ui';

const NAV = [
  { href: LP_LINKS.features, label: '機能・特徴' },
  { href: LP_LINKS.pricing, label: '料金プラン' },
  { href: LP_LINKS.security, label: 'セキュリティ' },
  { href: LP_LINKS.operator, label: '運営者情報' },
  { href: LP_LINKS.contact, label: 'お問い合わせ' },
];

/** 外部サイトは <a>、サイト内は <Link> */
function NavLink({ href, className, style, onClick, children }: { href: string; className: string; style?: React.CSSProperties; onClick?: () => void; children: React.ReactNode }) {
  return href.startsWith('http') ? (
    <a href={href} className={className} style={style} onClick={onClick}>{children}</a>
  ) : (
    <Link href={href} className={className} style={style} onClick={onClick}>{children}</Link>
  );
}

const RED_BUTTON_STYLE = { backgroundColor: RED, outlineColor: RED, color: '#fff' };

/**
 * LP・規約ページ共通のヘッダー(デザインカンプ準拠)
 * 薄いグレーの背景・左に Globy ロゴ・右にメニュー(区切り線あり)と赤い「無料で試してみる」ボタン
 * 1024px 未満はハンバーガーメニュー
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <header className="relative z-20 w-full bg-[#EFEFEF]" style={{ fontFamily: BRAND.font }}>
      <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between gap-8 px-5 lg:h-[96px] lg:px-[4.6%] xl:px-[124px]">
        <Link href={LP_LINKS.home} className="shrink-0" onClick={close}>
          <img src="/lp/logo-globy.png" alt="Globy" width={480} height={150} className="h-auto w-[100px] lg:w-[148px]" />
        </Link>

        <div className="hidden items-center gap-8 lg:flex xl:gap-[56px]">
          <nav aria-label="メインメニュー">
            <ul className="flex items-center">
              {NAV.map((n, i) => (
                <li key={n.label} className={`px-4 text-[14px] font-medium xl:px-5 ${i > 0 ? 'border-l border-[#d6d6d6]' : ''}`}>
                  <NavLink href={n.href} className="text-[#333] transition-colors hover:text-[#D80003]">{n.label}</NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <NavLink
            href={LP_LINKS.start}
            className="inline-flex h-[56px] w-[220px] items-center justify-center rounded-lg text-[15px] font-bold text-white transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={RED_BUTTON_STYLE}
          >
            無料で試してみる
          </NavLink>
        </div>

        <button
          type="button"
          className="flex h-8 w-8 shrink-0 flex-col items-center justify-center gap-1.5 lg:hidden"
          aria-label={open ? 'メニューを閉じる' : 'メニューを開く'}
          aria-expanded={open}
          aria-controls="site-mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`block h-0.5 w-full rounded bg-[#111] transition-transform duration-200 ${open ? 'translate-y-2 rotate-45' : ''}`} />
          <span className={`block h-0.5 w-full rounded bg-[#111] transition-opacity duration-200 ${open ? 'opacity-0' : ''}`} />
          <span className={`block h-0.5 w-full rounded bg-[#111] transition-transform duration-200 ${open ? '-translate-y-2 -rotate-45' : ''}`} />
        </button>
      </div>

      {open && (
        <div id="site-mobile-menu" className="absolute left-0 top-full w-full bg-white shadow-[0_8px_16px_rgba(0,0,0,0.08)] lg:hidden">
          <ul className="py-2 text-center">
            {NAV.map((n) => (
              <li key={n.label} className="border-b border-[#eee]">
                <NavLink href={n.href} className="block px-6 py-3.5 font-bold text-[#333]" onClick={close}>{n.label}</NavLink>
              </li>
            ))}
          </ul>
          <div className="px-6 pb-6 pt-4">
            <NavLink
              href={LP_LINKS.start}
              className="flex h-[52px] w-full items-center justify-center rounded-lg font-bold"
              style={RED_BUTTON_STYLE}
              onClick={close}
            >
              無料で試してみる ／ ログイン
            </NavLink>
          </div>
        </div>
      )}
    </header>
  );
}
