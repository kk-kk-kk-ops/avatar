-- 招待トークンからアカウントを検索するための関数。
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- accounts.sqlを先に実行しておくこと。
--
-- 招待で参加するゲストは、まだどのアカウントにも所属していない
-- (accounts.sqlのRLSではaccountsを閲覧できない)ため、招待トークンが
-- 一致した行のid/nameだけを返すsecurity definer関数を用意し、
-- 「トークンを知っている人だけがそのアカウントを特定できる」形にする
-- (accountsテーブル自体への閲覧権限を広げるとinvite_token含め全件見えて
-- しまうため、それは避ける)。

create or replace function public.lookup_account_by_invite_token(token text)
returns table (id uuid, name text)
language sql
security definer
set search_path = public
as $$
  select id, name from public.accounts where invite_token = token;
$$;

grant execute on function public.lookup_account_by_invite_token(text) to authenticated;
