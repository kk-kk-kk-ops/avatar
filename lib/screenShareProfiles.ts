import type { ScreenShareCaptureOptions, TrackPublishOptions } from "livekit-client";

// 画面共有の画質調査(2026-11-27)用、運営者だけが切り替えられるテスト設定の一覧。
// setScreenShareEnabled(true, captureOptions, publishOptions) の
// 第2引数(captureOptions)・第3引数(publishOptions)にそのまま渡す値を持つ。
//
// 調査でnode_modules内のlivekit-client(2.21.0)のコードを確認した結果:
// - VP9・AV1(isSVCCodec)を画面共有(Track.Source.ScreenShare)で使う場合、
//   LocalParticipant.publish()内で scalabilityMode は常に "L1T3"
//   (1つの解像度レイヤー・3つの時間階層)に強制的に上書きされ、
//   simulcast・screenShareSimulcastLayers の指定は一切使われない
//   (node_modules/livekit-client/src/room/participant/LocalParticipant.ts
//   1137-1158行目。この分岐はcomputeVideoEncodings内のsimulcast分岐より
//   前に判定されるため、simulcastをtrue/falseどちらにしても結果は同じ)。
//   options.ts 82行目のコメントにも「for svc codecs, simulcast is
//   disabled」と明記されている。
// - 同じ分岐で、画面共有かつVP9/AV1の場合は contentHint が
//   自動的に "motion" に書き換えられる(同ファイル1148-1153行目、
//   Chromeのスクリーンキャプチャ用SVCエンコードパスの既知の不具合を
//   回避するための、SDK側のワークアラウンド)。VP8(current・A・B・D)
//   では、この自動書き換えは発生しない(contentHintは常に未指定のまま)。
//   そのため、このファイルではcontentHintをどの設定にも追加していない。
export type ScreenShareProfileId = "current" | "A" | "B" | "C" | "D" | "E";

export type ScreenShareProfile = {
  id: ScreenShareProfileId;
  label: string;
  note: string;
  captureOptions: ScreenShareCaptureOptions | undefined;
  publishOptions: TrackPublishOptions;
};

export const SCREEN_SHARE_PROFILE_ORDER: ScreenShareProfileId[] = [
  "current",
  "A",
  "B",
  "C",
  "D",
  "E",
];

