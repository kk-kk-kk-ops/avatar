import type { ReactNode } from 'react';
import { BRAND, SITE } from '@/lib/site-info';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

export { SiteFooter, SiteHeader };

/** 利用規約・プライバシーポリシー・特商法表記の共通レイアウト */
export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f7f7f7]" style={{ fontFamily: BRAND.font }}>
      <div className="border-b border-[#eee]">
        <SiteHeader />
      </div>
      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-2xl font-bold text-[#222] sm:text-3xl">{title}</h1>
        <p className="mt-3 text-sm text-[#666]">
          制定日:{SITE.enactedAt}　最終改定日:{SITE.updatedAt}
        </p>
        <div className="mt-10 space-y-10 text-[15px] font-medium leading-8 text-[#333]">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}

export function Article({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 border-l-4 border-[#E5342E] pl-3 text-lg font-bold text-[#222]">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function Items({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-2 pl-6 marker:text-[#999]">{children}</ol>;
}
