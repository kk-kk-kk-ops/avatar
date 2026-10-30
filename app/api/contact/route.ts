import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { INQUIRY_TYPES, LIMITS } from '@/components/contact/contact-options';

/**
 * お問い合わせの送信処理（サーバー側）
 * 1. Turnstile（ボット対策）の確認
 * 2. 入力内容の確認
 * 3. 運営宛てのメール＋お客様への受付完了メールを、エックスサーバーのメール（SMTP）から送信
 *
 * 必要な環境変数（Vercel の Environment Variables に設定）
 *   TURNSTILE_SECRET_KEY  … Turnstile の秘密鍵（ログイン画面で使っているものと同じでよい）
 *   SMTP_HOST             … 例：sv12345.xserver.jp（エックスサーバーの「メールソフト設定」に記載）
 *   SMTP_PORT             … 465
 *   SMTP_USER             … info@grovina-studio.com
 *   SMTP_PASS             … 上記メールアカウントのパスワード
 *   CONTACT_TO            … 受け取り先（省略時は SMTP_USER）
 */

export const runtime = 'nodejs';

const SERVICE = 'Globy';
const FROM_NAME = 'GROVINA STUDIO（Globy）';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
/** 件名・名前に改行が入るとメールの書式を乗っ取られるので取り除く */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ');

async function verifyTurnstile(token: string, ip: string | null) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !token) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const data = (await res.json().catch(() => null)) as { success?: boolean } | null;
  return data?.success === true;
}

export async function POST(req: Request) {
  let json: Record<string, unknown>;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: '送信内容を読み取れませんでした。' }, { status: 400 });
  }

  // 見えない欄に入力がある＝ボット。成功したふりをして何もしない
  if (str(json.website)) return NextResponse.json({ ok: true });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  if (!(await verifyTurnstile(str(json.token), ip))) {
    return NextResponse.json({ error: 'ボット対策の確認に失敗しました。もう一度お試しください。' }, { status: 400 });
  }

  const type = str(json.type);
  const name = oneLine(str(json.name));
  const company = oneLine(str(json.company));
  const email = str(json.email);
  const message = str(json.message);

  const invalid =
    !INQUIRY_TYPES.includes(type as (typeof INQUIRY_TYPES)[number]) ||
    !name || name.length > LIMITS.name ||
    company.length > LIMITS.company ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > LIMITS.email || /[\r\n]/.test(email) ||
    !message || message.length > LIMITS.message ||
    json.agree !== true;
  if (invalid) return NextResponse.json({ error: '入力内容に誤りがあります。' }, { status: 400 });

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.error('[contact] SMTP の環境変数が設定されていません');
    return NextResponse.json({ error: '現在送信できません。時間をおいてお試しください。' }, { status: 500 });
  }
  const to = process.env.CONTACT_TO || SMTP_USER;
  const port = Number(SMTP_PORT || 465);

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const receivedAt = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const summary = [
    `■ お問い合わせ種別\n${type}`,
    `■ お名前\n${name}`,
    `■ 会社名・団体名\n${company || '（未入力）'}`,
    `■ メールアドレス\n${email}`,
    `■ お問い合わせ内容\n${message}`,
  ].join('\n\n');

  try {
    // 運営宛て（返信ボタンでお客様に返せるよう replyTo を設定）
    await transporter.sendMail({
      from: { name: FROM_NAME, address: SMTP_USER },
      to,
      replyTo: { name, address: email },
      subject: `【${SERVICE} お問い合わせ】${type}／${name} 様`,
      text: `${SERVICE} のお問い合わせフォームから送信がありました。\n受付日時：${receivedAt}\n\n${summary}\n`,
    });

    // お客様宛て（受付完了）
    await transporter.sendMail({
      from: { name: FROM_NAME, address: SMTP_USER },
      to: email,
      subject: `【${SERVICE}】お問い合わせを受け付けました`,
      text: `${name} 様

${SERVICE} へお問い合わせいただき、ありがとうございます。
以下の内容で受け付けました。内容を確認のうえ、担当者よりご連絡いたします。

${summary}

――――――――――――――――――――
※ このメールは送信専用ではありませんが、自動でお送りしています。
※ お心当たりのない場合は、お手数ですがこのメールを破棄してください。

GROVINA STUDIO（${SERVICE} 運営）
https://globy.grovina-studio.com
――――――――――――――――――――
`,
    });
  } catch (err) {
    console.error('[contact] メール送信エラー', err);
    return NextResponse.json({ error: '送信に失敗しました。時間をおいてもう一度お試しください。' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
