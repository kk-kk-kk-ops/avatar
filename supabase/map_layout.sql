-- マップのレイアウト(障害物・ミーティングエリアの位置)を保存するテーブル。
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。

create table if not exists public.map_layout (
  id text primary key default 'default',
  obstacles jsonb not null,
  meeting_area jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.map_layout enable row level security;

-- 誰でも読み取り可能(表示用)
create policy "map_layout is viewable by everyone"
  on public.map_layout for select
  using (true);

-- 誰でも編集可能(このアプリはログイン機能がないため、簡易的に全員編集可にしています)
create policy "map_layout is editable by everyone"
  on public.map_layout for all
  using (true)
  with check (true);
