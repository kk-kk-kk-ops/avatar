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
