-- 招待トークンからアカウントを検索するための関数。
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- accounts.sqlを先に実行しておくこと。
--
-- 招待で参加するゲストは、まだどのアカウントにも所属していない
-- (accounts.sqlのRLSではaccountsを閲覧できない)ため、招待トークンが
-- 一致した行のid/name/owner_user_idだけを返すsecurity definer関数を
-- 用意し、「トークンを知っている人だけがそのアカウントを特定できる」形に
-- する(accountsテーブル自体への閲覧権限を広げるとinvite_token含め
-- 全件見えてしまうため、それは避ける)。owner_user_idは、招待URLを
-- 踏んだ本人がそのアカウントのオーナー自身か(=自分の招待URL)を
-- アプリ側で判定するために使う。

create or replace function public.lookup_account_by_invite_token(token text)
returns table (id uuid, name text, owner_user_id uuid)
language sql
security definer
set search_path = public
as $$
  select id, name, owner_user_id from public.accounts where invite_token = token;
$$;

grant execute on function public.lookup_account_by_invite_token(text) to authenticated;
