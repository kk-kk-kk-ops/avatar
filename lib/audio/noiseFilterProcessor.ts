import { DeepFilterNoiseFilterProcessor } from "deepfilternet3-noise-filter";
import { Track, type Room } from "livekit-client";

// 試験導入(2026-08-31): PCマイクのキーボード打鍵音などの突発ノイズが
// 他の参加者に聞こえてしまう問題への対策として、配信前(クライアント側)で
// OSSのノイズ抑制モデル(DeepFilterNet3、WASM・自己完結・音声は外部に
// 出ない)を試験的に適用する。
// 2026-10報告: マイクONのたびにこのフィルターがトラックを破棄・再生成
// する仕組みが、文字起こしパイプライン(マイクトラックをWeb Audio APIで
// タップしている)の音声取り込みが時々無音のまま固まる現象の原因だった
// (真因は別の競合状態で解決済み、詳細はtoggleMic参照)。本当に効果が
// 不安定(環境によって聞こえ方の好みが分かれる)な機能のため、ビルド時
// フラグでの一律ON/OFFではなく、設定画面のチェックボックスでユーザーが
// その場で切り替えられるようにした(2026-10追加、noiseFilterEnabled
// state・AvatarSpace.tsx参照)。
export const NOISE_FILTER_ENABLED = true;

// パッケージのREADMEは「デフォルトでバンドル済みアセットを使う」と
// 書かれているが、実際のv1.3.0ソースコードはWASM本体(約16MB)とONNX
// モデル(約8MB)を配布元の外部CDN(cdn.mezon.ai)からfetchする実装に
// なっており、当該CDNがCORSヘッダーを返さないため本番ドメインから
// 読み込めず「ノイズ抑制フィルターの適用に失敗しました」で毎回
// フォールバックしていた(2026-08-31判明)。同じファイルをpublic/配下
// (Next.jsの静的配信、同一オリジン)に自前ホストし、cdnUrlをそちらへ
// 差し替えることでCORSを回避する。
const ASSET_BASE_URL = "/df3-assets";

// マイクONのたびに(トラックが破棄・再生成されるため)呼び直す想定。
// 失敗してもマイク自体は通常通り使えるよう、必ずtry/catchで包んで
// 呼び出し元の処理を止めないこと。
// enabled=false時は、既に適用済みのフィルターがあればstopProcessor()で
// 取り除く(設定画面のチェックボックスでその場でOFFにした場合に対応)。
export async function applyNoiseFilterProcessor(
  room: Room,
  enabled: boolean = true,
): Promise<void> {
  const publication = room.localParticipant.getTrackPublication(
    Track.Source.Microphone,
  );
  const track = publication?.audioTrack;
  if (!track) return;

  if (!NOISE_FILTER_ENABLED || !enabled) {
    try {
      if (track.getProcessor()) {
        await track.stopProcessor();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("ノイズ抑制フィルターの解除に失敗しました", err);
    }
    return;
  }
  if (!DeepFilterNoiseFilterProcessor.isSupported()) return;

  try {
    const filter = new DeepFilterNoiseFilterProcessor({
      sampleRate: 48000,
      noiseReductionLevel: 80,
      enabled: true,
      assetConfig: { cdnUrl: ASSET_BASE_URL },
    });
    await track.setProcessor(filter);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("ノイズ抑制フィルターの適用に失敗しました", err);
  }
}
