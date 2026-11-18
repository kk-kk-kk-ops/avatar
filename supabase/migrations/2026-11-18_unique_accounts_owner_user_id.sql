-- accounts.owner_user_id に重複禁止(UNIQUE)を追加する。
-- 1人の利用者が持ち主のアカウントは1件まで(同時に2回処理が走った場合の二重作成を防ぐ)。
-- 戻しSQL:2026-11-18_unique_accounts_owner_user_id_rollback.sql
begin;

alter table public.accounts
  add constraint accounts_owner_user_id_key unique (owner_user_id);

commit;
