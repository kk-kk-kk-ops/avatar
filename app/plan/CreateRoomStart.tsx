"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { startFreeTrial } from "./actions";
import LogoutButton from "@/components/auth/LogoutButton";

// 新規登録者の最初の画面(2026-11変更)。以前は4プランから選ぶ画面
// (PlanSelector.tsx、削除済み)で、freeを選ぶと自動的に無料トライアルが
// 始まる作りだった。今後はこの「ルームを作成」ボタンを押した時だけ
// startFreeTrial()を呼ぶ(app/page.tsxのno-account分岐のコメント参照)。
// 有料プランへのお申し込みは、ルーム作成後に管理画面の請求タブ
// (app/billing/checkout)からいつでも行える。
export default function CreateRoomStart() {
  const { t } = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleCreate = () => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await startFreeTrial();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.push("/");
      } catch {
        setError(t("plan.createRoomGenericError"));
      }
    });
  };

  return (
    <div>
      <h1 className="mb-3 text-lg font-bold text-slate-800">
        {t("plan.createRoomTitle")}
      </h1>
      <p className="mb-6 text-xs leading-6 text-slate-500">
        {t("plan.createRoomDescription")}
      </p>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleCreate}
        disabled={pending}
        className="mb-3 block w-full rounded-lg bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
      >
        {pending ? t("common.processing") : t("plan.createRoomButton")}
      </button>

      <LogoutButton className="block w-full rounded-lg border border-slate-300 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50" />
    </div>
  );
}
