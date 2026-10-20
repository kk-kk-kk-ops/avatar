"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

// Cloudflare Turnstile(ボット判定)。サイトキーは環境変数
// NEXT_PUBLIC_TURNSTILE_SITE_KEY で渡す(クライアントに露出してよい値。
// 秘密鍵はSupabase側(Authentication > Attack Protection > Captcha
// protection)に設定し、実際のトークン検証はSupabaseが行う。このコン
// ポーネントはトークンを取得してonVerifyへ渡すだけでよい)。
// サイトキー未設定時はローカル開発で困らないよう、ウィジェット自体を
// 描画しない(呼び出し側はcaptchaTokenがundefinedのまま送信することになる。
// 本番ではVercelの環境変数に必ず設定すること)。
declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const SCRIPT_ID = "cf-turnstile-script";

export type TurnstileWidgetHandle = {
  reset: () => void;
};

const TurnstileWidget = forwardRef<
  TurnstileWidgetHandle,
  { onVerify: (token: string | null) => void; onError?: () => void }
>(function TurnstileWidget({ onVerify, onError }, ref) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  // onVerify/onErrorが呼び出し側の再レンダーのたびに新しい関数になっても、
  // 既にrender済みのウィジェットを作り直さずに済むようrefで持つ。
  const onVerifyRef = useRef(onVerify);
  onVerifyRef.current = onVerify;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
      }
    },
  }));

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;

    const renderWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token) => onVerifyRef.current(token),
        "expired-callback": () => onVerifyRef.current(null),
        "error-callback": () => {
          onVerifyRef.current(null);
          onErrorRef.current?.();
        },
      });
    };

    const handleScriptError = () => {
      if (cancelled) return;
      onErrorRef.current?.();
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      const existingScript = document.getElementById(SCRIPT_ID);
      if (existingScript) {
        existingScript.addEventListener("load", renderWidget);
        existingScript.addEventListener("error", handleScriptError);
      } else {
        const script = document.createElement("script");
        script.id = SCRIPT_ID;
        script.src = SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.addEventListener("load", renderWidget);
        script.addEventListener("error", handleScriptError);
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey]);

  if (!siteKey) return null;

  return <div ref={containerRef} className="flex justify-center" />;
});

export default TurnstileWidget;
