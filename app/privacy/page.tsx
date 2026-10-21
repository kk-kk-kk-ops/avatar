import type { Metadata } from 'next';
import { Article, Items, LegalLayout } from '@/components/site/SiteChrome';
import { SITE } from '@/lib/site-info';

export const metadata: Metadata = {
  title: `プライバシーポリシー | ${SITE.serviceName}`,
};

const S = SITE.serviceName;
const OP = SITE.operatorTradeName;

/**
 * 外部サービス(委託先)の一覧。実際に使っているサービスと一致させてください。
 * 追加・削除した場合はここだけ直せば表に反映されます。
 */
const PROCESSORS = [
  { name: 'Supabase, Inc.', country: '米国', purpose: 'データベース、ログイン認証、ファイルの保存(データの保存場所:日本・東京リージョン)' },
  { name: 'Vercel Inc.', country: '米国', purpose: '本サービスのウェブサイト・アプリの配信' },
  { name: 'Stripe, Inc.', country: '米国', purpose: '有料プランの決済処理' },
  { name: 'Cloudflare, Inc.', country: '米国', purpose: '不正ログイン・ボット対策(Turnstile)' },
  { name: 'Google LLC', country: '米国', purpose: 'Googleアカウントでのログイン' },
  // 2026-10時点、LiveKitは自前のVPS上に自己ホストしており、LiveKit社
  // (管理クラウド)は利用していない。実際にデータへアクセスしうる
  // 「委託先」はこのVPSを提供するホスティング事業者(NTTPCコミュニケー
  // ションズ株式会社)。
  { name: 'NTTPCコミュニケーションズ株式会社', country: '日本', purpose: 'ビデオ会議の映像・音声の中継' },
];

