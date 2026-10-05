// マイク音声の取り込み専用AudioWorkletProcessor(2026-10追加)。
//
// 文字起こし(sherpa-onnx)のVAD+decode()はメインスレッド上で行うため、
// 処理中はメインスレッドが長時間塞がることがある。以前はマイクの取り込み
// 自体も(非推奨の)ScriptProcessorNodeでメインスレッド上で行っていたため、
// decode()中に届いた音声フレームがそのまま丸ごと欠落していた
// (「普通に話すと文字起こしが結構飛んでいる」報告)。
//
// AudioWorkletProcessorはメインスレッドとは別の専用オーディオレンダリング
// スレッド上で動作するため、メインスレッドがどれだけ塞がっていても
// process()の呼び出し自体は欠落しない。ここでは最低限の処理(一定量まで
// まとめてメインスレッドへpostMessageするだけ)に留め、ダウンサンプリング
// 等の処理は(軽いので)メインスレッド側に任せる。
class MicCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._chunks = [];
    this._length = 0;
    // 128サンプル(1クオンタム)ごとにpostMessageすると呼び出し過多になる
    // ため、ある程度まとめてから送る。2026-10報告: iPhone(Safari)で
    // マイクOFFにした瞬間、このワークレット自体が(iOS側のオーディオ
    // セッション変更に伴い)即座にサスペンドされ、まだpostMessageしていない
    // 分の音声がそのまま失われる現象が疑われる。4096サンプル(約85ms@48kHz)
    // だと直前の発言の末尾がまとまって失われるリスクがあるため、1024
    // サンプル(約21ms)まで小さくし、取りこぼしても被害を最小限にする
    // (postMessageの呼び出し頻度は上がるが、1回あたりのデータ量が小さい
    // ため負荷は軽微)。
    this._postThreshold = 1024;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (channel && channel.length > 0) {
      this._chunks.push(channel.slice());
      this._length += channel.length;
      if (this._length >= this._postThreshold) {
        const merged = new Float32Array(this._length);
        let offset = 0;
        for (const chunk of this._chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        this._chunks = [];
        this._length = 0;
        this.port.postMessage(merged);
      }
    }
    // falseを返すとブラウザ側がこのノードを破棄してしまうため、常にtrue
    // を返して処理を継続させる。
    return true;
  }
}

registerProcessor("mic-capture-processor", MicCaptureProcessor);
