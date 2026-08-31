import { DeepFilterNoiseFilterProcessor } from "deepfilternet3-noise-filter";
import { Track, type Room } from "livekit-client";

// 試験導入(2026-08-31): PCマイクのキーボード打鍵音などの突発ノイズが
// 他の参加者に聞こえてしまう問題への対策として、配信前(クライアント側)で
// OSSのノイズ抑制モデル(DeepFilterNet3、WASM・自己完結・音声は外部に
// 出ない)を試験的に適用する。効果検証中の試作のため、このフラグ1つで
// いつでも無効化できるようにしている(問題があればfalseにして再デプロイ
// するだけで元の挙動に戻る)。
export const NOISE_FILTER_ENABLED = true;

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
    });
    await track.setProcessor(filter);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("ノイズ抑制フィルターの適用に失敗しました", err);
  }
}
