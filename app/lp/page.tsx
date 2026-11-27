import type { Metadata } from 'next';
import { AboutGloby } from '@/components/lp/AboutGloby';
import { HeroFirstView } from '@/components/lp/HeroFirstView';
import { PainPoints } from '@/components/lp/PainPoints';
import { Solutions } from '@/components/lp/Solutions';
import { MainFeatures } from '@/components/lp/MainFeatures';
import { UseCases } from '@/components/lp/UseCases';
import { HowToStart, SecurityIntro, SoftBackdrop, TrialCta } from '@/components/lp/LowerSections';
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome';
import { BRAND, SITE } from '@/lib/site-info';
import { TRIAL_DAYS } from '@/lib/types';

export const metadata: Metadata = {
  title: `${SITE.serviceName}｜リンクひとつで集まれる、オンラインの部屋`,
  description:
    'ビデオ会議、画面共有、チャットをひとつに。社外の人もリンクから参加できる、ブラウザで使えるオンラインの部屋です。',
};

export default function LandingPage() {
  return (
    <div className="bg-white text-slate-900" style={{ fontFamily: BRAND.font }}>
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
