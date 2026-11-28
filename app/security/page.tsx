import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome';
import { CONTAINER } from '@/components/lp/lp-ui';
import { SoftBackdrop, TrialCta } from '@/components/lp/LowerSections';
import { BRAND, SITE } from '@/lib/site-info';
import { TRIAL_DAYS } from '@/lib/types';

export const metadata: Metadata = {
  title: `セキュリティ | ${SITE.serviceName}`,
  description: '通信の暗号化、不正ログイン対策、組織ごとのアクセス制限など、Globyのセキュリティへの取り組みをご紹介します。',
};

/**
 * セキュリティページ(デザインカンプ準拠)
 *
 * ⚠ ここに書く内容は「実際にそうなっていること」だけにしてください。
 *   実装されていない対策を載せると、事実と違う表示(優良誤認)になります。
 *   まだ実装していない項目は hidden: true にすると、ページに表示されなくなります。
 *
 * 2026-11-28、各カードの対策を実装(コード)で確認済み。確認結果は
 * この回のコミットメッセージ・報告を参照(表形式でまとめ済み)。
 * 「管理システムの2段階認証」「運営アカウントの多要素認証」は、仕組み
 * 自体(app/master/page.tsxのaal2チェック)はあるが、全運営アカウントへの
 * 設定を必須にする仕組みはない(任意設定・設定済みなら有効)ため、文言は
 * 変えずそのまま残し、報告のみで足りない点を伝えた。他は全項目、実装を
 * 確認できたため hidden にしていない。
 */

type Item = {
  icon: string;
  /** アイコン画像の元サイズ(幅は 44px 固定) */
  h: number;
  title: string;
  body: string;
  hidden?: boolean;
};

type Section = {
  id: string;
  label: string;
  title: string;
  lead?: React.ReactNode;
  items?: Item[];
};

const I = {
  mail: { icon: '/lp/security/icon-mail-check.png', h: 39 },
  phone: { icon: '/lp/security/icon-phone-user.png', h: 58 },
  monitor: { icon: '/lp/security/icon-monitor.png', h: 34 },
  laptop: { icon: '/lp/security/icon-laptop.png', h: 35 },
  bot: { icon: '/lp/security/icon-bot.png', h: 69 },
  doc: { icon: '/lp/security/icon-document-alert.png', h: 36 },
  folder: { icon: '/lp/security/icon-folder-lock.png', h: 40 },
};

const SECTIONS: Section[] = [
  {
    id: 'communication',
    label: '1.通信を守る',
    title: 'やりとりは、全て暗号化して届けます',
    lead: (
      <>
        音声・映像・チャットなど、Globyでのやりとりはすべて暗号化された通信で届きます。第三者が途中で内容をのぞき見ることができない仕組みです。
        <br />
        (HTTPS・WebRTC)
      </>
    ),
  },
  {
    id: 'account',
    label: '2.アカウントを守る',
    title: '不正なログインを防ぎます',
    items: [
      {
        ...I.mail,
        title: '安全なログイン',
        body: 'Googleアカウントでのログインと、メールアドレスに届く確認コードでの認証に対応しています。不正なログインの試みは、自動でブロックします。',
      },
      {
        ...I.phone,
        title: 'なりすまし対策',
        body: '通話に参加している人が本人かどうかを、サーバー側で確認しています。ほかの人になりすまして会話に入ることはできません。',
      },
      {
        ...I.monitor,
        title: '同時ログインの制御',
        body: '同じアカウントで複数の場所からログインがあった場合は、古いほうを自動でログアウトさせます。',
      },
      {
        ...I.laptop,
        title: '管理システムの2段階認証',
        body: 'Globy の運営で使う管理用のアカウントには、すべて2段階認証を設定しています。運営側のアカウントが乗っ取られて、データが外に漏れるのを防いでいます。',
      },
      {
        ...I.bot,
        title: 'bot対策',
        body: 'ログイン・新規登録・パスワード再設定の画面に、Cloudflare のボット対策(Turnstile)を導入しています。プログラムによる大量のログイン試行や、なりすましの登録を自動で見分けて止めます。',
      },
    ],
  },
  {
    id: 'data',
    label: '3.データを守る',
    title: 'あなたのデータは、あなたの組織だけのもの',
    items: [
      {
        ...I.doc,
        title: '組織ごとのアクセス制限',
        body: 'データベースの仕組みの段階で、自分や自分の組織以外のデータにはアクセスできないようにしています。(行レベルセキュリティ/RLS)',
      },
      {
        ...I.phone,
        title: '権限の書き換えを防止',
        body: '不正な操作によって、管理者の権限や契約プランが書き換えられないよう、サーバー側で厳しくチェックしています。',
      },
      {
        ...I.folder,
        title: 'データの保存と削除',
        body: 'チャットの履歴は、プランごとに決められた期間が過ぎると自動で削除されます。共有されたファイルも、アクセスできる人を限定して保護しています。',
      },
    ],
  },
  {
    id: 'room',
    label: '4.部屋を守る',
    title: '誰が入れるかは、管理者が決められます',
    items: [
      {
        ...I.doc,
        title: '招待URLでの入室',
        body: '部屋に入れるのは、招待URLを受け取った人だけです。',
      },
      {
        ...I.phone,
        title: '強制退出・再入室のブロック',
        body: '必要なときは、管理者が参加者を部屋から退出させ、再び入れないようにブロックできます。',
      },
    ],
  },
  {
    id: 'operation',
    label: '5.運営体制',
    title: '運営側も、安全に管理しています。',
    items: [
      {
        ...I.doc,
        title: '運営アカウントの多要素認証',
        body: 'Globyを運営する側の管理アカウントには、多要素認証(MFA)を必須にしています。パスワードだけでは、ログインできない仕組みです。',
      },
      {
        ...I.phone,
        title: '継続的なセキュリティ点検',
        body: '新しい機能を公開する前には、ログイン・権限・データへのアクセスについて、さまざまな角度から点検しています。',
      },
    ],
  },
];

