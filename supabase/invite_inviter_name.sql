-- 招待URLからログイン画面に遷移したとき「〇〇〇さんからの招待」と
-- 表示するための、招待者名(表示名)を追加する。
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- invite_lookup_owner.sqlを先に実行しておくこと。
--
-- ログイン前(未認証)のTOPページでも招待者名を表示できるようにする
-- 必要があるため、lookup_account_by_invite_token関数はanonロールにも
-- 実行権限を付与する(トークンを知っている人だけがその招待者名/
-- アカウント名を見られる、という制約は従来通り維持される)。

alter table public.accounts
  add column if not exists invite_inviter_name text;

drop function if exists public.lookup_account_by_invite_token(text);

create function public.lookup_account_by_invite_token(token text)
returns table (
  id uuid,
  name text,
  owner_user_id uuid,
  invite_inviter_name text
)
language sql
security definer
set search_path = public
as $$
  select id, name, owner_user_id, invite_inviter_name
  from public.accounts
  where invite_token = token;
$$;

grant execute on function public.lookup_account_by_invite_token(text) to authenticated;
grant execute on function public.lookup_account_by_invite_token(text) to anon;
