# indigo-position-ws

GlobyのアバターWS位置同期サーバー(Supabase Realtime Broadcastのmoveイベントの
移行先、第1段階)。presence・チャット・DM・施錠・強制退出・録画・字幕等は
引き続きSupabase Realtimeに残る。このサーバーが担当するのは以下の2種類の
イベントの中継のみ:

- `move`: 座標(x, y, dir, moving, t, teleport?)
- `state`: 非位置情報(マイク/車/ステータス等、中身はこのサーバーの関心事では
  ない不透明なJSON)

**重要な設計方針**: このサーバーはSupabaseの認証情報を一切保持しない。
ルーム参加権限の確認・マップサイズ/ワープ地点/会議室ゾーン情報の取得は、
全てNext.js側のトークン発行API(別ブランチで実装予定)がSupabase側で済ませ、
その結果を署名付きJWTに埋め込んでクライアントへ渡す。このサーバーは
JWTの署名検証だけを行えばよい。

## 認証フロー

1. クライアントはWSS接続を確立する(**トークンをURLクエリパラメータには
   含めない** — ログ・プロキシ・ブラウザ履歴に残るリスクがあるため)。
2. 接続後、最初のメッセージとして `{ "type": "authenticate", "token": "<JWT>" }`
   を送る。
3. サーバーは`AUTH_GRACE_PERIOD_MS`(デフォルト8秒)以内にこのメッセージが
   届かない場合、または最初のメッセージが`authenticate`以外だった場合、
   接続をクローズコード`4003`で切断する。
4. 認証成功後、有効期限が切れる前にクライアントが新しいトークンで再度
   `authenticate`メッセージを送ると、接続を維持したままclaims(mapW/mapH/
   warpPairs/zones)を更新できる(トークン更新、2026-11追加)。再認証時の
   `sub`/`roomId`は元の接続と完全一致している必要があり、一致しなければ
   `4003`で切断する(なりすまし・部屋の乗り換えへの悪用防止)。更新用
   トークンの検証に失敗した場合は、動作中の接続自体は維持する(元の
   トークンのexpが来れば後述のハートビート巡回で自然に切断される)。
5. 元のトークンの`exp`が過ぎても一度も有効な再認証が行われなかった接続は、
   `HEARTBEAT_INTERVAL_MS`(既定30秒)ごとの巡回で`4003`切断される。
6. `HEARTBEAT_INTERVAL_MS`ごとにping/pongで無応答接続も検知し、
   前回のpingに応答が無かった接続はterminate()で切断する。

### JWTのclaims

```
{
  sub: string,        // ユーザーID
  roomId: string,
  kid: string,        // "production" | "loadtest"(鍵IDと一致必須)
  exp: number,        // 短命(〜30分目安)
  mapW: number, mapH: number,
  warpPairs: [[x1,y1,x2,y2], ...],
  zones: [{ id, kind, x, y, w, h }, ...],
}
```

**実測サイズ**: ワープペア5組・ゾーン8件という標準的なルーム構成を想定して
実測したところ、JWT全体で**約1.5KB(1480バイト)**でした(署名込み)。
`MAX_PAYLOAD_BYTES`のデフォルト(8KB)に対して十分な余裕があります。
ワープ地点・ゾーンが極端に多いテンプレートの場合はこの限りではないため、
トークン発行側(Next.js API、別ブランチ)で必要に応じてサイズの監視・
トリミング(粗い範囲チェックのみに簡略化する等)を検討してください
(このWSサーバー側での対応は不要、という2026-11設計レビューの整理)。

## 鍵の分離(本番/負荷試験)

- `SERVER_MODE=production`のサーバーは`INDIGO_WS_SECRET`/`INDIGO_WS_KID`
  (既定値`production`)のトークンのみ受け付け、他のkidは問答無用で拒否する。
- `SERVER_MODE=loadtest`のサーバーは`INDIGO_WS_TEST_SECRET`/
  `INDIGO_WS_TEST_KID`(既定値`loadtest`)のトークンのみ受け付け、さらに
  `roomId`が`loadtest-`始まりでなければ拒否する(鍵分離に加えた二重の隔離)。
- 2つのモードは必ず**別プロセス・別インスタンス**として起動すること
  (同一プロセスで両方のkidを受け付ける設定は存在しない)。

