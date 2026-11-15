-- 2026-11-15_restrict_accounts_select_owner_only.sql の戻しSQL。
-- 本番の現在の定義(profiles.account_id経由の閲覧を含む)に戻す。
begin;

drop policy if exists "accounts: select own" on public.accounts;
create policy "accounts: select own"
  on public.accounts for select
  using (
    auth.uid() = owner_user_id
    or id in (select account_id from public.profiles where user_id = auth.uid())
  );

commit;