export const SCREEN_SHARE_PROFILES: Record<ScreenShareProfileId, ScreenShareProfile> = {
  // 現状:components/AvatarSpace.tsxのstartScreenShareが今まで渡していた
  // ものと全く同じ(キャプチャの指定なし、maxBitrateのみ3Mbpsへ変更)。
  // simulcast・videoCodec・backupCodec等はすべて指定なし=SDK既定値
  // (simulcast: true, videoCodec: "vp8", backupCodec: true)が使われる。
  current: {
    id: "current",
    label: "現状",
    note: "今の本番と同じ設定(VP8・1080p・15fps・3Mbps、simulcast等は既定値のtrueのまま)。",
    captureOptions: undefined,
    publishOptions: {
      screenShareEncoding: {
        maxBitrate: 3_000_000,
        maxFramerate: 15,
        priority: "medium",
      },
    },
  },
  // A: VP8、1080p、15fps、2Mbps。simulcastは指定しない(既定のtrueのまま
  // =低解像度レイヤーとフル解像度レイヤーの2層で送信される)。
  A: {
    id: "A",
    label: "A",
    note: "VP8・1080p・15fps・2Mbps。simulcastは指定しない(既定trueのまま、2層で送信)。",
    captureOptions: {
      resolution: { width: 1920, height: 1080, frameRate: 15 },
    },
    publishOptions: {
      videoCodec: "vp8",
      screenShareEncoding: {
        maxBitrate: 2_000_000,
        maxFramerate: 15,
        priority: "medium",
      },
    },
  },
  // B: VP8、1080p、10fps、2Mbps、degradationPreference明示。simulcastは
  // 指定しない(既定trueのまま)。
  B: {
    id: "B",
    label: "B",
    note: "VP8・1080p・10fps・2Mbps・maintain-resolution明示。simulcastは指定しない(既定trueのまま)。",
    captureOptions: {
      resolution: { width: 1920, height: 1080, frameRate: 10 },
    },
    publishOptions: {
      videoCodec: "vp8",
      degradationPreference: "maintain-resolution",
      screenShareEncoding: {
        maxBitrate: 2_000_000,
        maxFramerate: 10,
        priority: "medium",
      },
    },
  },
  // C: VP9、1080p、10fps、2Mbps、degradationPreference明示。simulcastは
  // 指定しない。上記の通りVP9はSVCコーデックのため、simulcastの指定に
  // 関係なくscalabilityMode "L1T3"(1空間層・3時間層)の単一エンコーディング
  // として送信される(SDKが自動でそう上書きする)。contentHintも
  // SDKによって自動的に"motion"へ書き換わる。
  C: {
    id: "C",
    label: "C",
    note: "VP9・1080p・10fps・2Mbps・maintain-resolution明示。VP9はSVCのためsimulcast指定は無視され、scalabilityModeは\"L1T3\"に自動で上書きされる(SDKの既定動作)。contentHintも自動で\"motion\"になる。",
    captureOptions: {
      resolution: { width: 1920, height: 1080, frameRate: 10 },
    },
    publishOptions: {
      videoCodec: "vp9",
      degradationPreference: "maintain-resolution",
      screenShareEncoding: {
        maxBitrate: 2_000_000,
        maxFramerate: 10,
        priority: "medium",
      },
    },
  },
  // D: Bと同じで、simulcast: falseを明示(1層だけ送る)。VP8はSVCコーデック
  // ではないため、この指定はそのまま有効になる(Cのように無視されない)。
  D: {
    id: "D",
    label: "D",
    note: "Bと同じ(VP8・1080p・10fps・2Mbps・maintain-resolution)。simulcast: falseを明示し、1層だけ送る。",
    captureOptions: {
      resolution: { width: 1920, height: 1080, frameRate: 10 },
    },
    publishOptions: {
      videoCodec: "vp8",
      degradationPreference: "maintain-resolution",
      simulcast: false,
      screenShareEncoding: {
        maxBitrate: 2_000_000,
        maxFramerate: 10,
        priority: "medium",
      },
    },
  },
  // E: AV1、1080p、10fps、2Mbps、degradationPreference明示、
  // simulcast: false、backupCodec: vp8。AV1もSVCコーデードのため、Cと同じく
  // simulcastの指定(ここではfalse)はscalabilityModeの決定には使われない
  // (無視される)が、backupCodecの仕組み自体はSVC判定と別ロジック
  // (LocalParticipant.publish内のreq.simulcastCodecs)で処理されるため、
  // そのまま有効になる=AV1非対応の相手にはVP8が代わりに送られる。
  // 送信側ブラウザがAV1に対応していない場合、SDKが自動でvideoCodecを
  // "vp8"にフォールバックする(supportsAV1()のチェック、
  // node_modules/livekit-client/src/room/utils.ts 68-78行目)。
  E: {
    id: "E",
    label: "E",
    note: "AV1・1080p・10fps・2Mbps・maintain-resolution明示・simulcast: false・backupCodec: vp8。AV1もSVCのためsimulcast指定はscalabilityModeの決定には使われない(無視される)。送信側がAV1非対応ならSDKが自動でVP8にフォールバックする。",
    captureOptions: {
      resolution: { width: 1920, height: 1080, frameRate: 10 },
    },
    publishOptions: {
      videoCodec: "av1",
      degradationPreference: "maintain-resolution",
      simulcast: false,
      backupCodec: { codec: "vp8" },
      screenShareEncoding: {
        maxBitrate: 2_000_000,
        maxFramerate: 10,
        priority: "medium",
      },
    },
  },
};
