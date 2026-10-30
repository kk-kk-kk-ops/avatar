import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome';
import { ContactForm } from '@/components/contact/ContactForm';
import { BRAND, SITE } from '@/lib/site-info';

export const metadata: Metadata = {
  title: `お問い合わせ | ${SITE.serviceName}`,
  description: 'Globy（グロビー）へのお問い合わせはこちらのフォームから受け付けています。',
};

// /terms・/privacy・/tokushohoと同じくSiteHeader/SiteFooterで挟む
// (ヘッダー直下にborder-bを入れる見た目も、components/site/SiteChrome.tsx
// のLegalLayoutに合わせている。LegalLayoutそのものは「制定日」表示が
// 前提のため、ここでは使わずヘッダー・フッターだけ個別に組んでいる)。
export default function ContactPage() {
  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: BRAND.font }}>
      <div className="border-b border-[#eee]">
        <SiteHeader />
      </div>
      <main className="bg-white">
        <div className="mx-auto w-full max-w-[760px] px-5 pb-24 pt-14 sm:px-8 lg:pb-32 lg:pt-20">
          <h1 className="text-center text-[clamp(1.6rem,3vw,2.25rem)] font-bold text-[#111]">お問い合わせ</h1>
          <p className="mx-auto mt-6 max-w-[560px] text-center text-[15px] leading-loose text-[#444]">
            {SITE.serviceName} に関するご質問・ご相談は、こちらのフォームからお送りください。
            <br className="hidden sm:inline" />
            通常、2営業日以内にご返信いたします。
          </p>
          <div className="mt-12">
            <ContactForm />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
