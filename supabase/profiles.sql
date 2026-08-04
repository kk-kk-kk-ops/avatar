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

-- アカウント(契約単位)への所属とロール。account_idがnullの間は
-- 「まだプラン未選択・未招待の新規ユーザー」を表す。
-- accounts.sqlを先に実行しておくこと(account_idの外部キー参照のため)。
alter table public.profiles
  add column if not exists account_id uuid references public.accounts(id) on delete set null;
alter table public.profiles
  add column if not exists role text check (role in ('admin', 'guest'));

alter table public.profiles enable row level security;

-- 本人だけが自分のプロフィールを閲覧できる
-- (drop→createで冪等にしている。初回セットアップ時に既にこのポリシーが
-- 作成済みの環境で再実行しても "already exists" エラーにならないように)
drop policy if exists "profiles: select own" on public.profiles;
create policy "profiles: select own"
  on public.profiles for select
  using (auth.uid() = user_id);

-- 本人だけが自分のプロフィールを新規作成できる(初回ログイン時)
drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own"
  on public.profiles for insert
  with check (auth.uid() = user_id);

-- 本人だけが自分のプロフィールを更新できる(2回目以降のログイン時)
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
