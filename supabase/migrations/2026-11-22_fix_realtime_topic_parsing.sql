-- 段階3(2026-11-22_realtime_authorization_policies.sql)の判定関数の修正。
-- 段階3を適用した後に適用する。

-- 段階3適用後の本番テストで判明: language sql の CASE式(トピックの形を
-- 確認してから別の分岐でuuidへキャストする書き方)では、avatar-room-{UUID}
-- 以外のトピック(garbage・avatar-room-not-a-uuid・user-session-{UUID}・
-- user-{UUID})で、falseを返さずに22P02(invalid input syntax for type
-- uuid)のエラーになることが分かった(原因は推定:CASE式で囲んでも、
-- 関数内の問い合わせの計画作成時などにuuid変換が実行されることがある)。
-- トピックの形の確認とuuidへの変換を別々のPL/pgSQL文に分け、形が合った
-- 時だけ変換するように作り直す。判定の中身(誰を通すか)は変えない。
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

-- user-channel(方式C)の送信可否判定を、トピックから判定する版。
-- can_access_avatar_room_topic()と同じ理由で、トピックの形の確認と
-- uuidへの変換を別々のPL/pgSQL文に分ける。
create or replace function public.can_message_user_channel_topic()
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_topic text;
  v_recipient_user_id uuid;
begin
  v_topic := realtime.topic();
  if v_topic is null or v_topic !~ '^user-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  v_recipient_user_id := substring(v_topic from 6)::uuid;

  return public.can_message_user_channel(v_recipient_user_id);
end;
$$;

revoke all on function public.can_message_user_channel_topic() from public;
revoke all on function public.can_message_user_channel_topic() from anon;
grant execute on function public.can_message_user_channel_topic() to authenticated;

drop policy if exists "user-channel: insert same account" on realtime.messages;
create policy "user-channel: insert same account"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and public.can_message_user_channel_topic()
  );
