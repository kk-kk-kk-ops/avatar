-- アカウント(契約単位の組織)テーブル。
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- profiles.sql・rooms.sql・map_layout_room.sql と合わせて実行すること
-- (rooms.sqlがaccountsを外部キー参照するため、accounts.sqlを先に実行する)。

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

-- 自分が所属している(オーナー、またはprofiles.account_idが一致する)アカウントだけ閲覧可能
create policy "accounts: select own"
  on public.accounts for select
  using (
    auth.uid() = owner_user_id
    or id in (select account_id from public.profiles where user_id = auth.uid())
  );

-- 作成はログイン済みユーザーが自分をオーナーとして作る場合のみ(プラン選択画面から)
create policy "accounts: insert own"
  on public.accounts for insert
  with check (auth.uid() = owner_user_id);

-- 更新(プラン変更・招待トークン再発行など)はオーナーのみ
create policy "accounts: update own"
  on public.accounts for update
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);
