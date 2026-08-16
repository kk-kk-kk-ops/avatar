"use client";

import { useState, useTransition } from "react";
import type { AccountSummary, PlanId } from "@/lib/types";
import { PLANS } from "@/lib/types";
import { LIVEKIT_SERVERS, DEFAULT_LIVEKIT_SERVER_ID } from "@/lib/livekitServers";
import { updateAccountLivekitServer } from "./actions";

// 契約(アカウント)一覧と、各契約に固定で割り当てられた物理LiveKitサーバーを
// 表示・変更する。単一送信元からの同時接続50人規模でWebARENA Indigo側の
// 遮断が発生することが判明したため、契約は作成時点で固定サーバーに割り当てる
// 方式にしている(deploy/livekit/LOAD_TEST_PLAN.md参照)。同一会社が複数契約
// する場合は、ここで手動に別サーバーへ振り分けることを想定している。
export default function AccountServerAssignment({
  accounts,
}: {
  accounts: AccountSummary[];
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-500">アカウント一覧</p>
      <p className="mb-3 text-xs text-slate-400">
        契約(アカウント)ごとに、実際に接続する物理LiveKitサーバーを固定で割り当てます。
        同一の会社・教室が複数契約している場合は、それぞれ別のサーバーへ割り当ててください
        (同じサーバーに集中すると、単一の共有回線から同時に大人数が接続した際に
        WebARENA Indigo側の通信遮断が起きるリスクがあります)。
      </p>
      {accounts.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
          アカウントがありません
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] text-slate-500">
                <th className="px-3 py-2 font-semibold">名前</th>
                <th className="px-3 py-2 font-semibold">オーナー</th>
                <th className="px-3 py-2 font-semibold">プラン</th>
                <th className="px-3 py-2 font-semibold">作成日</th>
                <th className="px-3 py-2 font-semibold">割り当てサーバー</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <AccountRow key={account.id} account={account} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AccountRow({ account }: { account: AccountSummary }) {
  const [serverId, setServerId] = useState(
    account.livekitServerId ?? DEFAULT_LIVEKIT_SERVER_ID,
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    setServerId(next);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateAccountLivekitServer(account.id, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <tr className="border-b border-slate-50 last:border-0">
      <td className="px-3 py-2 text-slate-700">{account.name}</td>
      <td className="px-3 py-2 text-slate-500">{account.ownerEmail || "—"}</td>
      <td className="px-3 py-2 text-slate-500">
        {PLANS[account.plan as PlanId]?.label ?? account.plan}
      </td>
      <td className="px-3 py-2 text-slate-400">
        {new Date(account.createdAt).toLocaleDateString("ja-JP")}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <select
            value={serverId}
            onChange={handleChange}
            disabled={pending}
            className="rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-slate-500 disabled:opacity-60"
          >
            {LIVEKIT_SERVERS.map((server) => (
              <option key={server.id} value={server.id}>
                {server.label}
              </option>
            ))}
          </select>
          {saved && <span className="text-xs text-emerald-600">保存しました</span>}
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
    </tr>
  );
}