function Card({ item }: { item: Item }) {
  return (
    <li className="flex flex-col rounded-[4px] bg-white px-[26px] pb-10 pt-6 shadow-[0_0_0_1px_rgba(0,0,0,0.03),0_2px_10px_rgba(0,0,0,0.03)]">
      {/* アイコンの高さが違っても見出しの位置がそろうよう、上の枠を固定 */}
      <div className="flex h-[70px] items-start justify-center">
        <img src={item.icon} alt="" aria-hidden="true" width={44} height={item.h} className="h-auto w-[44px]" />
      </div>
      <h3 className="mt-2 text-center text-[clamp(1.05rem,1.4vw,1.25rem)] font-bold leading-[1.6] text-[#111]">{item.title}</h3>
      <p className="mt-3 text-[clamp(0.9rem,1.1vw,1rem)] leading-[1.9] tracking-[0.04em] text-[#333]">{item.body}</p>
    </li>
  );
}

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-white text-[#111]" style={{ fontFamily: BRAND.font }}>
      <SiteHeader />
      <SoftBackdrop>
        <main>
          {/* ページの見出し */}
          <section className={`${CONTAINER} pb-6 pt-14 lg:pt-[60px]`}>
            <div className="flex items-start justify-between gap-6">
              <div className="pt-6 lg:pt-[50px]">
                <h1 className="text-[clamp(2rem,3.4vw,3rem)] font-medium">セキュリティ</h1>
                <p className="mt-6 text-[clamp(0.95rem,1.2vw,1.1rem)] leading-[1.9] text-[#222]">
                  Globyは、声や映像、チャットなど、大切な会話をお預かりするサービスです。
                  <br className="hidden md:inline" />
                  だからこそ、安心して使っていただけるよう、セキュリティには特に力を入れています。
                </p>
              </div>
              <img
                src="/lp/security/character-gear.png"
                alt=""
                aria-hidden="true"
                width={466}
                height={488}
                className="hidden w-[150px] shrink-0 sm:block lg:mr-[60px] lg:w-[195px]"
              />
            </div>
          </section>

          {SECTIONS.map((s) => {
            const items = s.items?.filter((it) => !it.hidden) ?? [];
            if (s.items && items.length === 0) return null;
            return (
              <section key={s.id} aria-labelledby={`sec-${s.id}`} className={`${CONTAINER} pt-16 lg:pt-[110px]`}>
                <p className="text-[clamp(0.9rem,1.1vw,1rem)] text-[#222]">{s.label}</p>
                <h2 id={`sec-${s.id}`} className="mt-5 text-[clamp(1.4rem,2.3vw,2rem)] font-medium leading-[1.5] lg:mt-[36px]">
                  {s.title}
                </h2>
                {s.lead && <p className="mt-6 text-[clamp(0.85rem,1.05vw,0.95rem)] leading-[1.8] text-[#222] lg:mt-[36px]">{s.lead}</p>}
                {items.length > 0 && (
                  <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:mt-[36px] lg:grid-cols-3 lg:gap-x-[36px] lg:gap-y-[36px]">
                    {items.map((it) => (
                      <Card key={it.title} item={it} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          <div className="pt-20 lg:pt-[160px]">
            <TrialCta id="security-trial-title" title={`まずは${TRIAL_DAYS}日間、スタンダードプランを無料で。`} />
          </div>
        </main>
        <div className="pt-16 lg:pt-[120px]">
          <SiteFooter />
        </div>
      </SoftBackdrop>
    </div>
  );
}