## 不正メッセージの連打対策

不正なJSON・形状不一致・座標範囲外・不正teleport等は1件ずつでは切断しない
(ネットワーク由来の揺らぎ等でも起こりうるため)が、`INVALID_MESSAGE_WINDOW_MS`
(既定10秒)あたり`INVALID_MESSAGE_LIMIT`(既定20回)を超えて連打してくる
接続は`4005`で切断する(認証前の接続にも適用、2026-11追加)。

## 送信バッファの「最新値優先」制御

move/move-batchの配信は、受信者側の送信バッファ(`ws`の`bufferedAmount`、
OSへまだ渡せていないバイト数)が`MAX_BUFFERED_BYTES_FOR_MOVE`(既定4096
バイト)を超えている間、その接続へのその回の送信だけをスキップする
(2026-11追加)。詰まっている接続に無制限にキューを溜め込ませないための
安全策で、次のmove/tickが来れば自然に最新の位置へ追いつく。state・管理API
経由の切断には適用しない(取りこぼしたくないため)。

## バリデーション

- 型・形状チェック(不正な単発メッセージは切断せず静かに捨てる。連打は上記の通り切断)
- `maxPayload`(デフォルト8KB)によるフレームサイズ上限
- 座標範囲チェック(トークン内の`mapW`/`mapH`に基づく)
- 速度チェック(既知の理論上の最大速度 MOVE_SPEED(220px/秒)×車の最大倍率
  (2.5倍)=550px/秒に余裕を持たせた閾値、デフォルト900px/秒)
- `teleport: true`の場合は速度チェックの代わりに、トークン内の
  `warpPairs`/`zones`と照合し、正規の瞬間移動先(ワープ地点または会議室
  入室地点)かどうかを検証する。該当しなければ拒否。さらに受理頻度にも
  上限を設ける(デフォルト5秒に2回まで)。

## 送信制御(レート制限)

- move: 1接続あたり秒間上限(デフォルト25回/秒)を超えた分は間引く。
- state: 独自の送信枠(デフォルト10秒に20回)。Supabase presenceの
  「30秒5回」制限とは完全に無関係(自前サーバーなので別の制限値)。
  上限到達時は捨てずに、枠が空いた時点で最新のpayloadを1回送る
  (coalesce方式。`components/AvatarSpace.tsx`のSupabase presence向け
  `requestPresenceTrack()`と同じ考え方)。

## 配信方式

`RELAY_MODE`で切り替え可能(`config.mjs`参照):

- `immediate`(既定): 受信したmoveを即座に中継する。現在のSupabase
  broadcastに最も近い挙動。
- `tick`: ルームごとに`TICK_INTERVAL_MS`(既定50ms)間隔でまとめてバッチ
  配信する。人数が多いルームでの帯域削減用。負荷試験での比較のために
  実装済みだが、既定モードではない。

## 管理API: POST /internal/disconnect

Next.jsの強制退出処理から、該当ユーザーのWS接続を即座に切断するための
内部APIです。

- 認証は固定シークレットをヘッダーでそのまま送る方式**ではなく**、
  HMAC署名+タイムスタンプ方式(リプレイ対策)。Vercelの送信元IPが
  固定できないため、IPアドレス制限ではなくこの方式を主な防御とする
  (2026-11設計レビューの結論)。
