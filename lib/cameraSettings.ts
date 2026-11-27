import type { TrackPublishOptions, VideoCaptureOptions } from "livekit-client";

// ビデオ通話のカメラの画質調整(2026-11-27)。
// 常時表示プレビュー行のVideoTileは210x140px(CSSピクセル)だが、ブラウザの
// 表示拡大率(例:1.25倍)がかかると実際の点(デバイスピクセル)では
// 約262x175点になる。これまでの160x120ではこの枠に対して小さすぎ、拡大
// されて映像が荒く見えていたため、320x240(4:3、枠の比率と同じ)に
// 上げる。VP8のまま、simulcast: falseで1層のみ送信する(カメラの表示枠は
// どこも小さいため、複数層を送る必要が無い。1層のままにすることで、
// 画面共有の調査で見つかった「simulcastが既定trueのままだと、adaptiveStream
// とdynacastにより低い層しか届かない」問題を避けられる)。
//
// 【VP9にする場合の注意】VP9・AV1はSVCコーデックのため、カメラでは
// scalabilityModeを指定しない場合、LiveKitが既定で"L3T3_KEY"
// (3つの空間層・3つの時間層)にする
// (node_modules/livekit-client/src/room/participant/LocalParticipant.ts
// 1137-1158行目)。画面共有のScreenShare向けの強制上書き("L1T3")はカメラ
// には適用されないため、カメラをVP9化する場合は、simulcastの2層問題と
// 同種の問題を避けるため、scalabilityMode: "L1T3"を明示する必要がある。
export const CAMERA_CAPTURE_OPTIONS: VideoCaptureOptions = {
  resolution: { width: 320, height: 240, frameRate: 15 },
};

export const CAMERA_PUBLISH_OPTIONS: TrackPublishOptions = {
  videoEncoding: { maxBitrate: 250_000, maxFramerate: 15 },
  simulcast: false,
};
