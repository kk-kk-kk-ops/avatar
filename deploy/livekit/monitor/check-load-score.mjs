// 負荷スコアを定期的に計算し、閾値(300/600/900/1200)を新たに超えた場合
// だけWebhook通知(Slack Incoming Webhook想定)を送るスクリプト。
//
// 負荷スコアの算出は、マスター画面(app/master/MasterOnlineStats.tsx)と
// 全く同じ考え方で行う。LiveKitのサーバーAPIでは「誰が誰の画面共有を
// 視聴中か」までは取れないため、既存のSupabase Realtime presence
// (avatar-room-{roomId}チャンネル)を直接購読して集計する
// (video×1 + screen×20 + watching×17。重みは実測帯域
// (送信最大約3.1Mbps、受信最大約625kbps〜2.5Mbps、ビデオ通話150kbps)を
// 踏まえて設定。deploy/livekit/LOAD_TEST_PLAN.md参照)。
//
// 実行方法(WebARENA Indigo等、任意のサーバーでcron実行を想定):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SLACK_WEBHOOK_URL=... \
//     node check-load-score.mjs
//   例: */2 * * * * のcronで2分おきに実行する
//
// 必須の環境変数:
//   SUPABASE_URL              SupabaseプロジェクトのURL
//   SUPABASE_SERVICE_ROLE_KEY service_role キー(roomsテーブル参照・
//                              presence購読に使う。anonキーではRLSに
//                              阻まれる場合があるため service_role を推奨)
//   SLACK_WEBHOOK_URL          通知先のIncoming Webhook URL(省略時は
//                              標準出力にログを出すだけになる)
//
// 「新たに超えた場合だけ」通知するため、直近に通知した段階(tier)を
// state.jsonに保存しておく(同じ段階のままなら再通知しない。閾値を
// 下回って落ち着いた場合はtierが下がり、次に再度超えたら再通知される)。

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(__dirname, "state.json");

// スコアがこの値を「超えたら」その段階のVPS台数にする、という閾値
// (ユーザー指定の仕様通り)。
const THRESHOLDS = [
  { overScore: 1200, nodes: 5 },
  { overScore: 900, nodes: 4 },
  { overScore: 600, nodes: 3 },
  { overScore: 300, nodes: 2 },
];

function tierForScore(score) {
  const hit = THRESHOLDS.find((t) => score > t.overScore);
  return hit ? hit.nodes : 1;
}

function loadState() {
  if (!existsSync(STATE_PATH)) return { lastNotifiedTier: 1 };
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return { lastNotifiedTier: 1 };
  }
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function notify(message) {
  console.log(message);
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  }).catch((err) => {
    console.error("Webhook通知の送信に失敗しました", err);
  });
}

// 1ルーム分のpresence状態を取得する(sync完了を短時間だけ待つ)。
function fetchRoomPresence(supabase, roomId) {
  return new Promise((resolve) => {
    const channel = supabase.channel(`avatar-room-${roomId}`, {
      config: { presence: { key: `monitor-${roomId}` } },
    });
    const timeout = setTimeout(() => {
      supabase.removeChannel(channel);
      resolve([]);
    }, 5000);

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const entries = Object.values(state)
          .map((list) => list[0])
          .filter(Boolean);
        clearTimeout(timeout);
        supabase.removeChannel(channel);
        resolve(entries);
      })
      .subscribe();
  });
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が設定されていません",
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: rooms, error } = await supabase.from("rooms").select("id");
  if (error) {
    console.error("roomsの取得に失敗しました", error);
    process.exit(1);
  }

  let video = 0;
  let screen = 0;
  let watching = 0;

  for (const room of rooms ?? []) {
    const entries = await fetchRoomPresence(supabase, room.id);
    entries.forEach((p) => {
      if (p.inCall) video += 1;
      if (p.sharingScreen) screen += 1;
      if (p.watchingScreen) watching += 1;
    });
  }

  const loadScore = video * 1 + screen * 20 + watching * 17;
  const requiredNodes = tierForScore(loadScore);

  console.log(
    `[load-score] video=${video} screen=${screen} watching=${watching} score=${loadScore} requiredNodes=${requiredNodes}`,
  );

  const state = loadState();
  if (requiredNodes !== state.lastNotifiedTier) {
    const direction = requiredNodes > state.lastNotifiedTier ? "増設" : "縮小";
    await notify(
      `[Globy 負荷アラート] 負荷スコアが${loadScore}になりました。推奨VPS台数: ${requiredNodes}台(${direction}を検討してください)`,
    );
    saveState({ lastNotifiedTier: requiredNodes });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
