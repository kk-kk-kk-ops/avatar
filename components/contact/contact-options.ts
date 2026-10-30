/** お問い合わせの種別（画面とメール送信の両方で使う） */
export const INQUIRY_TYPES = [
  'サービス・機能について',
  '料金・お支払いについて',
  '不具合のご報告',
  'アカウント・解約について',
  '導入のご相談',
  'その他',
] as const;

/** 入力できる文字数の上限 */
export const LIMITS = { name: 50, company: 100, email: 254, message: 3000 } as const;

export type ContactInput = {
  type: string;
  name: string;
  company: string;
  email: string;
  message: string;
};
