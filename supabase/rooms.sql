-- ルーム(バーチャル空間)テーブル。1アカウントが複数ルームを持てる。
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- accounts.sql・profiles.sqlを先に実行しておくこと(下のSELECTポリシーが
-- profiles.account_idを参照するため、profiles.sqlより後に実行する必要がある)。

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  preview_image text not null default '/map-background.webp',
  created_at timestamptz not null default now()
);

alter table public.rooms enable row level security;

-- 自分の所属アカウントのルームだけ閲覧可能(admin・guest共通)
drop policy if exists "rooms: select own account" on public.rooms;
create policy "rooms: select own account"
  on public.rooms for select
  using (
    account_id in (
      select account_id from public.profiles where user_id = auth.uid()
    )
  );

-- 追加・変更・削除は自分がオーナーのアカウントのルームのみ(admin操作)
drop policy if exists "rooms: modify own account as owner" on public.rooms;
create policy "rooms: modify own account as owner"
  on public.rooms for all
  using (
    account_id in (
      select id from public.accounts where owner_user_id = auth.uid()
    )
  )
  with check (
    account_id in (
      select id from public.accounts where owner_user_id = auth.uid()
    )
  );
