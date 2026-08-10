# WebARENA Indigo セットアップ手順

`deploy/livekit/`配下の`docker-compose.yml`/`livekit.yaml`/`Caddyfile`は
プロバイダ非依存のため無変更で使う。ここではIndigo固有のコンソール操作のみ
まとめる。

## 1. インスタンス作成

- LiveKitノード: 8GBプラン(6vCPU/8GB/160GB SSD/1Gbps上限)を1台
- Redisノード: 別途小規模プラン(1〜2GB程度)を1台
- OSはUbuntu等、Docker公式がサポートするLinuxディストリビューションを選択
- IPv4/IPv6は8GBプランに標準付属(追加設定不要)

## 2. セキュリティグループ(ファイアウォール)設定

Indigoは「セキュリティグループ」単位でインバウンドルールを設定する
(最大10グループ×合計30ルール)。ポートはハイフンで範囲指定できるため、
広いUDPレンジも1ルールで開放できる。

**LiveKitノード用グループ**

| プロトコル | ポート | 用途 |
|---|---|---|
| TCP | 80 | Caddyの自動HTTPS(Let's Encrypt証明書発行・更新、HTTP→HTTPSリダイレクト)に必須。閉じたままだと証明書取得が失敗・不安定になる |
| TCP | 443 | Caddy(WSS/HTTPS) |
| TCP | 7881 | LiveKit ICE/TCPフォールバック(ノード内部向け。外部公開は必須ではないが疎通確認用に開放しておく) |
| UDP | 50000-60000 | RTCメディア(`livekit.yaml`の`port_range_start`/`port_range_end`と一致させる) |
| UDP | 3478 | TURN |
| TCP/UDP | 5349 | TURN TLS |

**Redisノード用グループ**

| プロトコル | ポート | 用途 |
|---|---|---|
| TCP | 6379 | RedisクライアントSDK通信(**送信元IPをLiveKitノードのIPのみに絞ること**。全世界公開は厳禁) |

## 3. DNS設定

- `livekit.yourdomain.com` → LiveKitノードのグローバルIPv4(Aレコード)
- `turn.yourdomain.com` → 同上(TURN TLS証明書用。Caddyが自動取得する想定なら
  同じAレコードで問題ない)
- ノードを増設する場合、同じAレコードにIPを追加(ラウンドロビン)するか、
  ロードバランサ/複数レコードでの分散を検討する

## 4. デプロイ手順(LiveKitノード)

```bash
# Dockerインストール(Ubuntu公式リポジトリ経由。Docker公式が
# 「get.docker.com経由の簡易インストールは本番非推奨・検証用途限定」
# としているため、本番はこちらの手順を使う)
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# このリポジトリのdeploy/livekit/livekit-node/を転送
scp -r deploy/livekit/livekit-node user@<ノードIP>:~/livekit-node

ssh user@<ノードIP>
cd ~/livekit-node
cp .env.example .env
# .envを編集: LIVEKIT_DOMAIN, TURN_DOMAIN, LIVEKIT_API_KEY/SECRET, REDIS_ADDRESS(RedisノードのIP), REDIS_PASSWORD
docker compose up -d
```

## 5. デプロイ手順(Redisノード)

```bash
# Dockerインストール(手順4と同じ、Ubuntu公式リポジトリ経由)
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

scp -r deploy/livekit/redis-node user@<RedisノードIP>:~/redis-node
ssh user@<RedisノードIP>
cd ~/redis-node
cp .env.example .env
# .envを編集: REDIS_PASSWORD
docker compose up -d
```

## 6. アプリ側の環境変数切り替え

Next.jsアプリ(Vercel等)の環境変数を以下に更新する:

```
LIVEKIT_URL=wss://livekit.yourdomain.com
LIVEKIT_API_KEY=<livekit.yamlのkeysと一致させる>
LIVEKIT_API_SECRET=<同上>
```

## 7. 動作確認

- `docker compose logs -f caddy`でCaddyがLIVEKIT_DOMAIN宛のLet's Encrypt証明書を
  正常に取得できているか確認する(エラーが出ていないこと)
- `docker compose logs -f livekit`でRedis接続・TURN起動にエラーが出ていないか確認する。
  特にTURN(`turn.yourdomain.com`, `external_tls: true`)は証明書ファイルの明示指定が
  `livekit.yaml`に無いため、実際にどう証明書を得ているか(内蔵ACME機能を使うのか、
  別途証明書を用意する必要があるのか)をログで確認し、エラーが出ていれば個別に対応する
- `docker compose ps`で両コンテナ(LiveKitノード: livekit/caddy、Redisノード: redis)が
  `Up`状態であることを確認する
- `deploy/QA_CHECKLIST.md`の「OSS基盤」セクションに沿って音声/ビデオ/画面共有を確認
- `deploy/livekit/LOAD_TEST_PLAN.md`に沿って`lk load-test`を実施

## 8. ノード増設時(2台目以降)

- 手順4と同じ内容を新しいインスタンスに対して実施するだけでよい
  (`livekit.yaml`の`REDIS_ADDRESS`を同じRedisノードに向ける)
- 新規ルームの割り当てはLiveKit側が自動で行うため、DNS/ロードバランサで
  新ノードへの接続経路を用意する以外にアプリ側の変更は不要
