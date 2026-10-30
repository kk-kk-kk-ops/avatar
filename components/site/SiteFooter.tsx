import Link from 'next/link';
import { BRAND, SITE } from '@/lib/site-info';

const LINKS = [
  { href: '/terms', label: '利用規約' },
  { href: '/privacy', label: 'プライバシーポリシー' },
  { href: '/tokushoho', label: '特定商取引法に基づく表記' },
  { href: SITE.contactUrl, label: 'お問い合わせ' },
  { href: SITE.studioUrl, label: '運営:GROVINA STUDIO', external: true },
];

const underline =
  'pb-1 bg-[linear-gradient(#fff,#fff)] bg-no-repeat bg-left-bottom bg-[length:0%_1px] hover:bg-[length:100%_1px] transition-[background-size] duration-300 motion-reduce:transition-none';

/**
 * GROVINA STUDIO(grovina-studio.com)のフッターに合わせたデザイン
 * 黒背景・区切り線付きのリンク・右にSNSアイコン・下にコピーライト
 */
export function SiteFooter() {
  return (
    <footer
      className="flex w-full flex-col justify-center bg-[#0d0d0d] py-8 text-white lg:min-h-[170px] lg:py-6"
      style={{ fontFamily: BRAND.font }}
    >
      <div className="flex w-full flex-col items-center gap-5 px-6 text-center lg:flex-row lg:justify-between lg:pl-10 lg:pr-16 lg:text-left">
        <nav aria-label="規約・お問い合わせ">
          <ul className="flex flex-wrap items-center justify-center gap-y-3 lg:justify-start lg:pl-16">
            {LINKS.map((l, i) => (
              <li key={l.href} className={`px-4 text-sm ${i === 0 ? 'lg:pl-0' : 'border-l border-white/30'}`}>
                {l.external ? (
                  <a href={l.href} className={`text-white ${underline}`}>{l.label}</a>
                ) : (
                  <Link href={l.href} className={`text-white ${underline}`}>{l.label}</Link>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-3">
          {BRAND.sns.map((s) => (
            <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.icon} alt={s.label} width={20} height={20} className="block h-5 w-5" />
            </a>
          ))}
        </div>
      </div>
      <p className="mt-6 text-center text-xs tracking-[0.05em] text-[#ccc]">© GROVINA STUDIO All Rights Reserved.</p>
    </footer>
  );
}
