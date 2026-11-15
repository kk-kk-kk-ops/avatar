-- 自分の所属アカウントの、ロビー画面表示に必要な最小限の情報
-- (plan, invite_token)だけを返す関数(段階4)。
--
-- 背景: app/page.tsxのrenderRoomJoinは現在、accountsテーブルを
-- plan, invite_tokenだけを選んで素のSELECTで読んでいるが、将来
-- 「accounts: select own」ポリシーをowner_user_idのみに絞ると、
-- ゲスト(owner_user_idが自分ではない利用者)がこの読み取りで
-- 弾かれてしまう。その段階に進む前段として、ゲストでも必要な
-- 2列だけを安全に取得できるSECURITY DEFINER関数を用意する。
--
-- BAN中(is_banned_for_accountがtrue)の場合は何も返さない
-- (0行)。呼び出し元はこれをアカウント未解決と同様に扱う。
begin;

create or replace function public.get_own_account_guest_info()
returns table (
  plan text,
  invite_token text
)
language sql
security definer
set search_path = public
stable
as $$
  select a.plan, a.invite_token
  from public.accounts a
  join public.profiles p on p.account_id = a.id
  where p.user_id = auth.uid()
    and not public.is_banned_for_account(a.id);
$$;

-- Supabaseの既定でanonにも実行権限が付与される場合があるため明示的に取り消す。
revoke all on function public.get_own_account_guest_info() from public;
revoke all on function public.get_own_account_guest_info() from anon;
grant execute on function public.get_own_account_guest_info() to authenticated;

commit;
