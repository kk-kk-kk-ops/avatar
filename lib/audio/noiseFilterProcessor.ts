import { DeepFilterNoiseFilterProcessor } from "deepfilternet3-noise-filter";
import { Track, type Room } from "livekit-client";

// 試験導入(2026-08-31): PCマイクのキーボード打鍵音などの突発ノイズが
// 他の参加者に聞こえてしまう問題への対策として、配信前(クライアント側)で
// OSSのノイズ抑制モデル(DeepFilterNet3、WASM・自己完結・音声は外部に
// 出ない)を試験的に適用する。効果検証中の試作のため、このフラグ1つで
// いつでも無効化できるようにしている(問題があればfalseにして再デプロイ
// するだけで元の挙動に戻る)。
// 2026-10報告: マイクONのたびにこのフィルターがトラックを破棄・再生成
// する仕組みが、文字起こしパイプライン(マイクトラックをWeb Audio APIで
// タップしている)の音声取り込みが時々無音のまま固まる現象の原因だと
// 切り分けで確定した。文字起こし側でTrackEvent.TrackProcessorUpdateを
// 監視してタップし直す対応を追加したが、それでも無音化が再発した
// (このフィルターが生成する処理済みトラックが、Web Audio APIでの読み取り
// 自体とブラウザレベルで相性が悪い可能性が高い)。さらに、このフィルター
// 自体が有効な時、相手の声が不安定で小さくなるという報告もあった。
// 一度falseにしたが、再検証のため再度trueに戻す。上記の問題(無音化・
// 音質劣化)が再発する可能性が高いことを踏まえてテストすること。
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
export async function applyNoiseFilterProcessor(room: Room): Promise<void> {
  if (!NOISE_FILTER_ENABLED) return;
  if (!DeepFilterNoiseFilterProcessor.isSupported()) return;

  const publication = room.localParticipant.getTrackPublication(
    Track.Source.Microphone,
  );
  const track = publication?.audioTrack;
  if (!track) return;

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
