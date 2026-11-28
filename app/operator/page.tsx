import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome';
import { BRAND, OPERATOR_TEAM, SITE } from '@/lib/site-info';

export const metadata: Metadata = {
  title: `運営者情報 | ${SITE.serviceName}`,
};

const ROWS: { label: string; value: React.ReactNode }[] = [
  { label: 'チーム名', value: OPERATOR_TEAM.teamName },
  { label: '運営代表者', value: OPERATOR_TEAM.representative },
  { label: '活動形態', value: OPERATOR_TEAM.activityType },
  { label: '活動拠点', value: OPERATOR_TEAM.activityBase },
  { label: '事業内容', value: OPERATOR_TEAM.businessContent },
  {
    label: 'お問い合わせ',
    value: (
      <Link href={SITE.contactUrl} className="text-[#C92B25] underline underline-offset-2">
        お問い合わせはこちらから
      </Link>
    ),
  },
];

export default function OperatorPage() {
  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: BRAND.font }}>
      <div className="border-b border-[#eee]">
        <SiteHeader />
      </div>
      <main className="mx-auto max-w-3xl px-5 py-20">
        <p className="text-sm font-semibold tracking-[0.2em] text-[#999]">- ABOUT US -</p>
        <h1 className="mt-3 text-2xl font-bold sm:text-3xl">私たちについて</h1>

        <h2 className="mt-14 text-xl font-bold sm:text-2xl">運営者情報</h2>
        <p className="mt-3 text-slate-600">
          {SITE.serviceName}は、{OPERATOR_TEAM.teamName}がオンラインで連携して開発・運営するサービスです。
        </p>
        <div className="mt-8 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <dl className="divide-y divide-slate-200">
            {ROWS.map((r) => (
              <div key={r.label} className="grid gap-1 px-5 py-4 sm:grid-cols-[10rem_1fr] sm:gap-6">
                <dt className="font-semibold text-slate-900">{r.label}</dt>
                <dd className="text-slate-700">{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
