import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome';
import { BRAND, FEATURES, SITE } from '@/lib/site-info';

export const metadata: Metadata = {
  title: `機能・特徴 | ${SITE.serviceName}`,
};

// FEATURES の最後の1項目(「守られたログイン」)はセキュリティに関する内容なので、
// /security ページに移し、ここには表示しない(2026-11-27、LP再構築時の決定)。
const DISPLAY_FEATURES = FEATURES.slice(0, -1);

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: BRAND.font }}>
      <div className="border-b border-[#eee]">
        <SiteHeader />
      </div>
      <main className="mx-auto max-w-6xl px-5 py-20">
        <h1 className="text-2xl font-bold sm:text-3xl">打ち合わせに必要なものは、ここにそろっています</h1>
        <p className="mt-3 max-w-[40rem] leading-8 text-slate-600">
          会議ツール、チャットツール、ファイル共有をあちこち行き来する必要はありません。
        </p>
        <dl className="mt-12 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {DISPLAY_FEATURES.map((f) => (
            <div key={f.title}>
              <dt className="flex items-center gap-3 text-lg font-bold">
                <span className="h-3 w-3 rotate-45 bg-[#E5342E]" aria-hidden="true" />
                {f.title}
              </dt>
              <dd className="mt-2 leading-7 text-slate-600">{f.body}</dd>
            </div>
          ))}
        </dl>
      </main>
      <SiteFooter />
    </div>
  );
}
