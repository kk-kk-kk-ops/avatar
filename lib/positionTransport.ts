// アバター位置情報(move)の配信経路を切り替える唯一のスイッチ。
// lib/livekitServers.tsと同じ「コードが唯一の情報源」方針で、DBの列は
// 増やさず環境変数で切り替える(2026-11設計レビューの結論)。
//
// "supabase"(既定): 従来通りSupabase Realtime Broadcastでmoveを配信する。
// "indigo"         : 新設のIndigoPro WebSocketサーバー(deploy/
//                    indigo-position-ws/)へmoveのみを配信する。presence・
//                    チャット等の他イベントはこのフラグに関わらず常に
//                    Supabaseのまま(第1段階の対象はmoveのみ)。
//
// 環境変数が未設定、または"indigo"以外の値の場合は必ず"supabase"になる
// (本番は当面この環境変数自体を設定しないため、デフォルトで従来と
// 完全に同じ動作のままになる)。
export type PositionTransport = "supabase" | "indigo";

export const POSITION_TRANSPORT: PositionTransport =
  process.env.NEXT_PUBLIC_POSITION_TRANSPORT === "indigo"
    ? "indigo"
    : "supabase";

// indigoモード専用のmove定期送信間隔(ms、2026-11追加)。Supabase側の
// 送信間隔(約70ms=14.3回/秒、components/AvatarSpace.tsxの移動ループに
// ハードコードされたまま、indigoモード追加に合わせて変更していない)とは
// 完全に独立しており、indigoモードの挙動にしか影響しない。既定は100ms
// (10回/秒、2026-11設計レビューの結論)。
// NEXT_PUBLIC_MOVE_SEND_INTERVAL_MSで本番の値を調整できる(「頻度の値は
// 設定ファイルで変更できるようにする」という要件)。
const DEFAULT_MOVE_SEND_INTERVAL_MS = 100;

function envMoveSendIntervalMs(): number {
  const raw = process.env.NEXT_PUBLIC_MOVE_SEND_INTERVAL_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MOVE_SEND_INTERVAL_MS;
}

// 14.3Hz(Supabase相当)と10Hz(indigo既定)の見え方を同じブラウザで比較
// できるよう、開発確認用にlocalStorageでの一時的な上書きを許可する
// (globy-debug-move-interval-ms、例: ブラウザのコンソールで
// `localStorage.setItem("globy-debug-move-interval-ms", "70")` としてから
// ページを再読み込みすると、indigoモードでも70ms間隔になる)。本番の
// 挙動には影響しない想定の開発者向け確認手段であり、通常は未設定。
function resolveMoveSendIntervalMs(): number {
  if (typeof window !== "undefined") {
    try {
      const override = window.localStorage.getItem(
        "globy-debug-move-interval-ms",
      );
      if (override) {
        const n = Number(override);
        // 50ms未満は過大な送信頻度につながるため無視する(Tech Lead指摘)。
        if (Number.isFinite(n) && n >= 50) return n;
      }
    } catch {
      // プライベートウィンドウ等でlocalStorageが使えない場合は既定値のまま
    }
  }
  return envMoveSendIntervalMs();
}

export const MOVE_SEND_INTERVAL_MS = resolveMoveSendIntervalMs();
