-- 入室の仕組みの作り替えの段階D-1。新規追加のみで、まだどこからも呼ばれない。

-- 入室の仕組みの作り替え 段階D-1。/?room=ルームID の入口(D-3)用。
-- lookup_account_by_invite_token・list_rooms_by_invite_tokenのうち
-- 入口で使う列を、招待トークンではなくaccount_membersで返す。
create or replace function public.get_member_room_entry(p_room_id uuid)
returns table (
  account_id uuid,
  template_id uuid,
  plan text,
  room_name text,
  preview_image text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.account_id,
    r.template_id,
    a.plan,
    r.name as room_name,
    r.preview_image
  from public.rooms r
  join public.accounts a on a.id = r.account_id
  where r.id = p_room_id
    and exists (
      select 1 from public.account_members m
      where m.user_id = auth.uid() and m.account_id = r.account_id
    )
    and not public.is_banned_for_account(r.account_id);
$$;

revoke all on function public.get_member_room_entry(uuid) from public;
revoke all on function public.get_member_room_entry(uuid) from anon;
grant execute on function public.get_member_room_entry(uuid) to authenticated;
