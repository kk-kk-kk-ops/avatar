import type { Metadata } from 'next';
import { AboutGloby } from '@/components/lp/AboutGloby';
import { HeroFirstView } from '@/components/lp/HeroFirstView';
import { PainPoints } from '@/components/lp/PainPoints';
import { Solutions } from '@/components/lp/Solutions';
import { MainFeatures } from '@/components/lp/MainFeatures';
import { UseCases } from '@/components/lp/UseCases';
import { HowToStart, SecurityIntro, SoftBackdrop, TrialCta } from '@/components/lp/LowerSections';
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome';
import { SiteJsonLd } from '@/components/seo/SiteJsonLd';
import { BRAND } from '@/lib/site-info';
import { TRIAL_DAYS } from '@/lib/types';

// 「/」は未ログインの人には常に「/lp」へ転送される(app/page.tsxの
// redirect("/lp")参照)ため、検索エンジン・未ログインの訪問者が実際に
// 見る「トップページ」の中身はこちら。
// title はルート(app/layout.tsx)のtitle.templateの対象にせず、完全な
// 文字列をそのまま出す(absolute)。トップページの見出しとして、接尾辞
// 「｜Globy」を重ねて二重にしたくないため(2026-11-28、SEO設定)。
export const metadata: Metadata = {
  title: { absolute: 'Globy(グロビー)｜アバターで集まるオンラインオフィス' },
  // 指示文の原文は「まずは30日間無料で試せます」だったが、TRIAL_DAYS
  // (14日、2026-11-27変更)と食い違うため、他の画面と同じくTRIAL_DAYSから
  // 作る文言にした。
  description: `Globyは、アバターで集まり、話し、つながるオンラインオフィスです。近づくだけで会話が始まり、会議室・画面共有・チャットもひとつに。ブラウザですぐ使えて、まずは${TRIAL_DAYS}日間無料で試せます。`,
  // 「/」はalternates.canonicalで"/"を指定しない。「/」自体は未ログインの
  // 人には常に「/lp」へ転送するだけのページで、内容を持たない。検索エンジンに
  // 「正式なURLは、転送元のまま存在しないページ(/)です」と伝えてしまうと
  // 誤解を招くため、ここではcanonicalを指定せず「/lp」自身を正式なURLの
  // ままにしている(詳細は報告参照)。
};

export default function LandingPage() {
  return (
    <div className="bg-white text-slate-900" style={{ fontFamily: BRAND.font }}>
      <SiteJsonLd />
      <SiteHeader />
      <main>
        <HeroFirstView />
        <AboutGloby />
        <PainPoints />
        <Solutions />
        <SoftBackdrop>
          <MainFeatures />
          <UseCases />
          <TrialCta id="trial-title" title={`まずは${TRIAL_DAYS}日間、スタンダードプランを無料で。`} />
          <HowToStart />
          <SecurityIntro />
          <TrialCta id="final-title" title="さあ、もうひとつのオフィスへ。" />
        </SoftBackdrop>
      </main>
      <SoftBackdrop>
        <SiteFooter />
      </SoftBackdrop>
    </div>
  );
}
