/**
 * Globy の事業者情報・料金・機能の一元管理ファイル
 * LP・利用規約・プライバシーポリシー・特商法表記はすべてここを参照します。
 * 「【要記入】」が残っている項目は、公開前に必ず正しい内容に置き換えてください。
 *
 * 料金・プラン機能・トライアルの内容は lib/types.ts の PLANS / TRIAL_DAYS を
 * 唯一の情報源として転記している(2026-10)。実際の値を変えたら、まず
 * lib/types.tsとStripeダッシュボードの価格設定を直し、その後このファイルの
 * 該当箇所も揃えること。
 */

export const SITE = {
  serviceName: 'Globy',
  url: 'https://globy.grovina-studio.com',
  loginPath: '/login',
  // 新規登録(無料で始める等)の行き先。TOPページ(/)は未ログイン時にLPへ
  // 転送するようになった(2026-10末)ため、ログイン・新規登録はそれぞれ
  // 専用のURLを使う。
  signupPath: '/signup',
  // 個人事業主は屋号だけでなく本名の表示が必要です
  operatorTradeName: 'グロビナ・スタジオ',
  operatorLegalName: '角井 未来',
  // 個人事業主のため、事業者名(operatorLegalName)=運営責任者であり、
  // 別途「運営責任者」の行は設けない(ユーザー指示により行自体を削除)。
  address: '〒150-0043 東京都渋谷区道玄坂1丁目10番8号 渋谷道玄坂東急ビル2F-C',
  // 電話番号は「請求があれば遅滞なく開示」の文言のまま(すぐに開示できる体制が前提です)
  phone: 'ご請求があった場合、遅滞なく開示いたします。',
  email: 'info@grovina-studio.com',
  supportHours: '平日8:30〜15:30(土日祝・年末年始を除く)',
  studioUrl: 'https://grovina-studio.com/',
  contactUrl: 'https://grovina-studio.com/contact',
  court: '当方の住所地を管轄する地方裁判所',
  enactedAt: '2026年10月21日',
  updatedAt: '2026年10月21日',
} as const;

export type Plan = {
  id: 'free' | 'light' | 'standard' | 'pro';
  name: string;
  /** 税込の月額。未確定なら null */
  monthlyPrice: number | null;
  summary: string;
  features: string[];
  recommended?: boolean;
};

// 料金・人数上限・各種制限はlib/types.tsのPLANS(2026-10時点の実際の設定)から転記。
export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    monthlyPrice: 0,
    summary: 'まずは少人数で試したい方に',
    features: [
      'ミーティングルーム1つ',
      '同時参加人数:5名まで',
      '画面共有・ビデオ通話:1人1日5分まで(音声通話は無制限)',
      'チャット履歴の保管:7日間',
      '画面録画・文字起こし:利用不可',
    ],
  },
  {
    id: 'light',
    name: 'Light',
    monthlyPrice: 2980,
    summary: '小さなチームの毎日の打ち合わせに',
    features: [
      'ミーティングルーム1つ',
      '同時参加人数:10名まで',
      '画面共有・ビデオ通話:1人1日45分まで(音声通話は無制限)',
      'チャット履歴の保管:1か月',
      '画面録画・文字起こし:利用可',
    ],
    recommended: true,
  },
  {
    id: 'standard',
    name: 'Standard',
    monthlyPrice: 5980,
    summary: '社外の人とのやりとりが多いチームに',
    features: [
      'ミーティングルーム1つ',
      '同時参加人数:20名まで',
      '画面共有・ビデオ通話:1人1日120分まで(音声通話は無制限)',
      'チャット履歴の保管:1か月',
      '画面録画・文字起こし:利用可',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthlyPrice: 19800,
    summary: '大人数・長時間の利用に',
    features: [
      'ミーティングルーム1つ',
      '同時参加人数:50名まで',
      '画面共有・ビデオ通話・音声通話:すべて無制限',
      'チャット履歴の保管:3か月',
      '画面録画・文字起こし:利用可',
    ],
  },
];

