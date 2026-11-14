"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PlayerState, Room } from "@/lib/types";
import { useCurrentVersionInfo } from "@/lib/useCurrentVersionInfo";

// マスター向けのオンライン人数表示。ルームごとの内訳は不要とのことなので
// 合計のみ表示し、代わりに通信量把握のためマイク・ビデオ通話・画面共有を
// それぞれ何人が使っているかを表示する。
export default function MasterOnlineStats({ rooms }: { rooms: Room[] }) {
  // presenceの生エントリだけをstateに持ち、人数の集計(stats)は下で
  // レンダー時に算出する。段階0(docs/realtime-authorization-plan.md
  // 6-2節)でversion.jsonを取得し直した際にも、チャンネルを再購読せずに
  // 集計だけ再計算されるようにするため(app/admin/OnlineCount.tsxと同じ
  // 考え方に揃えた)。
  const [entriesByRoom, setEntriesByRoom] = useState<
    Record<string, PlayerState[]>
  >({});

  // 段階0。「現在の本番」がどのデプロイ・世代かを把握するため、
  // version.jsonを定期的に取得する(閲覧者自身のタブが古い場合に基準が
  // ずれないよう、閲覧者自身の値は使わない)。
  const currentVersion = useCurrentVersionInfo();

  // roomsはサーバーコンポーネント側で毎回新しい配列として生成されるため、
  // このページでrevalidatePathが呼ばれるたびに(ルームの中身自体は
  // 変わっていなくても)参照が変わる。依存配列にrooms自体を使うとその都度
  // 全チャンネルを張り直してしまい、再購読の間だけオンライン人数が0に
  // リセットされて見える(点滅する)不具合の原因になっていた
  // (2026-09 QA指摘。app/admin/OnlineCount.tsxで先に対策済みの同じ不具合
  // パターン)。ルームID列という「内容が変わった時だけ変化する値」に
  // 依存させる。
  const roomIds = rooms.map((room) => room.id).join(",");

  useEffect(() => {
    // 購読し直すたびに空にする。ルーム一覧が変わった時、前回の購読分が
    // 消えたルームの在室者として残り続け、合計が実際より多くなる不具合を
    // 防ぐため(2026-11-14指摘)。
    setEntriesByRoom({});
    if (rooms.length === 0) {
      return;
    }
    const supabase = createClient();
    const channels = rooms.map((room) => {
      const channel = supabase.channel(`avatar-room-${room.id}`, {
        config: { presence: { key: `observer-${crypto.randomUUID()}` } },
      });
      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState<PlayerState>();
          const entries = Object.values(state)
            .map((list) => list[0])
            .filter(Boolean);
          setEntriesByRoom((prev) => ({ ...prev, [room.id]: entries }));
        })
        .subscribe();
      return channel;
    });

    return () => {
      channels.forEach((channel) => supabase.removeChannel(channel));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomIds]);

  const allEntries = Object.values(entriesByRoom).flat();

  // 段階0: 版不明(段階0導入前から開かれていたタブ)/世代が古い/
  // デプロイIDが現在の本番と異なる人数を分けて数える(設計書6-2節)。
  const versionCounts = allEntries.reduce(
    (acc, p) => {
      if (typeof p.buildGeneration !== "number" || p.deploymentId === undefined) {
        acc.versionUnknown += 1;
        return acc;
      }
      if (currentVersion && p.buildGeneration < currentVersion.buildGeneration) {
        acc.oldGeneration += 1;
      }
      if (
        currentVersion?.deploymentId &&
        p.deploymentId !== currentVersion.deploymentId
      ) {
        acc.deployMismatch += 1;
      }
      return acc;
    },
    { versionUnknown: 0, oldGeneration: 0, deployMismatch: 0 },
  );

  const stats = {
    total: allEntries.length,
    mic: allEntries.filter((p) => p.micOn).length,
    video: allEntries.filter((p) => p.inCall).length,
    screen: allEntries.filter((p) => p.sharingScreen).length,
    watching: allEntries.filter((p) => p.watchingScreen).length,
  };

  return (
    <div className="rounded-xl border border-slate-200 p-6">
      <div className="grid grid-cols-5 gap-3 text-center">
        <div>
          <p className="text-lg font-bold text-slate-800">{stats.total}人</p>
          <p className="text-[11px] text-slate-500">オンライン人数</p>
        </div>
        <div>
          <p className="text-lg font-bold text-slate-800">{stats.mic}人</p>
          <p className="text-[11px] text-slate-500">音声通話中</p>
        </div>
        <div>
          <p className="text-lg font-bold text-slate-800">{stats.video}人</p>
          <p className="text-[11px] text-slate-500">ビデオ通話中</p>
        </div>
        <div>
          <p className="text-lg font-bold text-slate-800">{stats.screen}人</p>
          <p className="text-[11px] text-slate-500">画面共有中</p>
        </div>
        <div>
          <p className="text-lg font-bold text-slate-800">{stats.watching}人</p>
          <p className="text-[11px] text-slate-500">画面共有視聴中</p>
        </div>
      </div>
      <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
        デプロイIDが現行と違う: {versionCounts.deployMismatch}人 / 世代が古い:{" "}
        {versionCounts.oldGeneration}人 / 版不明: {versionCounts.versionUnknown}人
      </p>
    </div>
  );
}
