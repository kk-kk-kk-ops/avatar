import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { LegalLayout } from '@/components/site/SiteChrome';
import { BILLING, PLANS, SITE, TRIAL, yen } from '@/lib/site-info';

export const metadata: Metadata = {
  title: `特定商取引法に基づく表記 | ${SITE.serviceName}`,
};

export default function TokushohoPage() {
  const rows: { label: string; value: ReactNode }[] = [
    {
      label: '販売事業者',
      value: (
        <>
          {SITE.operatorLegalName}
          <br />
          (屋号:{SITE.operatorTradeName})
        </>
      ),
    },
    { label: '所在地', value: SITE.address },
    {
      label: '電話番号',
      value: (
        <>
          {SITE.phone}
          <br />
          お問い合わせは、まずメールでお願いいたします。
        </>
      ),
    },
    {
      label: 'メールアドレス',
      value: (
        <>
          {SITE.email}
          <br />
          受付時間:{SITE.supportHours}
        </>
      ),
    },
    { label: 'サービスURL', value: SITE.url },
    {
      label: '販売価格',
      value: (
        <>
          <ul className="space-y-1">
            {PLANS.map((p) => (
              <li key={p.id}>
                {p.name}プラン:月額 {yen(p.monthlyPrice)}(税込)
              </li>
            ))}
          </ul>
          <p className="mt-2">各プランの料金は、お申し込み画面にも表示しています。</p>
        </>
      ),
    },
    {
      label: '販売価格以外の必要料金',
      value: 'インターネット接続料金、通信料金などは、お客様のご負担となります。',
    },
    { label: '支払方法', value: BILLING.paymentMethod },
    {
      label: '支払時期',
      value:
        '有料プランへのお申し込み(決済手続き)完了時に初回のお支払いが発生し、以降は毎月の契約更新日に自動で決済されます。無料トライアルをご利用の場合、トライアル期間中に有料プランへお申し込みにならない限り料金は発生せず、トライアル終了後は自動的に無料プランの内容に切り替わります(自動的に有料契約へ移行することはありません)。トライアル期間中に有料プランへお申し込みいただいた場合は、そのお申し込み時点から料金が発生します。',
    },
    {
      label: 'サービスの提供時期',
      value: '決済完了後、ただちにご利用いただけます。',
    },
    {
      label: '契約期間・自動更新',
      value: `${BILLING.cycle}です。解約のお手続きをされない限り、同じ条件で毎月自動的に契約が更新されます。`,
    },
    ...(TRIAL.enabled ? [{ label: '無料トライアル', value: TRIAL.description }] : []),
    {
      label: '解約について',
      value: (
        <>
          {BILLING.cancelHow}
          <br />
          {BILLING.cancelRule}
        </>
      ),
    },
    {
      label: '返品・返金について',
      value: `本サービスはオンラインで提供するサービスの性質上、返品はございません。${BILLING.refundRule}`,
    },
    {
      label: '動作環境',
      value:
        'Google Chrome、Microsoft Edge、Safari の最新版。マイク・カメラ(会議を利用する場合)と、安定したインターネット接続が必要です。',
    },
  ];

  return (
    <LegalLayout title="特定商取引法に基づく表記">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <dl className="divide-y divide-slate-200">
          {rows.map((r) => (
            <div key={r.label} className="grid gap-1 px-5 py-4 sm:grid-cols-[12rem_1fr] sm:gap-6">
              <dt className="font-semibold text-slate-900">{r.label}</dt>
              <dd className="text-slate-700">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </LegalLayout>
  );
}
