-- マップのレイアウト(障害物・ミーティングエリアの位置)を保存するテーブル。
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。

create table if not exists public.map_layout (
  id text primary key default 'default',
  obstacles jsonb not null,
  meeting_area jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.map_layout enable row level security;

-- 誰でも読み取り可能(表示用。マップの見た目は未ログインでも問題ない想定)
create policy "map_layout is viewable by everyone"
  on public.map_layout for select
  using (true);

-- 編集はログイン済みユーザーのみ(Googleログイン導入前は「誰でも編集可」に
-- していたが、anon keyはクライアントに公開されるためログインなしで誰でも
-- 直接Supabase APIを叩いて改ざん・削除できてしまっていた。ログイン必須に
-- 変更する場合は、既存のポリシーを一度削除してから作り直すこと)。
drop policy if exists "map_layout is editable by everyone" on public.map_layout;

create policy "map_layout is editable by authenticated users"
  on public.map_layout for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
