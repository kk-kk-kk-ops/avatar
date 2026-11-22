-- 入室の仕組みの作り替えの段階B。段階A-1(account_members)を
-- 先に適用しておくこと。

-- 段階Bでaccount_membersの判定を足した。realtime_view_grantsの判定は
-- 段階Gで削除予定。
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
        or exists (
          select 1 from public.account_members am
          where am.user_id = auth.uid()
            and am.account_id = r.account_id
        )
      )
      and not public.is_banned_for_account(r.account_id)
  );
end;
$$;

revoke all on function public.can_access_avatar_room_topic() from public;
revoke all on function public.can_access_avatar_room_topic() from anon;
grant execute on function public.can_access_avatar_room_topic() to authenticated;

-- 段階Bでaccount_membersの判定を足した。realtime_view_grantsの判定は
-- 段階Gで削除予定。
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
      union
      select account_id from public.account_members where user_id = auth.uid()
    ) as mine(account_id)
    where mine.account_id in (
      select account_id from public.profiles where user_id = p_recipient_user_id
      union
      select account_id from public.realtime_view_grants
      where user_id = p_recipient_user_id and expires_at > now()
      union
      select account_id from public.account_members where user_id = p_recipient_user_id
    )
    and not public.is_banned_for_account(mine.account_id)
  );
$$;

revoke all on function public.can_message_user_channel(uuid) from public;
revoke all on function public.can_message_user_channel(uuid) from anon;
grant execute on function public.can_message_user_channel(uuid) to authenticated;
