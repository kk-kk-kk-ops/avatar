import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome';
import { BRAND, FEATURES, SITE } from '@/lib/site-info';

export const metadata: Metadata = {
  title: `セキュリティ | ${SITE.serviceName}`,
};

// FEATURES の最後の1項目(「守られたログイン」)だけがセキュリティに関する内容
// (2026-11-27、LP再構築時に機能一覧から切り出した。他の5項目は/featuresへ)。
const SECURITY_FEATURE = FEATURES[FEATURES.length - 1];

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: BRAND.font }}>
      <div className="border-b border-[#eee]">
        <SiteHeader />
      </div>
      <main className="mx-auto max-w-6xl px-5 py-20">
        <h1 className="text-2xl font-bold sm:text-3xl">安心してご利用いただくために</h1>
        <p className="mt-3 max-w-[40rem] leading-8 text-slate-600">
          通信の暗号化、不正ログイン対策、管理者による入室管理など、安心して使える仕組みを整えています。
        </p>
        <div className="mt-12 max-w-xl">
          <dt className="flex items-center gap-3 text-lg font-bold">
            <span className="h-3 w-3 rotate-45 bg-[#E5342E]" aria-hidden="true" />
            {SECURITY_FEATURE.title}
          </dt>
          <dd className="mt-2 leading-7 text-slate-600">{SECURITY_FEATURE.body}</dd>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