/**
 * 無料トライアル。lib/types.tsのTRIAL_DAYS(30日)・app/plan/actions.tsの
 * startFreeTrial()の実際の挙動に合わせた文言(2026-10確認)。
 * 重要:トライアル終了時にカードへ自動課金されることはない。期間中に
 * ユーザー自身が有料プランへお申し込み(決済)しない限り、終了後は自動的に
 * Freeプランの内容に切り替わるだけで、料金は一切発生しない。
 * (期間中にお申し込みいただいた場合は、お申し込み時点から課金が始まり、
 * 残りのトライアル期間は消化されずに終了する)
 */
export const TRIAL = {
  enabled: true,
  description:
    'Standardプラン相当の内容を、初回登録から30日間、クレジットカードの登録なしで無料でお試しいただけます。トライアル期間中に有料プランへお申し込み(決済手続き)されなかった場合、料金が発生することは一切なく、トライアル終了後は自動的にFreeプランの内容に切り替わります。トライアル期間中に有料プランへお申し込みいただいた場合は、お申し込み時点から当該プランの料金が発生します。',
};

export const BILLING = {
  cycle: '1か月ごとの自動更新',
  paymentMethod: 'クレジットカード(決済代行:Stripe)',
  cancelHow: 'ログイン後、管理画面の「契約情報」からいつでも解約手続きができます。',
  cancelRule:
    '解約手続き後も、お支払い済みの契約期間の末日までご利用いただけます。次回以降の請求は発生しません。',
  refundRule:
    'お支払い済みの料金は、契約期間の途中で解約された場合でも、日割りを含め返金いたしません(法令により返金が必要な場合を除きます)。',
  planChangeRule:
    'プランの変更(アップグレード)をされた場合、変更時点から新しいプランの料金が適用され、変更前のプランとの差額を日割りで計算し、直ちにご請求いたします。プランの変更(ダウングレード)をされた場合は、現在ご契約中の期間の終了時点(次回更新日)から新しいプランの料金が適用されます。期間途中でのダウングレードに伴う差額の返金は行いません。',
};

/** LP に表示する機能。リリース時点で提供していない機能は削除してください */
export const FEATURES = [
  {
    title: 'ブラウザだけで会議',
    body: 'アプリのインストールは不要です。リンクを開けば、映像と音声ですぐにつながれます。',
  },
  {
    title: '画面共有',
    body: '資料やデザインをその場で見せながら話せます。',
  },
  {
    title: 'チャットとDM',
    body: 'グループ、個別メッセージ、メンション、リアクション、画像の送信に対応しています。',
  },
  {
    title: 'ゲストはリンクで参加',
    body: '社外の人には招待リンクを送るだけ。相手にアカウントを作ってもらう必要はありません。',
  },
  {
    // 2026-10時点で提供済み(画面録画+自動文字起こし)。録画・文字起こしは
    // 利用者のブラウザにローカル保存される方式で、Globyのサーバーには
    // 保存されない(components/RecordButton.tsx・AvatarSpace.tsxのdownloadBlob参照)。
    title: '会議の文字起こし',
    body: '発言をテキストで残せます。議事録づくりの下書きに使えます。',
  },
  {
    title: '守られたログイン',
    body: '2段階認証とボット対策で、なりすましや不正ログインを防ぎます。',
  },
];

export const yen = (n: number | null) =>
  n === null ? '【要記入】' : `${n.toLocaleString('ja-JP')}円`;

/** GROVINA STUDIO のサイトと共通のブランド設定(2026-10) */
export const BRAND = {
  font: 'Helvetica, "YuGothic", "Yu Gothic", sans-serif',
  red: '#E5342E',
  paleRed: '#F8B6B7',
  sns: [
    { label: 'LINE', href: 'https://line.me/ti/p/%40332orjgu', icon: '/grovina/icon-line.png' },
    { label: 'Instagram', href: 'https://www.instagram.com/grovina_studio/', icon: '/grovina/icon-insta.png' },
    { label: 'X', href: 'https://x.com/Grovina_studio', icon: '/grovina/icon-x.png' },
  ],
} as const;
