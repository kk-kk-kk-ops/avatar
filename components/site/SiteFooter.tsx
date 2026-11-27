import Link from 'next/link';
import { BRAND } from '@/lib/site-info';
import { LP_LINKS } from '@/components/lp/lp-ui';

const NAV = [
  { href: LP_LINKS.home, label: 'ホーム' },
  { href: LP_LINKS.features, label: '機能・特徴' },
  { href: LP_LINKS.pricing, label: '料金プラン' },
  { href: LP_LINKS.security, label: 'セキュリティ' },
  { href: LP_LINKS.operator, label: '運営者情報' },
  { href: LP_LINKS.contact, label: 'お問い合わせ' },
];

/** カンプにない「利用規約」も、申し込み前に読めるよう追加しています */
const LEGAL = [
  { href: LP_LINKS.tokushoho, label: '特商法に基づく表記' },
  { href: LP_LINKS.terms, label: '利用規約' },
  { href: LP_LINKS.privacy, label: 'プライバシーポリシー' },
];

function FooterLink({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  return href.startsWith('http') ? (
    <a href={href} className={className}>{children}</a>
  ) : (
    <Link href={href} className={className}>{children}</Link>
  );
}

/**
 * LP・規約ページ共通のフッター(デザインカンプ準拠)
 * 上辺が弧を描く薄いグレーの面。弧の外側には、すぐ上の背景がそのまま見えます。
 */
export function SiteFooter() {
  return (
    <footer className="relative" style={{ fontFamily: BRAND.font }}>
      <div className="rounded-t-[50%_60px] bg-[#EFEFEF] lg:rounded-t-[50%_110px]">
        <div className="mx-auto max-w-[1440px] px-5 pb-10 pt-16 text-center lg:pb-[40px] lg:pt-[90px]">
          <Link href={LP_LINKS.home} className="inline-block">
            <img src="/lp/logo-globy.png" alt="Globy" width={480} height={150} className="h-auto w-[120px] lg:w-[150px]" />
          </Link>

          <nav aria-label="フッターメニュー" className="mt-10 lg:mt-[48px]">
            <ul className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-[15px] text-[#333] lg:gap-x-[42px] lg:text-[16px]">
              {NAV.map((n) => (
                <li key={n.label}>
                  <FooterLink href={n.href} className="transition-colors hover:text-[#D80003]">{n.label}</FooterLink>
                </li>
              ))}
            </ul>
            <ul className="mt-8 flex flex-wrap justify-center gap-x-8 gap-y-2 text-[13px] text-[#555] lg:mt-[36px]">
              {LEGAL.map((n) => (
                <li key={n.label}>
                  <FooterLink href={n.href} className="transition-colors hover:text-[#D80003]">{n.label}</FooterLink>
                </li>
              ))}
            </ul>
          </nav>

          <p className="mt-14 text-[13px] text-[#333] lg:mt-[56px]">
            <small className="text-[13px]">© 2026 Grovina Studio</small>
          </p>
        </div>
      </div>
    </footer>
  );
}
