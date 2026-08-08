#!/usr/bin/env bash
# LOAD_TEST_PLAN.mdに書いた`lk load-test`コマンドが、実際に構文・接続とも
# 問題なく動くかをローカルDockerだけで予行演習するスクリプト。
#
# 注意: これは「コマンドが動くこと」の確認だけが目的で、ここで出る
# bitrate/packet lossの数値そのものはWebARENA Indigo実機での判断材料には
# ならない(ローカルのDocker同士の通信のため、実際のネットワーク・
# CPU制約を全く受けない)。実測はIndigo契約後にLOAD_TEST_PLAN.mdの手順で
# 行うこと。
#
# 使い方: bash deploy/livekit/lk-load-test-rehearsal.sh
# 前提: Dockerが起動していること。

set -euo pipefail

NETWORK_NAME="lk-rehearsal-net-$$"
SERVER_NAME="lk-rehearsal-server-$$"

cleanup() {
  docker rm -f "$SERVER_NAME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> ネットワーク・LiveKitサーバー(devモード)を起動"
docker network create "$NETWORK_NAME" >/dev/null
docker run -d --name "$SERVER_NAME" --network "$NETWORK_NAME" \
  livekit/livekit-server --dev --bind 0.0.0.0 >/dev/null

echo "==> 起動待機"
sleep 5

run_load_test() {
  # 引数をそのまま`lk load-test`へ渡す
  docker run --rm --network "$NETWORK_NAME" livekit/livekit-cli load-test \
    --url "ws://$SERVER_NAME:7880" \
    --api-key devkey --api-secret secret \
    "$@"
}

echo ""
echo "==> パターン1相当: ビデオ通話低画質(LOAD_TEST_PLAN.mdと同じフラグ)"
run_load_test --room rehearsal-video --video-publishers 2 --video-resolution low --subscribers 2 --duration 15s

echo ""
echo "==> パターン2相当: 画面共有代替(高画質publisher)"
run_load_test --room rehearsal-screen --video-publishers 1 --video-resolution high --subscribers 1 --duration 10s

echo ""
echo "=================================================="
echo " lk load-testコマンドは正常に実行できました"
echo " (数値はローカルDocker同士の通信のため参考値にならない。"
echo "  実測はIndigo契約後にLOAD_TEST_PLAN.mdの手順で行うこと)"
echo "=================================================="
