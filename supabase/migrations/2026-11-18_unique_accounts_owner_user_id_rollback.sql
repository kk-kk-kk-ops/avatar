-- 2026-11-18_unique_accounts_owner_user_id.sql の戻し。
begin;

alter table public.accounts
  drop constraint if exists accounts_owner_user_id_key;

commit;
