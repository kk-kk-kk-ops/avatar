'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import TurnstileWidget, { type TurnstileWidgetHandle } from '@/components/TurnstileWidget';
import { INQUIRY_TYPES, LIMITS, type ContactInput } from './contact-options';

/**
 * お問い合わせフォーム(入力 → 確認 → 完了 の3ステップ)
 * ボット対策のCloudflare Turnstileは、ログイン画面(components/auth/LoginCard.tsx)
 * と同じ共通コンポーネント(components/TurnstileWidget.tsx)を使い、確認画面でだけ表示する
 * (入力に時間がかかっても期限切れにならないように)。
 */

const RED = '#D80003';
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

const EMPTY: ContactInput = { type: '', name: '', company: '', email: '', message: '' };
type Step = 'input' | 'confirm' | 'done';
type Errors = Partial<Record<keyof ContactInput | 'agree', string>>;

function validate(v: ContactInput, agree: boolean): Errors {
  const e: Errors = {};
  if (!INQUIRY_TYPES.includes(v.type as (typeof INQUIRY_TYPES)[number])) e.type = 'お問い合わせ種別を選んでください。';
  if (!v.name.trim()) e.name = 'お名前を入力してください。';
  else if (v.name.length > LIMITS.name) e.name = `${LIMITS.name}文字以内で入力してください。`;
  if (v.company.length > LIMITS.company) e.company = `${LIMITS.company}文字以内で入力してください。`;
  if (!v.email.trim()) e.email = 'メールアドレスを入力してください。';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) || v.email.length > LIMITS.email)
    e.email = 'メールアドレスの形式が正しくありません。';
  if (!v.message.trim()) e.message = 'お問い合わせ内容を入力してください。';
  else if (v.message.length > LIMITS.message) e.message = `${LIMITS.message}文字以内で入力してください。`;
  if (!agree) e.agree = 'プライバシーポリシーへの同意が必要です。';
  return e;
}

