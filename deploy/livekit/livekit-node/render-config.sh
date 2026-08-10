#!/bin/sh
set -eu

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Error: .env が見つかりません。先に .env.example をコピーして値を設定してください。" >&2
  exit 1
fi

set -a
. ./.env
set +a

envsubst < livekit.yaml > livekit.effective.yaml

echo "livekit.effective.yaml を再生成しました。docker compose up -d で反映してください。"
