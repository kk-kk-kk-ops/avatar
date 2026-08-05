-- lookup_account_by_invite_token関数にowner_user_idも返すよう拡張する。
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- invite_lookup_function.sqlを先に実行しておくこと。
--
-- 招待URLを踏んだ本人がそのアカウントのオーナー自身かどうか
-- (「自分の招待URL」かどうか)をアプリ側で判定できるようにするため、
-- owner_user_idも返すよう変更する。戻り値の列を変える場合は
-- create or replaceではなくdrop→createが必要。

drop function if exists public.lookup_account_by_invite_token(text);

create function public.lookup_account_by_invite_token(token text)
returns table (id uuid, name text, owner_user_id uuid)
language sql
security definer
set search_path = public
as $$
  select id, name, owner_user_id from public.accounts where invite_token = token;
$$;

grant execute on function public.lookup_account_by_invite_token(text) to authenticated;
