"use client";

import { useState, useTransition } from "react";
import { regenerateInviteToken, updateInviteInviterName } from "./actions";
import { useLocale } from "@/lib/i18n/LocaleContext";

export default function InvitePanel({
  inviteToken,
  inviterName,
}: {
  inviteToken: string;
  inviterName: string;
}) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [savingName, startNameTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState(inviterName);
  const [nameSaved, setNameSaved] = useState(false);

  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/?invite=${inviteToken}`
      : "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t("admin.copyFailed"));
    }
  };

  const handleRegenerate = () => {
    if (!window.confirm(t("admin.regenerateConfirm"))) return;
    setError(null);
    startTransition(async () => {
      try {
        await regenerateInviteToken();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("admin.regenerateFailed"));
      }
    });
  };

  const handleSaveName = () => {
    setError(null);
    setNameSaved(false);
    startNameTransition(async () => {
      try {
        await updateInviteInviterName(nameInput);
        setNameSaved(true);
        setTimeout(() => setNameSaved(false), 2000);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : t("admin.inviterNameUpdateFailed"),
        );
      }
    });
  };

  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-500">
        {t("admin.inviterNameHint")}
      </p>
      <div className="mb-3 flex gap-2">
        <input
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          placeholder={t("admin.inviterNamePlaceholder")}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
        <button
          onClick={handleSaveName}
          disabled={savingName}
          className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {savingName ? t("admin.saving") : nameSaved ? t("admin.saved") : t("admin.save")}
        </button>
      </div>

      <p className="mb-2 mt-4 text-xs font-semibold text-slate-500">{t("admin.inviteUrl")}</p>
      <div className="mb-3 flex gap-2">
        <input
          readOnly
          value={inviteUrl}
          className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none"
        />
        <button
          onClick={handleCopy}
          className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
        >
          {copied ? t("admin.copied") : t("admin.copy")}
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <button
        onClick={handleRegenerate}
        disabled={pending}
        className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
      >
        {t("admin.regenerateUrl")}
      </button>
      <p className="mt-1 text-xs text-red-600">{t("admin.regenerateNote")}</p>
    </div>
  );
}
