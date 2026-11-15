-- 2026-11-15_restrict_accounts_insert_policy.sql の戻しSQL。
-- 「accounts: insert own」を、本番の現在の定義(with check (auth.uid() =
-- owner_user_id)のみ、ユーザー共有分)に戻す。
begin;

drop policy if exists "accounts: insert own" on public.accounts;
create policy "accounts: insert own"
  on public.accounts for insert
  with check (auth.uid() = owner_user_id);

commit;
