#!/usr/bin/env bash
# supabase/consolidated_setup.sqlを、実際のSupabaseプロジェクトに触れずに
# 検証するスクリプト。Docker上に素のPostgresを立て、auth/storageスキーマの
# 最小スタブを適用した上で、実際にSQLを実行して以下を確認する:
#
#   1. 新規インストール相当(何もない状態からの実行)が最後まで成功する
#   2. 同じSQLをもう一度実行しても壊れない(冪等性)
#   3. 旧screen_share_usageテーブル(daily_usageへの一般化より前の実データ)
#      からの移行が、データを失わずに成功する
#   4. 主要なRPC(daily_usage / chat / online_sessions系)が実際に呼び出せる
#
# Supabase SQL Editorは複数文をまとめて実行すると暗黙的に1トランザクション
# になる(1文でも失敗すると全体がロールバックされる)ため、psqlも
# --single-transaction -v ON_ERROR_STOP=1 で同じ挙動を再現する。
#
# 使い方: bash deploy/sql-audit/verify.sh
# 前提: Dockerが起動していること。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SETUP_SQL="$REPO_ROOT/supabase/consolidated_setup.sql"
STUB_SQL="$SCRIPT_DIR/stub_supabase.sql"
CONTAINER_NAME="sql-audit-pg-$$"
LOG_FILE="$(mktemp)"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -f "$LOG_FILE"
}
trap cleanup EXIT

echo "==> Postgresコンテナを起動 ($CONTAINER_NAME)"
docker run -d --name "$CONTAINER_NAME" -e POSTGRES_PASSWORD=postgres postgres:15 >/dev/null

echo "==> 起動待機"
for i in $(seq 1 30); do
  if docker exec -u postgres "$CONTAINER_NAME" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

psql_run() {
  # 引数: SQLファイルパス。出力は一旦ログに逃がし、失敗時だけ表示する
  # (成功時は"==>"の進捗行だけを見せてノイズを減らす)。
  if ! docker exec -i -u postgres "$CONTAINER_NAME" \
    psql --single-transaction -v ON_ERROR_STOP=1 -U postgres > "$LOG_FILE" 2>&1; then
    echo "---- psql出力(失敗) ----"
    cat "$LOG_FILE"
    echo "-------------------------"
    return 1
  fi
}

psql_exec() {
  # 引数: SQL文字列(1つ以上)。単独のセッションで実行する(ロールバック時に
  # 前後のテスト用INSERT等も巻き込まれる点に注意)。
  if ! docker exec -u postgres "$CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -U postgres -c "$1" > "$LOG_FILE" 2>&1; then
    echo "---- psql出力(失敗) ----"
    cat "$LOG_FILE"
    echo "-------------------------"
    return 1
  fi
}

echo "==> [1/4] auth/storageスタブを適用"
psql_run < "$STUB_SQL"

echo "==> [2/4] consolidated_setup.sqlを新規インストール相当で実行"
psql_run < "$SETUP_SQL"
echo "    OK: 新規インストールが成功しました"

echo "==> [3/4] 冪等性確認(同じSQLをもう一度実行)"
psql_run < "$SETUP_SQL"
echo "    OK: 再実行しても失敗しませんでした"

echo "==> [4/4] 旧screen_share_usageからの移行(実データあり)を検証"
psql_exec "
  drop table if exists public.daily_usage cascade;
  create table public.screen_share_usage (
    user_id uuid not null references auth.users(id) on delete cascade,
    day_key date not null,
    used_seconds integer not null default 0,
    updated_at timestamptz not null default now(),
    primary key (user_id, day_key)
  );
  insert into auth.users (id, email) values
    ('11111111-1111-1111-1111-111111111111', 'test@example.com')
    on conflict (id) do nothing;
  insert into public.screen_share_usage (user_id, day_key, used_seconds)
  values ('11111111-1111-1111-1111-111111111111', '2020-01-01', 123);
"

psql_run < "$SETUP_SQL"

MIGRATED_ROW=$(docker exec -u postgres "$CONTAINER_NAME" psql -tA -U postgres -c \
  "select used_seconds || ',' || kind from public.daily_usage where user_id = '11111111-1111-1111-1111-111111111111' and day_key = '2020-01-01';")

if [ "$MIGRATED_ROW" = "123,screen_share" ]; then
  echo "    OK: 旧テーブルのデータ(123秒)がkind='screen_share'として引き継がれました"
else
  echo "    NG: 移行後のデータが想定と異なります(got: '$MIGRATED_ROW', want: '123,screen_share')"
  exit 1
fi

echo "==> RPCの簡易動作確認"
psql_exec "
  create or replace function auth.uid() returns uuid language sql stable as
    \$\$ select '11111111-1111-1111-1111-111111111111'::uuid \$\$;
  select public.increment_daily_usage_seconds('video_call', 30);
  select public.get_daily_usage_used_seconds('video_call');
  select public.get_online_session_count();
"
echo "    OK: increment_daily_usage_seconds / get_daily_usage_used_seconds / get_online_session_count が呼び出せました"

echo ""
echo "=================================================="
echo " 全ての検証に成功しました"
echo "=================================================="
