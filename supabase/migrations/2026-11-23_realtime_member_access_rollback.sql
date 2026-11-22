-- 2026-11-23_realtime_member_access.sql の戻しSQL。
-- 段階B適用前(2026-11-22_fix_realtime_topic_parsing.sqlの(1)・
-- 2026-11-22_realtime_authorization_policies.sqlの該当関数)の定義に戻す。

create or replace function public.can_access_avatar_room_topic()
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_topic text;
  v_room_id uuid;
begin
  v_topic := realtime.topic();
  if v_topic is null or v_topic !~ '^avatar-room-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  v_room_id := substring(v_topic from 13)::uuid;

  return exists (
    select 1
    from public.rooms r
    where r.id = v_room_id
      and (
        exists (
          select 1 from public.profiles p
          where p.user_id = auth.uid() and p.account_id = r.account_id
        )
        or exists (
          select 1 from public.realtime_view_grants g
          where g.user_id = auth.uid()
            and g.account_id = r.account_id
            and g.expires_at > now()
        )
      )
      and not public.is_banned_for_account(r.account_id)
  );
end;
$$;

revoke all on function public.can_access_avatar_room_topic() from public;
revoke all on function public.can_access_avatar_room_topic() from anon;
grant execute on function public.can_access_avatar_room_topic() to authenticated;

create or replace function public.can_message_user_channel(p_recipient_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from (
      select account_id from public.profiles where user_id = auth.uid()
      union
      select account_id from public.realtime_view_grants
      where user_id = auth.uid() and expires_at > now()
    ) as mine(account_id)
    where mine.account_id in (
      select account_id from public.profiles where user_id = p_recipient_user_id
      union
      select account_id from public.realtime_view_grants
      where user_id = p_recipient_user_id and expires_at > now()
    )
    and not public.is_banned_for_account(mine.account_id)
  );
$$;

revoke all on function public.can_message_user_channel(uuid) from public;
revoke all on function public.can_message_user_channel(uuid) from anon;
grant execute on function public.can_message_user_channel(uuid) to authenticated;
