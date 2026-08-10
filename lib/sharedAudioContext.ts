// アプリ全体で1つだけ使い回すAudioContext。
// 相手の音声(RemoteAudio)をWeb Audio API経由で再生するために使う。
// <audio>要素での直接再生だと、モバイル(特にiOS Safari)でマイクを
// 同時に使っている間は出力先が受話口(耳に当てる小さいスピーカー)に
// 切り替わってしまい、本体スピーカーから聞こえなくなる問題がある。
// AudioContext.destination経由の再生はこの切り替えの対象にならないため、
// 回避策として使う。
let ctx: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
  }
  return ctx;
}
