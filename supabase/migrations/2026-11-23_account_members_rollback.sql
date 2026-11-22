-- 2026-11-23_account_members.sql の戻しSQL。

drop function if exists public.get_own_or_member_room(uuid);
drop function if exists public.list_account_members(uuid);
drop function if exists public.touch_account_membership(uuid);
drop function if exists public.leave_account_membership(uuid);
drop function if exists public.list_my_room_memberships();
drop function if exists public.join_account_by_invite_token(text);

drop table if exists public.account_members;
