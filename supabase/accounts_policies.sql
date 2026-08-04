-- accountsテーブルのSELECTポリシー(profiles.account_idを参照するため、
-- accounts.sql・profiles.sqlの両方を先に実行しておくこと)。
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。

-- 自分が所属している(オーナー、またはprofiles.account_idが一致する)アカウントだけ閲覧可能
drop policy if exists "accounts: select own" on public.accounts;

create policy "accounts: select own"
  on public.accounts for select
  using (
    auth.uid() = owner_user_id
    or id in (select account_id from public.profiles where user_id = auth.uid())
  );
