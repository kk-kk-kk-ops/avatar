-- Googleログインのユーザー情報を保存するテーブル。
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'google',
  display_name text,
  avatar_url text,
  email text,
  last_login_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 本人だけが自分のプロフィールを閲覧できる
create policy "profiles: select own"
  on public.profiles for select
  using (auth.uid() = user_id);

-- 本人だけが自分のプロフィールを新規作成できる(初回ログイン時)
create policy "profiles: insert own"
  on public.profiles for insert
  with check (auth.uid() = user_id);

-- 本人だけが自分のプロフィールを更新できる(2回目以降のログイン時)
create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