- リクエスト例(Next.js側の実装イメージ):
  ```js
  const body = JSON.stringify({ roomId, userId });
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto.createHmac("sha256", ADMIN_SECRET)
    .update(`${ts}:${body}`).digest("hex");
  await fetch(`https://${ADMIN_DOMAIN}/internal/disconnect`, {
    method: "POST",
    headers: { "x-timestamp": ts, "x-signature": sig },
    body,
  });
  ```
- タイムスタンプが現在時刻から`ADMIN_REPLAY_WINDOW_SEC`(既定60秒)以上
  ズレているリクエストは拒否する。
- 送信元IPごとの認証失敗レート制限あり(既定: 60秒に5回失敗で10分ブロック)。
- 必ずHTTPS(Caddy経由)で呼び出すこと。推測困難なサブドメインに置くことを
  推奨するが、実際の防御はコードレベルの認証であり、サブドメインの秘匿性
  だけに頼らないこと。

## デプロイ手順(IndigoPro VPS、LiveKitと同居)

**重要(2026-11追加)**: 本番はLiveKitと同じVPSに同居させる想定のため、
このサービス専用のCaddyコンテナは**起動しない**(`deploy/livekit/
livekit-node/`の既存Caddyが、同じVPS上でポート80/443を既に握っている
ため、2つ目のCaddyを同居させると競合する)。代わりに、既存の
`deploy/livekit/livekit-node/Caddyfile`に`{$INDIGO_WS_DOMAIN}`/
`{$INDIGO_WS_ADMIN_DOMAIN}`ブロックを追記済みなので、そちらの既存
Caddyコンテナがこのサービスへもリバースプロキシする。

```bash
# 1) アプリ本体(indigo-position-ws)をVPSへ転送・起動(Caddyは含まない)
scp -r deploy/indigo-position-ws user@<ノードIP>:~/indigo-position-ws

ssh user@<ノードIP>
cd ~/indigo-position-ws
cp .env.example .env
# .envを編集: INDIGO_WS_SECRET, INDIGO_WS_ADMIN_SECRET, WS_PORT, ADMIN_PORT 等
# (このサービス自身の.envにはCaddy用のドメイン変数は不要。Caddy側の
#  設定は下記2)で行う)

docker compose up -d --build

# 2) 既存LiveKitノードの.env(deploy/livekit/livekit-node/.env相当、
#    LiveKitのCaddyコンテナが読み込んでいるenv_file)に、追記したCaddyfile
#    ブロックが参照する変数を追加する:
#      INDIGO_WS_DOMAIN=position-ws.yourdomain.com
#      INDIGO_WS_ADMIN_DOMAIN=position-ws-admin.yourdomain.com   # 推測困難なサブドメインにする
#      INDIGO_WS_PORT=8787        # indigo-position-ws/.envのWS_PORTと一致させる
#      INDIGO_WS_ADMIN_PORT=8788  # indigo-position-ws/.envのADMIN_PORTと一致させる
# 変更後、LiveKit側のCaddyコンテナを再起動する:
#   cd ~/<livekit-nodeのディレクトリ> && docker compose restart caddy
```

**注意**: `.env`を変更した場合は`docker compose up -d --build`を再実行する
こと(`restart`だけでは環境変数の変更が反映されない)。

### スタンドアロン運用(LiveKitと同居しない場合)

別VPSでの単独運用やローカル確認など、LiveKitと同じVPSに同居させない
場合は、`docker-compose.standalone.yml`(このサービス専用のCaddyを含む)
を使う: `docker compose -f docker-compose.standalone.yml up -d --build`。
この場合は`.env`に`INDIGO_WS_DOMAIN`/`INDIGO_WS_ADMIN_DOMAIN`を設定する
(`.env.example`参照)。

### 負荷試験用インスタンス

負荷試験は本番とは別プロセス/別ポートで起動する(本番トークンを一切
受け付けない構成にするため)。同じVPS上で検証する場合は、別ポート
(`WS_PORT`/`ADMIN_PORT`を変更)・別の`.env`(`SERVER_MODE=loadtest`、
`INDIGO_WS_TEST_SECRET`等)で第2のコンテナとして起動する。本番とは
別のVPS(または別のCaddyドメイン)を使うことを推奨する。

## ファイアウォール

`deploy/livekit/INDIGO_SETUP.md`のLiveKitノード用設定に加え、以下を開放する:

| プロトコル | ポート | 送信元IP | 用途 |
|---|---|---|---|
| TCP | 443 (WS_PORT/ADMIN_PORTはCaddy経由のためポート自体の個別開放は不要) | 0.0.0.0 | Caddy(WSS/HTTPS) |

`WS_PORT`(8787)・`ADMIN_PORT`(8788)自体は`network_mode: host`でVPS内の
localhostにのみ直接listenし、Caddyがリバースプロキシする構成のため、
これらのポート番号そのものを外部ファイアウォールで開放する必要はない。

## ローカルでの動作確認

```bash
npm install
INDIGO_WS_SECRET=dev-secret INDIGO_WS_ADMIN_SECRET=dev-admin-secret npm start
```
