-- アカウント(契約単位の組織)テーブル。
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
--
-- 実行順序(重要・循環参照があるため必ずこの順で):
--   1. accounts.sql (これ)
--   2. profiles.sql (profiles.account_id/roleカラムを追加)
--   3. rooms.sql (SELECTポリシーがprofiles.account_idを参照するため、
--      profiles.sqlより後に実行する)
--   4. accounts_policies.sql (accountsのSELECTポリシーもprofiles.account_id
--      を参照するため、profiles.sqlの後でないと作成できない)
--   5. invite_lookup_function.sql
--   6. map_layout_room.sql (map_layout.room_idカラムを追加)
--   7. migrate_existing_owner.sql (map_layout.room_idを更新するため、
--      map_layout_room.sqlより後に実行する)

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free' check (plan in ('free', 'light', 'standard', 'pro')),
  trial_ends_at timestamptz, -- 無料お試しの終了日時(有料プランではnull)
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  invite_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now()
);

alter table public.accounts enable row level security;

-- SELECTポリシー(profiles.account_idを参照するもの)は
-- accounts_policies.sql側で作成する(profiles.sql実行後でないと作れないため)。

-- 作成はログイン済みユーザーが自分をオーナーとして作る場合のみ(プラン選択画面から)
drop policy if exists "accounts: insert own" on public.accounts;
create policy "accounts: insert own"
  on public.accounts for insert
  with check (auth.uid() = owner_user_id);

-- 更新(プラン変更・招待トークン再発行など)はオーナーのみ
drop policy if exists "accounts: update own" on public.accounts;
create policy "accounts: update own"
  on public.accounts for update
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);
