import Link from 'next/link';
import { SITE } from '@/lib/site-info';

/** デザインカンプの赤 */
export const RED = '#D80003';

/**
 * LP のボタン・メニューの移動先(ここだけ直せば全体に反映されます)
 * 機能・料金・セキュリティは、カンプに合わせて別ページにしています。
 */
export const LP_LINKS = {
  home: '/lp',
  features: '/features',
  pricing: '/pricing',
  security: '/security',
  operator: 'https://grovina-studio.com/about',
  contact: SITE.contactUrl,
  start: SITE.loginPath,
  tokushoho: '/tokushoho',
  privacy: '/privacy',
  terms: '/terms',
} as const;

/** 1440px のカンプ基準の横幅・左右余白(「Globyとは」と同じ) */
export const CONTAINER = 'mx-auto w-full max-w-[1440px] px-5 sm:px-10 lg:px-[160px]';

/** 赤い丸ボタン(ファーストビューの「無料で始める」と同じ形) */
export function RedButton({ href, children }: { href: string; children: React.ReactNode }) {
  const external = href.startsWith('http');
  const className =
    'group mx-auto flex h-[clamp(3.5rem,5.7vw,5.1rem)] w-full max-w-[577px] items-center justify-center gap-4 rounded-full text-[clamp(1rem,1.5vw,1.35rem)] font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4';
  const inner = (
    <>
      {children}
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[1.1em] w-[1.1em] transition-transform group-hover:translate-x-1 motion-reduce:transition-none" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m9 6 6 6-6 6" />
      </svg>
    </>
  );
  const style = { backgroundColor: RED, outlineColor: RED };
  return external ? (
    <a href={href} className={className} style={style}>{inner}</a>
  ) : (
    <Link href={href} className={className} style={style}>{inner}</Link>
  );
}

/** セクション左上の小見出し(「主な機能」など) */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[clamp(0.95rem,1.25vw,1.125rem)] font-medium text-[#111]">{children}</p>;
}

/** セクションの大見出し */
export function SectionTitle({ children, center = false }: { children: React.ReactNode; center?: boolean }) {
  return (
    <h2 className={`text-[clamp(1.6rem,3.2vw,2.875rem)] font-bold leading-[1.5] text-[#111] ${center ? 'text-center' : ''}`}>
      {children}
    </h2>
  );
}
