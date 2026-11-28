import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome';
import { BRAND, OPERATOR_TEAM, SITE } from '@/lib/site-info';

// titleは文字列のみ指定し、ルート(app/layout.tsx)のtitle.templateにより
// 「｜Globy」が自動で付く(2026-11-28、SEO設定。指示文の一覧には無い
// ページだが、他の公開ページと同じ扱いにそろえた)。
export const metadata: Metadata = {
  title: '運営者情報',
  description: `${SITE.serviceName}の運営チームについてご紹介します。`,
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
        <h1 className="text-2xl font-bold sm:text-3xl">運営者情報</h1>
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
