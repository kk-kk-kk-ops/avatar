import type { TrackPublishOptions } from "livekit-client";

// 画面共有の画質調査(2026-11-27)の結果、全員の画面共有をこの設定に統一する。
// 以前はcurrent・A〜Eの6設定を運営者だけが切り替えられるテストの仕組み
// だったが、設定が決まったためこの1つだけに統一した。
//
// 実測の結果(運営者向けテスト設定current・A〜Eでの比較、2026-11-27):
// - 現状・A・B(VP8・simulcastの指定なし=既定true)は、送信側で高い層
//   (h、フル解像度)が「無効(inactive)」になり、低い層(960x540)だけが
//   実際に送られていた。受信側の表示枠が458x481と小さく、adaptiveStream
//   が低い層で足りると判断し、dynacast(Room作成時にtrue)がフル解像度
//   レイヤーの送信そのものを止めていたため(受信側の要求に送信側が
//   追従する仕組み)。
// - C(VP9)・D(VP8・simulcast: false)・E(AV1)は、低い層が無い(1層だけ)
//   ため、受信側も常に1920x1080で受け取れた。
// - 動きのある画面(カーソル移動・スクロール等)での比較: Cは送信
//   1920x1080・9fps・約2.0Mbps、受信decode 0.60ms/フレーム、送信側CPU
//   使用率全体16%。Dは送信約2.2Mbps、受信decode 6.21ms、CPU使用率21%。
//   CPU・decode時間ともにVP9の方が軽かったため、Cをもとにした設定を
//   採用する。
//
// VP9はSVCコーデックのため、simulcastの指定に関係なくLiveKit側が自動で
// scalabilityMode "L1T3"(1空間層・3時間層)に上書きし、contentHintも
// 自動で"motion"に書き換える(node_modules/livekit-client/src/room/
// participant/LocalParticipant.ts 1137-1158行目)。そのためここで
// simulcast: falseを明示しているのは「VP9が使えない環境でVP8にフォール
// バックした場合」のための指定で、VP9が実際に使われている間は効果が無い
// (SVC分岐がsimulcast判定より先に評価されるため)。送信側ブラウザがVP9に
// 対応していない場合、SDKが自動でvideoCodecを"vp8"にフォールバックする
// (supportsVP9()のチェック、node_modules/livekit-client/src/room/utils.ts
// 90-100行目付近)。その際backupCodec: { codec: "vp8" }により、受信側が
// VP9非対応でも(SFU側が相手に合わせてVP8のレイヤーを配ることで)視聴できる。
//
// Safari 17(およびiOS 17以上)では、解像度(resolution)を明示すると
// getDisplayMediaが低画質な捕捉になる既知の不具合がある
// (node_modules/livekit-client/src/room/track/options.ts 233-238行目の
// コメント、https://bugs.webkit.org/show_bug.cgi?id=263015 )。これを
// 避けるため、キャプチャの指定(setScreenShareEnabledの第2引数)は
// undefined(=指定なし)のままにし、LiveKitの既定の挙動に任せる
// (components/AvatarSpace.tsx参照)。Safari 17以外では、livekit-client
// が自動で解像度を1920x1080(ScreenSharePresets.h1080fps30の解像度、
// node_modules/livekit-client/src/room/participant/LocalParticipant.ts
// 731-736行目)に抑える。取り込み(キャプチャ)自体は最大30fpsの要求に
// なるが、送信は下のscreenShareEncoding.maxFramerate: 10で10fpsに
// 抑えられるため、実際に送られる映像は変わらない。
export const SCREEN_SHARE_PUBLISH_OPTIONS: TrackPublishOptions = {
  videoCodec: "vp9",
  degradationPreference: "maintain-resolution",
  simulcast: false,
  backupCodec: { codec: "vp8" },
  screenShareEncoding: {
    maxBitrate: 2_000_000,
    maxFramerate: 10,
    priority: "medium",
  },
};
