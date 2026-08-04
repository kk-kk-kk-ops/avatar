"use client";

import { useState, useTransition } from "react";
import { regenerateInviteToken } from "./actions";

export default function InvitePanel({ inviteToken }: { inviteToken: string }) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
      setError("コピーに失敗しました。手動で選択してコピーしてください。");
    }
  };

  const handleRegenerate = () => {
    if (
      !window.confirm(
        "招待URLを再発行します。今のURLは無効になりますが、よろしいですか?",
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      try {
        await regenerateInviteToken();
      } catch (e) {
        setError(e instanceof Error ? e.message : "再発行に失敗しました");
      }
    });
  };

  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-slate-500">招待URL</p>
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
          {copied ? "コピーしました" : "コピー"}
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
        className="rounded-lg bg-red-50 px-4 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:opacity-60"
      >
        URLを再発行(古いURLは無効になります)
      </button>
    </div>
  );
}
