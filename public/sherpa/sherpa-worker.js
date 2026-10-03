// sherpa-onnx(VAD+ReazonSpeechオフライン認識)を専用のWeb Worker上で
// 動かすための本体(2026-10追加)。
//
// 背景(2026-10報告): 当初はメインスレッド上のScriptProcessorNode内で
// VAD・音声認識(sherpa-onnxのWASM呼び出し)を直接行っていたが、1発言分
// (数秒)の音声をまとめて認識するrecognizer.decode()はCPUを使う重い
// 処理で、メインスレッドで同期的に動くとその間UIスレッドが固まり、通話
// 音声(LiveKitのWebRTC送信パイプライン)まで巻き込みで途切れる不具合に
// つながった。VAD・バッファ・認識器の生成と実行を丸ごとこのWorkerへ
// 移し、メインスレッド側はダウンサンプリング(軽い純JS処理)した音声
// サンプルをpostMessageで渡すだけにする。
//
// Workerはページ(メインスレッド)がクロスオリジン分離(COOP/COEP)されて
// いれば、そこから生成されたWorkerも同じ分離状態を引き継ぐため、この
// WASMビルドが内部で使うSharedArrayBuffer+Workerプール(pthread)もこの
// Worker内でそのまま動作する。

importScripts("/sherpa/sherpa-onnx-asr.js");
importScripts("/sherpa/sherpa-onnx-vad.js");

let vad = null;
let buffer = null;
let recognizer = null;
let moduleRef = null;

function initRecognizer(wasmUrl, dataUrl, mainJsUrl) {
  return new Promise((resolve, reject) => {
    self.Module = {
      locateFile: (path) => {
        if (path.endsWith(".wasm")) return wasmUrl;
        if (path.endsWith(".data")) return dataUrl;
        return path;
      },
      setStatus: () => {},
      onAbort: (reason) => {
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      },
      onRuntimeInitialized: () => {
        try {
          const Module = self.Module;
          moduleRef = Module;
          vad = self.createVad(Module);
          buffer = new self.CircularBuffer(30 * 16000, Module);
          recognizer = new self.OfflineRecognizer(
            {
              modelConfig: {
                debug: 0,
                tokens: "./tokens.txt",
                transducer: {
                  encoder: "./transducer-encoder.onnx",
                  decoder: "./transducer-decoder.onnx",
                  joiner: "./transducer-joiner.onnx",
                },
                modelType: "transducer",
              },
            },
            Module,
          );
          resolve();
        } catch (err) {
          reject(err);
        }
      },
    };
    try {
      importScripts(mainJsUrl);
    } catch (err) {
      reject(err);
    }
  });
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "init") {
    try {
      await initRecognizer(msg.wasmUrl, msg.dataUrl, msg.mainJsUrl);
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (msg.type === "audio") {
    if (!vad || !buffer || !recognizer) return;
    // samplesは16kHzにダウンサンプリング済みのFloat32Array(メイン
    // スレッド側で変換済み、transferableで渡されている)。
    const samples = new Float32Array(msg.samples);
    // 調査用ログ(2026-10報告: 音声の途切れ・文字起こしに声がほぼ入ら
    // ない不具合の原因調査)。
    const vadStart = performance.now();
    buffer.push(samples);
    let segmentCount = 0;
    while (buffer.size() > vad.config.sileroVad.windowSize) {
      const windowSamples = buffer.get(
        buffer.head(),
        vad.config.sileroVad.windowSize,
      );
      vad.acceptWaveform(windowSamples);
      buffer.pop(vad.config.sileroVad.windowSize);

      while (!vad.isEmpty()) {
        const segment = vad.front();
        vad.pop();
        segmentCount++;

        const decodeStart = performance.now();
        const stream = recognizer.createStream();
        stream.acceptWaveform(16000, segment.samples);
        recognizer.decode(stream);
        const result = recognizer.getResult(stream);
        stream.free();
        const decodeMs = performance.now() - decodeStart;
        const text = (result?.text ?? "").trim();
        // eslint-disable-next-line no-console
        console.log(
          `[sherpa-worker] segment ${segmentCount}: ${segment.samples.length}サンプル decode=${decodeMs.toFixed(0)}ms text="${text}"`,
        );
        if (!text) continue;

        self.postMessage({ type: "result", text, at: msg.at ?? Date.now() });
      }
    }
    const totalMs = performance.now() - vadStart;
    // eslint-disable-next-line no-console
    console.log(
      `[sherpa-worker] audioメッセージ処理完了: ${samples.length}サンプル、segment数=${segmentCount}、VAD+decode合計=${totalMs.toFixed(0)}ms`,
    );
    return;
  }

  if (msg.type === "stop") {
    vad?.reset();
    buffer?.reset();
    return;
  }
};