export default function PrivacyPage() {
  return (
    <LegalLayout title="プライバシーポリシー">
      <p>
        {OP}(以下「当方」)は、オンラインサービス「{S}」(以下「本サービス」)における個人情報の取り扱いについて、個人情報の保護に関する法律その他の関係法令を守り、以下のとおりプライバシーポリシーを定めます。
      </p>

      <Article title="1. 取得する情報">
        <p>当方は、本サービスの提供にあたり、次の情報を取得します。</p>
        <Items>
          <li>アカウント情報:氏名または表示名、メールアドレス、パスワード(暗号化して保存し、当方が内容を知ることはできません)、所属するアカウント名</li>
          <li>Googleアカウントでログインする場合:Googleから提供される氏名、メールアドレス、プロフィール画像</li>
          <li>決済に関する情報:契約プラン、決済の履歴。クレジットカード番号は決済代行事業者(Stripe)が管理し、当方のサーバーには保存しません</li>
          <li>ユーザーコンテンツ:チャットのメッセージ、送信された画像、会議ルームの情報、文字起こしのテキストなど</li>
          <li>
            会議の映像・音声:会議中に参加者間でやりとりするために中継します。画面録画・文字起こし機能をご利用の場合、録画データおよび文字起こしテキストは利用者ご自身のブラウザからお使いの端末に直接保存(ダウンロード)される方式であり、当方のサーバーにアップロード・保存されることはありません。
          </li>
          <li>利用状況の情報:ログイン日時、利用時間、IPアドレス、ブラウザ・端末の種類、操作ログ、Cookieなどの識別子</li>
          <li>お問い合わせ・不具合報告の内容:送信いただいた本文、スクリーンショット、不具合の調査に必要な技術情報(ブラウザの種類、エラーの記録など)</li>
        </Items>
      </Article>

      <Article title="2. 利用目的">
        <p>取得した情報は、次の目的の範囲内で利用します。</p>
        <Items>
          <li>本サービスの提供、本人確認、ログイン認証のため</li>
          <li>有料プランの料金の請求・決済のため</li>
          <li>お問い合わせや不具合報告への対応のため</li>
          <li>不正利用・不正アクセスの防止、セキュリティの確保のため</li>
          <li>利用規約に違反する行為への対応のため</li>
          <li>本サービスの改善、新機能の開発のため(個人を特定しない統計情報として利用します)</li>
          <li>重要なお知らせ、メンテナンス、規約変更などのご連絡のため</li>
        </Items>
      </Article>

      <Article title="3. 第三者への提供">
        <p>当方は、次の場合を除き、本人の同意なく個人情報を第三者に提供しません。</p>
        <Items>
          <li>法令に基づく場合</li>
          <li>人の生命、身体または財産の保護のために必要で、本人の同意を得ることが難しい場合</li>
          <li>国の機関や地方公共団体などの法令に定める事務に協力する必要があり、本人の同意を得ることでその事務の遂行に支障が出るおそれがある場合</li>
          <li>次項の業務委託に伴って提供する場合</li>
        </Items>
      </Article>

      <Article title="4. 業務委託と外国にある第三者への提供">
        <p>
          当方は、本サービスの運営に必要な範囲で、個人情報の取り扱いを外部の事業者に委託しています。委託先の多くは外国(米国)の事業者です。
        </p>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="bg-slate-100 text-slate-900">
              <tr>
                <th className="px-4 py-3 font-semibold">委託先</th>
                <th className="px-4 py-3 font-semibold">所在国</th>
                <th className="px-4 py-3 font-semibold">委託する内容</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {PROCESSORS.map((p) => (
                <tr key={p.name}>
                  <td className="px-4 py-3">{p.name}</td>
                  <td className="px-4 py-3">{p.country}</td>
                  <td className="px-4 py-3">{p.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          米国には、日本の個人情報保護法に相当する包括的な連邦法はなく、州ごとの法律や分野ごとの法律によって個人情報が保護されています。米国の制度の詳細は、個人情報保護委員会のウェブサイトで公表されている「外国における個人情報の保護に関する制度等の調査」をご参照ください。当方は、各委託先が個人情報の適切な取り扱いについて定めた規約・方針を確認したうえで利用し、委託先を適切に監督します。
        </p>
      </Article>

      <Article title="5. 安全管理のための措置">
        <p>当方は、個人情報の漏えい、滅失、毀損を防ぐため、次の措置を講じています。</p>
        <Items>
          <li>通信の暗号化(HTTPS)</li>
          <li>データベースでのアクセス権限の制御(本人と権限のある人だけがデータを見られる仕組み)</li>
          <li>管理用アカウントへの2段階認証の設定</li>
          <li>ボットや総当たり攻撃による不正ログインの防止</li>
          <li>取り扱う人の限定と、取り扱い方法の見直し</li>
        </Items>
      </Article>

      <Article title="6. 保存期間">
        <p>
          個人情報は、利用目的の達成に必要な期間に限って保存します。退会(アカウントの削除)時には、法令で保存が必要な情報を除き、速やかに削除します。チャットのメッセージ・画像は、ご契約のプランに応じて次の期間が経過すると自動で削除されます:Freeプラン 7日間、Light・Standardプラン 1か月、Proプラン 3か月。会議の録画データ・文字起こしテキストは、前項のとおり当方のサーバーには保存されないため、当方側での保存期間という概念自体がありません(利用者ご自身の端末に保存されたデータの管理は、利用者ご自身の責任で行っていただきます)。
        </p>
      </Article>

      <Article title="7. Cookieなどの利用">
        <p>
          本サービスでは、ログイン状態の維持、言語設定の保存、不正ログインの防止(Cloudflare Turnstile)などのために、Cookieやブラウザの保存領域を利用します。これらの一部は、委託先の事業者に利用者の端末情報やIPアドレスなどが送信される仕組みを含みます。ブラウザの設定でCookieを無効にすると、本サービスにログインできない場合があります。
        </p>
      </Article>

      <Article title="8. 開示・訂正・利用停止などのご請求">
        <p>
          本人から、保有個人データの利用目的の通知、開示、内容の訂正・追加・削除、利用の停止・消去、第三者提供の停止、第三者提供記録の開示を求められた場合は、本人であることを確認したうえで、法令に従い遅滞なく対応します。ご請求は、下記のお問い合わせ窓口までメールでご連絡ください。
        </p>
      </Article>

      <Article title="9. プライバシーポリシーの変更">
        <p>
          当方は、法令の改正やサービス内容の変更に合わせて、本ポリシーを変更することがあります。重要な変更を行う場合は、本サービス上での表示またはメールでお知らせします。
        </p>
      </Article>

      <Article title="10. お問い合わせ窓口">
        <dl className="space-y-1">
          <div>事業者:{SITE.operatorLegalName}(屋号:{OP})</div>
          <div>住所:ご請求があった場合、遅滞なく回答いたします。</div>
          <div>メール:{SITE.email}</div>
        </dl>
      </Article>
    </LegalLayout>
  );
}