export function ContactForm() {
  const [step, setStep] = useState<Step>('input');
  const [values, setValues] = useState<ContactInput>(EMPTY);
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [token, setToken] = useState<string | null>(null);
  const [captchaLoadError, setCaptchaLoadError] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [honeypot, setHoneypot] = useState(''); // ボットだけが入力する見えない欄
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);
  const resetCaptcha = () => {
    turnstileRef.current?.reset();
    setToken(null);
  };

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  const set = (key: keyof ContactInput) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [key]: ev.target.value }));

  const toConfirm = (ev: React.FormEvent) => {
    ev.preventDefault();
    const e = validate(values, agree);
    setErrors(e);
    if (Object.keys(e).length === 0) setStep('confirm');
  };

  const send = async () => {
    if (!token || sending) return;
    setSending(true);
    setSendError('');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, agree, token, website: honeypot }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? '送信に失敗しました。');
      }
      setStep('done');
      setValues(EMPTY);
      setAgree(false);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : '送信に失敗しました。');
      resetCaptcha();
    } finally {
      setSending(false);
    }
  };

  const inputCls = (bad?: string) =>
    `w-full rounded-md border bg-white px-4 py-3 text-base text-[#222] outline-none transition-colors focus:border-[#D80003] focus:ring-2 focus:ring-[#D80003]/15 ${
      bad ? 'border-[#D80003]' : 'border-[#d9d9d9]'
    }`;

  return (
    <>
      <Steps current={step} />

      {step === 'input' && (
        <form onSubmit={toConfirm} noValidate className="mt-10 space-y-8">
          <Field label="お問い合わせ種別" required error={errors.type} htmlFor="type">
            <div className="relative">
              <select id="type" value={values.type} onChange={set('type')} className={`${inputCls(errors.type)} appearance-none pr-10`}>
                <option value="">選択してください</option>
                {INQUIRY_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <svg aria-hidden="true" width="12" height="8" viewBox="0 0 12 8" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">
                <path d="M1 1l5 5 5-5" fill="none" stroke="#555" strokeWidth="1.6" />
              </svg>
            </div>
          </Field>

          <Field label="お名前" required error={errors.name} htmlFor="name">
            <input id="name" type="text" autoComplete="name" maxLength={LIMITS.name} value={values.name} onChange={set('name')} placeholder="山田 太郎" className={inputCls(errors.name)} />
          </Field>

          <Field label="会社名・団体名" error={errors.company} htmlFor="company">
            <input id="company" type="text" autoComplete="organization" maxLength={LIMITS.company} value={values.company} onChange={set('company')} className={inputCls(errors.company)} />
          </Field>

          <Field
            label="メールアドレス"
            required
            error={errors.email}
            htmlFor="email"
            note="Globy にご登録済みの方は、登録しているメールアドレスを入力いただくと確認がスムーズです。"
          >
            <input id="email" type="email" autoComplete="email" inputMode="email" maxLength={LIMITS.email} value={values.email} onChange={set('email')} placeholder="example@example.com" className={inputCls(errors.email)} />
          </Field>

          <Field
            label="お問い合わせ内容"
            required
            error={errors.message}
            htmlFor="message"
            note={values.type === '不具合のご報告' ? '発生した日時、操作の手順、お使いのブラウザ(Chrome / Edge / Safari など)をお書きください。' : undefined}
          >
            <textarea id="message" rows={8} maxLength={LIMITS.message} value={values.message} onChange={set('message')} className={`${inputCls(errors.message)} resize-y leading-relaxed`} />
            <p className="mt-1 text-right text-xs text-[#888]">{values.message.length} / {LIMITS.message}</p>
          </Field>

          {/* ボット対策:人には見えない欄。入力があれば送信を無視します */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>
              ウェブサイト
              <input type="text" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
            </label>
          </div>

          <div>
            <label className="flex cursor-pointer items-start justify-center gap-3 text-[15px] text-[#222]">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#D80003]" />
              <span>
                <Link href="/privacy" target="_blank" className="underline underline-offset-2" style={{ color: RED }}>プライバシーポリシー</Link>
                に同意する
              </span>
            </label>
            {errors.agree && <p className="mt-2 text-center text-sm" style={{ color: RED }}>{errors.agree}</p>}
          </div>

          <div className="text-center">
            <PrimaryButton type="submit">入力内容を確認する</PrimaryButton>
          </div>
        </form>
      )}

      {step === 'confirm' && (
        <div className="mt-10">
          <p className="text-center text-[15px] text-[#444]">以下の内容で送信します。よろしければ「送信する」を押してください。</p>
          <dl className="mt-8 divide-y divide-[#eee] border-y border-[#eee]">
            <Row label="お問い合わせ種別" value={values.type} />
            <Row label="お名前" value={values.name} />
            <Row label="会社名・団体名" value={values.company || '(未入力)'} />
            <Row label="メールアドレス" value={values.email} />
            <Row label="お問い合わせ内容" value={values.message} multiline />
          </dl>

          <div className="mt-8 flex justify-center">
            <TurnstileWidget
              ref={turnstileRef}
              onVerify={(t) => setToken(t)}
              onError={() => setCaptchaLoadError(true)}
            />
          </div>
          {!SITE_KEY && <p className="mt-2 text-center text-sm" style={{ color: RED }}>Turnstile のサイトキーが設定されていません。</p>}
          {captchaLoadError && (
            <p className="mt-2 text-center text-sm" style={{ color: RED }}>
              ボット対策の読み込みに失敗しました。時間をおいて再度お試しください。
            </p>
          )}
          {sendError && <p role="alert" className="mt-4 text-center text-sm" style={{ color: RED }}>{sendError}</p>}

          <div className="mt-8 flex flex-col-reverse items-center justify-center gap-4 sm:flex-row">
            <button
              type="button"
              onClick={() => setStep('input')}
              disabled={sending}
              className="h-[56px] w-full max-w-[240px] rounded-full border border-[#ccc] bg-white text-[15px] font-bold text-[#444] transition-colors hover:bg-[#f7f7f7] disabled:opacity-50"
            >
              入力画面に戻る
            </button>
            <PrimaryButton type="button" onClick={send} disabled={!token || sending}>
              {sending ? '送信しています…' : '送信する'}
            </PrimaryButton>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="mt-12 text-center">
          <p className="text-xl font-bold text-[#111]">お問い合わせを受け付けました</p>
          <p className="mt-6 text-[15px] leading-loose text-[#444]">
            ご入力いただいたメールアドレスに、受付完了のメールをお送りしました。
            <br />
            内容を確認のうえ、担当者よりご連絡いたします。
            <br className="hidden sm:inline" />
            メールが届かない場合は、迷惑メールフォルダもご確認ください。
          </p>
          <div className="mt-10">
            <Link href="/lp" className="text-[15px] font-bold underline underline-offset-4" style={{ color: RED }}>
              トップページに戻る
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

function Steps({ current }: { current: Step }) {
  const list: { key: Step; label: string }[] = [
    { key: 'input', label: '入力' },
    { key: 'confirm', label: '確認' },
    { key: 'done', label: '完了' },
  ];
  const idx = list.findIndex((s) => s.key === current);
  return (
    <ol className="mx-auto flex max-w-[360px] items-center justify-between" aria-label="お問い合わせの手順">
      {list.map((s, i) => (
        <li key={s.key} className="flex flex-1 items-center last:flex-none" aria-current={i === idx ? 'step' : undefined}>
          <span className="flex flex-col items-center gap-1.5">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold"
              style={i <= idx ? { backgroundColor: RED, color: '#fff' } : { backgroundColor: '#eee', color: '#999' }}
            >
              {i + 1}
            </span>
            <span className="text-xs font-bold" style={{ color: i <= idx ? RED : '#999' }}>{s.label}</span>
          </span>
          {i < list.length - 1 && <span className="mx-2 mb-5 h-px flex-1" style={{ backgroundColor: i < idx ? RED : '#ddd' }} />}
        </li>
      ))}
    </ol>
  );
}

function Field({ label, required, error, note, htmlFor, children }: { label: string; required?: boolean; error?: string; note?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-2 flex items-center gap-2 text-[15px] font-bold text-[#222]">
        {label}
        <span className="rounded px-1.5 py-0.5 text-[11px] font-bold leading-none" style={required ? { backgroundColor: RED, color: '#fff' } : { backgroundColor: '#eee', color: '#777' }}>
          {required ? '必須' : '任意'}
        </span>
      </label>
      {children}
      {note && <p className="mt-2 text-[13px] leading-relaxed text-[#777]">{note}</p>}
      {error && <p className="mt-2 text-sm" style={{ color: RED }}>{error}</p>}
    </div>
  );
}

function Row({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className="grid gap-1 py-4 sm:grid-cols-[180px_1fr] sm:gap-6">
      <dt className="text-sm font-bold text-[#666]">{label}</dt>
      <dd className={`text-[15px] text-[#222] ${multiline ? 'whitespace-pre-wrap break-words leading-relaxed' : 'break-all'}`}>{value}</dd>
    </div>
  );
}

function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="h-[56px] w-full max-w-[320px] rounded-full text-[15px] font-bold text-white transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
      style={{ backgroundColor: RED, outlineColor: RED }}
    />
  );
}
