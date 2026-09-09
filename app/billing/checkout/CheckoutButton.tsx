"use client";

import { useState, useTransition } from "react";
import { createCheckoutSession } from "./actions";

export default function CheckoutButton({ planId }: { planId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      // 成功時はServer Action内部のredirect()がNext.js側の特別な例外に
      // よって画面遷移させるため、ここは失敗時(ok:falseの戻り値)のみ
      // 到達する。redirect()由来の例外を誤って握りつぶさないよう、
      // ここではtry/catchしない。
      const result = await createCheckoutSession(planId);
      if (result && !result.ok) setError(result.error);
    });
  };

  return (
    <>
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}
      <button
        onClick={handleClick}
        disabled={pending}
        className="block w-full rounded-lg bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
      >
        {pending ? "処理中..." : "お支払いへ進む"}
      </button>
    </>
  );
}
