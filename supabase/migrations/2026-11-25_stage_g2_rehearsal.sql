-- 段階G-2(2026-11-25_stage_g2_remove_invite_token_paths.sql)と、その元に
-- 戻すSQL(同フォルダの...rollback.sql)を、本番適用前に1つのトランザクション
-- の中で通して試す予行演習SQL。
--
-- 内容: ひより・+test1・+test2・+test3(いずれも成りすまし)で、Realtimeの
-- 判定関数(can_access_avatar_room_topic・can_message_user_channel)の結果を
-- 「本体を適用する前」「本体を適用した後」「元に戻した後」の3回確認し、
-- 本体適用後・元に戻した後それぞれで関数・表の有無も確認する。
--
-- begin ... rollback で囲んでいるため、実行しても本番データ・本番の関数・
-- 表は一切変化しない(結果を見るためだけのSQL)。
--
-- 適用方法: Supabase の SQL Editor で、このファイルの内容をそのまま
-- 直接実行する。最後にdo $$ … raise exception …end $$;で
-- 'RESULT:...'という1行がエラーとして表示される(raise exceptionに
-- よるもので、これによってトランザクション全体がrollbackされる)。
-- 末尾のrollback;は到達しないが、保険として書いてある。
--
-- ほかの2つのファイルとの関係: 本体(2026-11-25_stage_g2_remove_invite_
-- token_paths.sql)の①〜⑥と、元に戻すSQL(同...rollback.sql)の中身を、
-- begin;・commit;を除いてそのまま下に書き写している(文面は本体・
-- 元に戻すSQLと完全に一致させること。直す場合は3つのファイルとも直す)。
--
-- 期待するRESULTの例(T=ルームの判定〈ひより・+test2・+test3・+test1×
-- GlobyTownのルーム、+test1×自分のルーム〉、C=個人宛ての判定〈ひより→
-- +test2・+test2→ひより・+test3→ひより・+test1→+test2〉の順):
-- RESULT:before:T=t,t,f,f,t C=t,t,f,f | after_main:T=t,t,f,f,t C=t,t,f,f | after_rollback:T=t,t,f,f,t C=t,t,f,f | after_main_funcs=0/2/no/no | after_rollback_funcs=12/2/yes/no

begin;

-- ============================================================
-- before: 本体を適用する前の確認
-- ============================================================
select set_config('test.out', 'before:T=', true);

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12', true);
  perform set_config('request.jwt.claims', '{"sub":"ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12","role":"authenticated"}', true);
  perform set_config('realtime.topic', 'avatar-room-3e4d2e3b-13e2-4e69-84e2-b959400bfbb4', true);
  if public.can_access_avatar_room_topic() then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || 'E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'fcd80cd6-2a10-4e6c-b848-fbbfb9992311', true);
  perform set_config('request.jwt.claims', '{"sub":"fcd80cd6-2a10-4e6c-b848-fbbfb9992311","role":"authenticated"}', true);
  perform set_config('realtime.topic', 'avatar-room-3e4d2e3b-13e2-4e69-84e2-b959400bfbb4', true);
  if public.can_access_avatar_room_topic() then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '883a628e-155b-4e76-96fa-c775fe5480d5', true);
  perform set_config('request.jwt.claims', '{"sub":"883a628e-155b-4e76-96fa-c775fe5480d5","role":"authenticated"}', true);
  perform set_config('realtime.topic', 'avatar-room-3e4d2e3b-13e2-4e69-84e2-b959400bfbb4', true);
  if public.can_access_avatar_room_topic() then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '07a74578-f5bb-4b91-bf11-752f008a583c', true);
  perform set_config('request.jwt.claims', '{"sub":"07a74578-f5bb-4b91-bf11-752f008a583c","role":"authenticated"}', true);
  perform set_config('realtime.topic', 'avatar-room-3e4d2e3b-13e2-4e69-84e2-b959400bfbb4', true);
  if public.can_access_avatar_room_topic() then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '07a74578-f5bb-4b91-bf11-752f008a583c', true);
  perform set_config('request.jwt.claims', '{"sub":"07a74578-f5bb-4b91-bf11-752f008a583c","role":"authenticated"}', true);
  perform set_config('realtime.topic', 'avatar-room-06396cb3-1ac8-4bd6-addd-d33f6ec73d20', true);
  if public.can_access_avatar_room_topic() then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

select set_config('test.out', current_setting('test.out', true) || ' C=', true);

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12', true);
  perform set_config('request.jwt.claims', '{"sub":"ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12","role":"authenticated"}', true);
  if public.can_message_user_channel('fcd80cd6-2a10-4e6c-b848-fbbfb9992311'::uuid) then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || 'E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'fcd80cd6-2a10-4e6c-b848-fbbfb9992311', true);
  perform set_config('request.jwt.claims', '{"sub":"fcd80cd6-2a10-4e6c-b848-fbbfb9992311","role":"authenticated"}', true);
  if public.can_message_user_channel('ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12'::uuid) then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '883a628e-155b-4e76-96fa-c775fe5480d5', true);
  perform set_config('request.jwt.claims', '{"sub":"883a628e-155b-4e76-96fa-c775fe5480d5","role":"authenticated"}', true);
  if public.can_message_user_channel('ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12'::uuid) then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '07a74578-f5bb-4b91-bf11-752f008a583c', true);
  perform set_config('request.jwt.claims', '{"sub":"07a74578-f5bb-4b91-bf11-752f008a583c","role":"authenticated"}', true);
  if public.can_message_user_channel('fcd80cd6-2a10-4e6c-b848-fbbfb9992311'::uuid) then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

-- ============================================================
-- 本体(2026-11-25_stage_g2_remove_invite_token_paths.sql)の①〜⑥を
-- そのまま書き写す(begin;・commit;は書かない)。
-- ============================================================

-- ① 事前の確認: realtime_view_grants に期限切れでない行が残っていないか。
do $$
declare
  v_active_grants bigint;
begin
  select count(*) into v_active_grants
  from public.realtime_view_grants
  where expires_at > now();

  if v_active_grants > 0 then
    raise exception
      '段階G-2: realtime_view_grants に有効な行が % 件残っています。取り消します。',
      v_active_grants;
  end if;
end $$;

-- ② Realtimeの判定関数を、realtime_view_grantsの分岐だけを抜いた形に
--    作り直す。
-- 段階G-2で realtime_view_grants の分岐を削除。
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

-- 段階G-2で realtime_view_grants の分岐を削除。
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
      select account_id from public.account_members where user_id = auth.uid()
    ) as mine(account_id)
    where mine.account_id in (
      select account_id from public.profiles where user_id = p_recipient_user_id
      union
      select account_id from public.account_members where user_id = p_recipient_user_id
    )
    and not public.is_banned_for_account(mine.account_id)
  );
$$;

revoke all on function public.can_message_user_channel(uuid) from public;
revoke all on function public.can_message_user_channel(uuid) from anon;
grant execute on function public.can_message_user_channel(uuid) to authenticated;

-- ③ もう呼ばれていない12個の関数を削除する(if existsは付けない)。
drop function public.list_rooms_by_invite_token(text);
drop function public.list_chat_messages_by_invite_token(text, uuid, uuid);
drop function public.send_chat_message_by_invite_token(text, uuid, uuid, text, text, text, text);
drop function public.edit_chat_message_by_invite_token(text, uuid, text, timestamptz);
drop function public.delete_chat_message_by_invite_token(text, uuid, timestamptz);
drop function public.create_chat_group_by_invite_token(text, uuid, uuid[]);
drop function public.list_chat_threads_by_invite_token(text, uuid);
drop function public.create_dm_mention_by_invite_token(text, uuid, text);
drop function public.set_chat_message_reaction_by_invite_token(text, uuid, text);
drop function public.remove_chat_message_reaction_by_invite_token(text, uuid);
drop function public.list_chat_message_reactions_by_invite_token(text, uuid[]);
drop function public.grant_realtime_view_access(text);

-- ④ viewOnlyの許可証の表を削除する(if existsは付けない)。
drop table public.realtime_view_grants;

-- ⑤ 段階Fの控えの表を削除する(if existsは付けない)。
drop table public.stage_f_legacy_guest_backup;

-- ⑥ 事後の確認。
do $$
declare
  v_errors text := '';
begin
  if to_regprocedure('public.list_rooms_by_invite_token(text)') is not null then
    v_errors := v_errors || '; list_rooms_by_invite_token が残っている';
  end if;
  if to_regprocedure('public.list_chat_messages_by_invite_token(text, uuid, uuid)') is not null then
    v_errors := v_errors || '; list_chat_messages_by_invite_token が残っている';
  end if;
  if to_regprocedure('public.send_chat_message_by_invite_token(text, uuid, uuid, text, text, text, text)') is not null then
    v_errors := v_errors || '; send_chat_message_by_invite_token が残っている';
  end if;
  if to_regprocedure('public.edit_chat_message_by_invite_token(text, uuid, text, timestamptz)') is not null then
    v_errors := v_errors || '; edit_chat_message_by_invite_token が残っている';
  end if;
  if to_regprocedure('public.delete_chat_message_by_invite_token(text, uuid, timestamptz)') is not null then
    v_errors := v_errors || '; delete_chat_message_by_invite_token が残っている';
  end if;
  if to_regprocedure('public.create_chat_group_by_invite_token(text, uuid, uuid[])') is not null then
    v_errors := v_errors || '; create_chat_group_by_invite_token が残っている';
  end if;
  if to_regprocedure('public.list_chat_threads_by_invite_token(text, uuid)') is not null then
    v_errors := v_errors || '; list_chat_threads_by_invite_token が残っている';
  end if;
  if to_regprocedure('public.create_dm_mention_by_invite_token(text, uuid, text)') is not null then
    v_errors := v_errors || '; create_dm_mention_by_invite_token が残っている';
  end if;
  if to_regprocedure('public.set_chat_message_reaction_by_invite_token(text, uuid, text)') is not null then
    v_errors := v_errors || '; set_chat_message_reaction_by_invite_token が残っている';
  end if;
  if to_regprocedure('public.remove_chat_message_reaction_by_invite_token(text, uuid)') is not null then
    v_errors := v_errors || '; remove_chat_message_reaction_by_invite_token が残っている';
  end if;
  if to_regprocedure('public.list_chat_message_reactions_by_invite_token(text, uuid[])') is not null then
    v_errors := v_errors || '; list_chat_message_reactions_by_invite_token が残っている';
  end if;
  if to_regprocedure('public.grant_realtime_view_access(text)') is not null then
    v_errors := v_errors || '; grant_realtime_view_access が残っている';
  end if;

  if to_regprocedure('public.lookup_account_by_invite_token(text)') is null
     or to_regprocedure('public.join_account_by_invite_token(text)') is null then
    v_errors := v_errors || '; lookup_account_by_invite_token と join_account_by_invite_token がそろって残っていない';
  end if;

  if to_regclass('public.realtime_view_grants') is not null then
    v_errors := v_errors || '; realtime_view_grants の表が残っている';
  end if;
  if to_regclass('public.stage_f_legacy_guest_backup') is not null then
    v_errors := v_errors || '; stage_f_legacy_guest_backup の表が残っている';
  end if;

  if exists (
    select 1 from pg_proc
    where oid = 'public.can_access_avatar_room_topic()'::regprocedure
      and prosrc like '%realtime_view_grants%'
  ) then
    v_errors := v_errors || '; can_access_avatar_room_topic の中身に realtime_view_grants が残っている';
  end if;
  if exists (
    select 1 from pg_proc
    where oid = 'public.can_message_user_channel(uuid)'::regprocedure
      and prosrc like '%realtime_view_grants%'
  ) then
    v_errors := v_errors || '; can_message_user_channel の中身に realtime_view_grants が残っている';
  end if;

  if v_errors <> '' then
    raise exception '段階G-2: 事後確認に失敗しました%。取り消します。', v_errors;
  end if;
end $$;

-- ============================================================
-- after_main: 本体を適用した後の確認
-- ============================================================
select set_config('test.out', current_setting('test.out', true) || ' | after_main:T=', true);

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12', true);
  perform set_config('request.jwt.claims', '{"sub":"ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12","role":"authenticated"}', true);
  perform set_config('realtime.topic', 'avatar-room-3e4d2e3b-13e2-4e69-84e2-b959400bfbb4', true);
  if public.can_access_avatar_room_topic() then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || 'E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'fcd80cd6-2a10-4e6c-b848-fbbfb9992311', true);
  perform set_config('request.jwt.claims', '{"sub":"fcd80cd6-2a10-4e6c-b848-fbbfb9992311","role":"authenticated"}', true);
  perform set_config('realtime.topic', 'avatar-room-3e4d2e3b-13e2-4e69-84e2-b959400bfbb4', true);
  if public.can_access_avatar_room_topic() then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '883a628e-155b-4e76-96fa-c775fe5480d5', true);
  perform set_config('request.jwt.claims', '{"sub":"883a628e-155b-4e76-96fa-c775fe5480d5","role":"authenticated"}', true);
  perform set_config('realtime.topic', 'avatar-room-3e4d2e3b-13e2-4e69-84e2-b959400bfbb4', true);
  if public.can_access_avatar_room_topic() then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '07a74578-f5bb-4b91-bf11-752f008a583c', true);
  perform set_config('request.jwt.claims', '{"sub":"07a74578-f5bb-4b91-bf11-752f008a583c","role":"authenticated"}', true);
  perform set_config('realtime.topic', 'avatar-room-3e4d2e3b-13e2-4e69-84e2-b959400bfbb4', true);
  if public.can_access_avatar_room_topic() then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '07a74578-f5bb-4b91-bf11-752f008a583c', true);
  perform set_config('request.jwt.claims', '{"sub":"07a74578-f5bb-4b91-bf11-752f008a583c","role":"authenticated"}', true);
  perform set_config('realtime.topic', 'avatar-room-06396cb3-1ac8-4bd6-addd-d33f6ec73d20', true);
  if public.can_access_avatar_room_topic() then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

select set_config('test.out', current_setting('test.out', true) || ' C=', true);

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12', true);
  perform set_config('request.jwt.claims', '{"sub":"ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12","role":"authenticated"}', true);
  if public.can_message_user_channel('fcd80cd6-2a10-4e6c-b848-fbbfb9992311'::uuid) then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || 'E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'fcd80cd6-2a10-4e6c-b848-fbbfb9992311', true);
  perform set_config('request.jwt.claims', '{"sub":"fcd80cd6-2a10-4e6c-b848-fbbfb9992311","role":"authenticated"}', true);
  if public.can_message_user_channel('ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12'::uuid) then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '883a628e-155b-4e76-96fa-c775fe5480d5', true);
  perform set_config('request.jwt.claims', '{"sub":"883a628e-155b-4e76-96fa-c775fe5480d5","role":"authenticated"}', true);
  if public.can_message_user_channel('ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12'::uuid) then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '07a74578-f5bb-4b91-bf11-752f008a583c', true);
  perform set_config('request.jwt.claims', '{"sub":"07a74578-f5bb-4b91-bf11-752f008a583c","role":"authenticated"}', true);
  if public.can_message_user_channel('fcd80cd6-2a10-4e6c-b848-fbbfb9992311'::uuid) then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

-- after_mainの関数・表の有無。
do $$
declare
  v_dropped_remaining int := 0;
  v_kept_remaining int := 0;
begin
  if to_regprocedure('public.list_rooms_by_invite_token(text)') is not null then v_dropped_remaining := v_dropped_remaining + 1; end if;
  if to_regprocedure('public.list_chat_messages_by_invite_token(text, uuid, uuid)') is not null then v_dropped_remaining := v_dropped_remaining + 1; end if;
  if to_regprocedure('public.send_chat_message_by_invite_token(text, uuid, uuid, text, text, text, text)') is not null then v_dropped_remaining := v_dropped_remaining + 1; end if;
  if to_regprocedure('public.edit_chat_message_by_invite_token(text, uuid, text, timestamptz)') is not null then v_dropped_remaining := v_dropped_remaining + 1; end if;
  if to_regprocedure('public.delete_chat_message_by_invite_token(text, uuid, timestamptz)') is not null then v_dropped_remaining := v_dropped_remaining + 1; end if;
  if to_regprocedure('public.create_chat_group_by_invite_token(text, uuid, uuid[])') is not null then v_dropped_remaining := v_dropped_remaining + 1; end if;
  if to_regprocedure('public.list_chat_threads_by_invite_token(text, uuid)') is not null then v_dropped_remaining := v_dropped_remaining + 1; end if;
  if to_regprocedure('public.create_dm_mention_by_invite_token(text, uuid, text)') is not null then v_dropped_remaining := v_dropped_remaining + 1; end if;
  if to_regprocedure('public.set_chat_message_reaction_by_invite_token(text, uuid, text)') is not null then v_dropped_remaining := v_dropped_remaining + 1; end if;
  if to_regprocedure('public.remove_chat_message_reaction_by_invite_token(text, uuid)') is not null then v_dropped_remaining := v_dropped_remaining + 1; end if;
  if to_regprocedure('public.list_chat_message_reactions_by_invite_token(text, uuid[])') is not null then v_dropped_remaining := v_dropped_remaining + 1; end if;
  if to_regprocedure('public.grant_realtime_view_access(text)') is not null then v_dropped_remaining := v_dropped_remaining + 1; end if;

  if to_regprocedure('public.lookup_account_by_invite_token(text)') is not null then v_kept_remaining := v_kept_remaining + 1; end if;
  if to_regprocedure('public.join_account_by_invite_token(text)') is not null then v_kept_remaining := v_kept_remaining + 1; end if;

  perform set_config(
    'test.out',
    current_setting('test.out', true) || format(
      ' | after_main_funcs=%s/%s/%s/%s',
      v_dropped_remaining,
      v_kept_remaining,
      case when to_regclass('public.realtime_view_grants') is not null then 'yes' else 'no' end,
      case when to_regclass('public.stage_f_legacy_guest_backup') is not null then 'yes' else 'no' end
    ),
    true
  );
end $$;

-- ============================================================
-- 元に戻すSQL(2026-11-25_stage_g2_remove_invite_token_paths_rollback.sql)の
-- 中身をそのまま書き写す(begin;・commit;は書かない)。
-- ============================================================

-- 1. realtime_view_grantsの表を作り直す。
create table if not exists public.realtime_view_grants (
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  expires_at timestamptz not null,
  primary key (user_id, account_id)
);
alter table public.realtime_view_grants enable row level security;
drop policy if exists "realtime_view_grants: select own" on public.realtime_view_grants;
create policy "realtime_view_grants: select own"
  on public.realtime_view_grants for select
  using (user_id = auth.uid());

-- 2. grant_realtime_view_accessを作り直す。
create or replace function public.grant_realtime_view_access(token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  select a.id into v_account_id
  from public.accounts a
  where a.invite_token = token;
  if v_account_id is null then
    raise exception '無効な招待リンクです';
  end if;

  -- BANされている場合は許可証を発行しない。
  if public.is_banned_for_account(v_account_id) then
    raise exception 'このルームへのアクセスが制限されています';
  end if;

  insert into public.realtime_view_grants (user_id, account_id, expires_at)
  values (auth.uid(), v_account_id, now() + interval '30 minutes')
  on conflict (user_id, account_id) do update set expires_at = excluded.expires_at;
end;
$$;

revoke all on function public.grant_realtime_view_access(text) from public;
revoke all on function public.grant_realtime_view_access(text) from anon;
grant execute on function public.grant_realtime_view_access(text) to authenticated;

-- 3. 招待URL経由のルーム一覧取得関数を作り直す。
create or replace function public.list_rooms_by_invite_token(token text)
returns table (
  id uuid,
  account_id uuid,
  template_id uuid,
  name text,
  preview_image text
)
language sql
security definer
set search_path = public
as $$
  -- BANされている場合は一覧から除く(2026-11追加)。
  select r.id, r.account_id, r.template_id, r.name, r.preview_image
  from public.rooms r
  join public.accounts a on a.id = r.account_id
  where a.invite_token = token
    and not public.is_banned_for_account(a.id)
  order by r.created_at asc;
$$;

revoke all on function public.list_rooms_by_invite_token(text) from public;
revoke all on function public.list_rooms_by_invite_token(text) from anon;
grant execute on function public.list_rooms_by_invite_token(text) to authenticated;

-- 4. DM履歴取得関数を作り直す。
create or replace function public.list_chat_messages_by_invite_token(
  token text,
  target_room_id uuid,
  peer_user_id uuid
)
returns table (
  id uuid,
  sender_user_id uuid,
  sender_name text,
  message text,
  created_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  image_path text,
  thumbnail_path text
)
language sql
security definer
set search_path = public
as $$
  -- BANされている場合は一切見えない(2026-11追加)。
  select m.id, m.sender_user_id, m.sender_name, m.message, m.created_at,
    m.edited_at, m.deleted_at, m.image_path, m.thumbnail_path
  from public.chat_messages m
  join public.rooms r on r.id = m.room_id
  join public.accounts a on a.id = r.account_id
  where a.invite_token = token
    and r.id = target_room_id
    and not public.is_banned_for_account(a.id)
    and (
      (m.sender_user_id = auth.uid() and m.recipient_user_id = peer_user_id)
      or (m.sender_user_id = peer_user_id and m.recipient_user_id = auth.uid())
    )
  order by m.created_at asc
  limit 50;
$$;

revoke all on function public.list_chat_messages_by_invite_token(text, uuid, uuid) from public;
revoke all on function public.list_chat_messages_by_invite_token(text, uuid, uuid) from anon;
grant execute on function public.list_chat_messages_by_invite_token(text, uuid, uuid) to authenticated;

-- 5. DM送信関数を作り直す。
create or replace function public.send_chat_message_by_invite_token(
  token text,
  target_room_id uuid,
  recipient_user_id uuid,
  sender_name text,
  message text,
  p_image_path text default null,
  p_thumbnail_path text default null
)
returns table (id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if recipient_user_id = auth.uid() then
    raise exception '自分自身には送信できません';
  end if;
  if char_length(message) > 500 then
    raise exception 'メッセージの長さが不正です';
  end if;
  if char_length(message) = 0 and p_image_path is null then
    raise exception 'メッセージの長さが不正です';
  end if;

  select r.id into v_room_id
  from public.rooms r
  join public.accounts a on a.id = r.account_id
  where a.invite_token = token
    and r.id = target_room_id;

  if v_room_id is null then
    raise exception 'このルームへのアクセス権がありません';
  end if;

  -- BAN済みユーザーへの対策(2026-11追加)。
  if public.is_banned_for_room(v_room_id) then
    raise exception 'このルームへのアクセスが制限されています';
  end if;

  -- 画像・サムネイル添付時のなりすまし防止(通常ルートのRLSと同じ検証)。
  if p_image_path is not null
     and p_image_path not like (v_room_id::text || '/' || auth.uid()::text || '/%') then
    raise exception '不正な画像パスです';
  end if;

  if p_thumbnail_path is not null
     and p_thumbnail_path not like (v_room_id::text || '/' || auth.uid()::text || '/%') then
    raise exception '不正なサムネイルパスです';
  end if;

  return query
    insert into public.chat_messages
      (room_id, sender_user_id, recipient_user_id, sender_name, message, image_path, thumbnail_path)
    values (v_room_id, auth.uid(), recipient_user_id, sender_name, message, p_image_path, p_thumbnail_path)
    returning chat_messages.id, chat_messages.created_at;
end;
$$;

revoke all on function public.send_chat_message_by_invite_token(text, uuid, uuid, text, text, text, text) from public;
revoke all on function public.send_chat_message_by_invite_token(text, uuid, uuid, text, text, text, text) from anon;
grant execute on function public.send_chat_message_by_invite_token(text, uuid, uuid, text, text, text, text) to authenticated;

-- 6. DM編集関数を作り直す。
create or replace function public.edit_chat_message_by_invite_token(
  token text,
  p_message_id uuid,
  p_new_message text,
  p_edited_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if char_length(p_new_message) = 0 or char_length(p_new_message) > 500 then
    raise exception 'メッセージの長さが不正です';
  end if;

  select r.id into v_room_id
  from public.chat_messages m
  join public.rooms r on r.id = m.room_id
  join public.accounts a on a.id = r.account_id
  where a.invite_token = token
    and m.id = p_message_id
    and m.sender_user_id = auth.uid()
    and m.deleted_at is null;

  if v_room_id is null then
    raise exception 'このメッセージは編集できません';
  end if;

  -- BAN済みユーザーへの対策(2026-11追加)。
  if public.is_banned_for_room(v_room_id) then
    raise exception 'このルームへのアクセスが制限されています';
  end if;

  update public.chat_messages
  set message = p_new_message, edited_at = p_edited_at
  where id = p_message_id;
end;
$$;

revoke all on function public.edit_chat_message_by_invite_token(text, uuid, text, timestamptz) from public;
revoke all on function public.edit_chat_message_by_invite_token(text, uuid, text, timestamptz) from anon;
grant execute on function public.edit_chat_message_by_invite_token(text, uuid, text, timestamptz) to authenticated;

-- 7. DM削除関数を作り直す。
create or replace function public.delete_chat_message_by_invite_token(
  token text,
  p_message_id uuid,
  p_deleted_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;

  select r.id into v_room_id
  from public.chat_messages m
  join public.rooms r on r.id = m.room_id
  join public.accounts a on a.id = r.account_id
  where a.invite_token = token
    and m.id = p_message_id
    and m.sender_user_id = auth.uid();

  if v_room_id is null then
    raise exception 'このメッセージは削除できません';
  end if;

  -- BAN済みユーザーへの対策(2026-11追加)。
  if public.is_banned_for_room(v_room_id) then
    raise exception 'このルームへのアクセスが制限されています';
  end if;

  update public.chat_messages
  set message = '', deleted_at = p_deleted_at
  where id = p_message_id;
end;
$$;

revoke all on function public.delete_chat_message_by_invite_token(text, uuid, timestamptz) from public;
revoke all on function public.delete_chat_message_by_invite_token(text, uuid, timestamptz) from anon;
grant execute on function public.delete_chat_message_by_invite_token(text, uuid, timestamptz) to authenticated;

-- 8. グループチャット作成関数を作り直す。
create or replace function public.create_chat_group_by_invite_token(
  token text,
  target_room_id uuid,
  p_member_user_ids uuid[]
)
returns table (group_id uuid, already_existed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_member uuid;
  v_target_members uuid[];
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if p_member_user_ids is null or array_length(p_member_user_ids, 1) is null then
    raise exception '参加者を1人以上選択してください';
  end if;
  if not exists (
    select 1 from public.rooms r
    join public.accounts a on a.id = r.account_id
    where r.id = target_room_id and a.invite_token = token
  ) then
    raise exception 'このルームへのアクセス権がありません';
  end if;

  -- BAN済みユーザーへの対策(2026-11追加)。
  if public.is_banned_for_room(target_room_id) then
    raise exception 'このルームへのアクセスが制限されています';
  end if;

  -- 重複作成防止(2026-08-30追加。create_chat_group()と同じロジック)。
  select array_agg(distinct m order by m) into v_target_members
  from unnest(array_append(p_member_user_ids, auth.uid())) as m;

  select g.id into v_group_id
  from public.chat_groups g
  where g.room_id = target_room_id
    and (
      select array_agg(gm.user_id order by gm.user_id)
      from public.chat_group_members gm
      where gm.group_id = g.id
    ) = v_target_members
  limit 1;

  if v_group_id is not null then
    return query select v_group_id, true;
    return;
  end if;

  insert into public.chat_groups (room_id, created_by)
  values (target_room_id, auth.uid())
  returning id into v_group_id;

  insert into public.chat_group_members (group_id, user_id)
  values (v_group_id, auth.uid())
  on conflict do nothing;

  foreach v_member in array p_member_user_ids loop
    if v_member <> auth.uid() then
      insert into public.chat_group_members (group_id, user_id)
      values (v_group_id, v_member)
      on conflict do nothing;
    end if;
  end loop;

  return query select v_group_id, false;
end;
$$;

revoke all on function public.create_chat_group_by_invite_token(text, uuid, uuid[]) from public;
revoke all on function public.create_chat_group_by_invite_token(text, uuid, uuid[]) from anon;
grant execute on function public.create_chat_group_by_invite_token(text, uuid, uuid[]) to authenticated;

-- 9. スレッド一覧取得関数を作り直す。
create or replace function public.list_chat_threads_by_invite_token(
  token text,
  target_room_id uuid
)
returns table (
  thread_id uuid,
  is_group boolean,
  thread_name text,
  last_message text,
  last_message_at timestamptz,
  unread_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  -- BANされている場合は一切見えない(2026-11追加)。allowedはDM側
  -- (peers経由)で元々参照していたが、グループ側(group_rows)は参照して
  -- いなかったため、末尾のunionの両方をallowedでゲートするよう変更する。
  with allowed as (
    select 1
    from public.rooms r
    join public.accounts a on a.id = r.account_id
    where r.id = target_room_id
      and a.invite_token = token
      and not public.is_banned_for_account(a.id)
  ),
  peers as (
    select distinct
      case when m.sender_user_id = auth.uid() then m.recipient_user_id else m.sender_user_id end as peer_id
    from public.chat_messages m
    where m.room_id = target_room_id
      and m.recipient_user_id is not null
      and (m.sender_user_id = auth.uid() or m.recipient_user_id = auth.uid())
      and exists (select 1 from allowed)
  ),
  dm_last as (
    select distinct on (pe.peer_id)
      pe.peer_id,
      m.message,
      m.sender_name,
      m.deleted_at,
      m.created_at
    from peers pe
    join public.chat_messages m
      on m.room_id = target_room_id
      and (
        (m.sender_user_id = auth.uid() and m.recipient_user_id = pe.peer_id)
        or (m.recipient_user_id = auth.uid() and m.sender_user_id = pe.peer_id)
      )
    order by pe.peer_id, m.created_at desc
  ),
  dm_unread as (
    select
      m.sender_user_id as peer_id,
      count(*) as cnt
    from public.chat_messages m
    left join public.chat_read_state rs
      on rs.room_id = target_room_id and rs.user_id = auth.uid() and rs.peer_user_id = m.sender_user_id
    where m.room_id = target_room_id
      and m.recipient_user_id = auth.uid()
      and m.deleted_at is null
      and m.created_at > coalesce(rs.last_read_at, 'epoch'::timestamptz)
    group by m.sender_user_id
  ),
  dm_rows as (
    select
      lm.peer_id as thread_id,
      false as is_group,
      coalesce(pr.display_name, lm.sender_name) as thread_name,
      case when lm.deleted_at is not null then '' else lm.message end as last_message,
      lm.created_at as last_message_at,
      coalesce(u.cnt, 0) as unread_count
    from dm_last lm
    left join public.profiles pr on pr.user_id = lm.peer_id
    left join dm_unread u on u.peer_id = lm.peer_id
  ),
  my_groups as (
    select g.id as group_id, g.created_at, g.name as custom_name
    from public.chat_groups g
    join public.chat_group_members gm on gm.group_id = g.id and gm.user_id = auth.uid()
    where g.room_id = target_room_id
  ),
  group_names as (
    select
      gm.group_id,
      string_agg(coalesce(pr.display_name, 'メンバー'), '、' order by pr.display_name) as name
    from public.chat_group_members gm
    left join public.profiles pr on pr.user_id = gm.user_id
    where gm.group_id in (select group_id from my_groups)
      and gm.user_id <> auth.uid()
    group by gm.group_id
  ),
  group_last as (
    select distinct on (m.group_id)
      m.group_id, m.message, m.deleted_at, m.created_at
    from public.chat_messages m
    where m.group_id in (select group_id from my_groups)
    order by m.group_id, m.created_at desc
  ),
  group_unread as (
    select m.group_id, count(*) as cnt
    from public.chat_messages m
    left join public.chat_group_read_state rs
      on rs.group_id = m.group_id and rs.user_id = auth.uid()
    where m.group_id in (select group_id from my_groups)
      and m.sender_user_id <> auth.uid()
      and m.deleted_at is null
      and m.created_at > coalesce(rs.last_read_at, 'epoch'::timestamptz)
    group by m.group_id
  ),
  group_rows as (
    select
      mg.group_id as thread_id,
      true as is_group,
      coalesce(mg.custom_name, gn.name, 'グループ') as thread_name,
      case when gl.deleted_at is not null then '' else coalesce(gl.message, '') end as last_message,
      coalesce(gl.created_at, mg.created_at) as last_message_at,
      coalesce(gu.cnt, 0) as unread_count
    from my_groups mg
    left join group_names gn on gn.group_id = mg.group_id
    left join group_last gl on gl.group_id = mg.group_id
    left join group_unread gu on gu.group_id = mg.group_id
  )
  select * from dm_rows where exists (select 1 from allowed)
  union all
  select * from group_rows where exists (select 1 from allowed)
  order by last_message_at desc;
$$;

revoke all on function public.list_chat_threads_by_invite_token(text, uuid) from public;
revoke all on function public.list_chat_threads_by_invite_token(text, uuid) from anon;
grant execute on function public.list_chat_threads_by_invite_token(text, uuid) to authenticated;

-- 10. DMメンション通知作成関数を作り直す。
create or replace function public.create_dm_mention_by_invite_token(
  token text,
  p_message_id uuid,
  p_mentioner_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_room_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;

  select m.recipient_user_id, r.id into v_recipient, v_room_id
  from public.chat_messages m
  join public.rooms r on r.id = m.room_id
  join public.accounts a on a.id = r.account_id
  where a.invite_token = token
    and m.id = p_message_id
    and m.sender_user_id = auth.uid()
    and m.recipient_user_id is not null;

  if v_recipient is null then
    raise exception 'このメッセージにはメンション通知を作成できません';
  end if;

  -- BAN済みユーザーへの対策(2026-11追加)。
  if public.is_banned_for_room(v_room_id) then
    raise exception 'このルームへのアクセスが制限されています';
  end if;

  insert into public.chat_mentions
    (message_id, group_id, recipient_user_id, mentioned_user_id, mentioner_user_id, mentioner_name, is_everyone)
  values
    (p_message_id, null, v_recipient, v_recipient, auth.uid(), p_mentioner_name, false);
end;
$$;

revoke all on function public.create_dm_mention_by_invite_token(text, uuid, text) from public;
revoke all on function public.create_dm_mention_by_invite_token(text, uuid, text) from anon;
grant execute on function public.create_dm_mention_by_invite_token(text, uuid, text) to authenticated;

-- 11. リアクション付与関数を作り直す。
create or replace function public.set_chat_message_reaction_by_invite_token(
  token text,
  p_message_id uuid,
  p_emoji text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if p_emoji not in ('👍', '❤️', '😂', '😮', '👏') then
    raise exception '不正な絵文字です';
  end if;

  select r.id into v_room_id
  from public.chat_messages m
  join public.rooms r on r.id = m.room_id
  join public.accounts a on a.id = r.account_id
  where a.invite_token = token
    and m.id = p_message_id;

  if v_room_id is null then
    raise exception 'このメッセージにはリアクションできません';
  end if;

  -- BAN済みユーザーへの対策(2026-11追加)。
  if public.is_banned_for_room(v_room_id) then
    raise exception 'このルームへのアクセスが制限されています';
  end if;

  insert into public.chat_message_reactions (message_id, user_id, emoji)
  values (p_message_id, auth.uid(), p_emoji)
  on conflict (message_id, user_id)
  do update set emoji = excluded.emoji, created_at = now();
end;
$$;

revoke all on function public.set_chat_message_reaction_by_invite_token(text, uuid, text) from public;
revoke all on function public.set_chat_message_reaction_by_invite_token(text, uuid, text) from anon;
grant execute on function public.set_chat_message_reaction_by_invite_token(text, uuid, text) to authenticated;

-- 12. リアクション取り消し関数を作り直す。
create or replace function public.remove_chat_message_reaction_by_invite_token(
  token text,
  p_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;

  -- BAN済みユーザーへの対策(2026-11追加)。削除対象が見つからない場合は
  -- このチェックをスキップし、下のDELETE文(0件になるだけ)に委ねる。
  select rm.id into v_room_id
  from public.chat_message_reactions r
  join public.chat_messages m on m.id = r.message_id
  join public.rooms rm on rm.id = m.room_id
  join public.accounts a on a.id = rm.account_id
  where a.invite_token = token
    and r.message_id = p_message_id
    and r.user_id = auth.uid();

  if v_room_id is not null and public.is_banned_for_room(v_room_id) then
    raise exception 'このルームへのアクセスが制限されています';
  end if;

  delete from public.chat_message_reactions r
  using public.chat_messages m,
        public.rooms rm,
        public.accounts a
  where r.message_id = m.id
    and rm.id = m.room_id
    and a.id = rm.account_id
    and a.invite_token = token
    and r.message_id = p_message_id
    and r.user_id = auth.uid();
end;
$$;

revoke all on function public.remove_chat_message_reaction_by_invite_token(text, uuid) from public;
revoke all on function public.remove_chat_message_reaction_by_invite_token(text, uuid) from anon;
grant execute on function public.remove_chat_message_reaction_by_invite_token(text, uuid) to authenticated;

-- 13. リアクション一覧取得関数を作り直す。
create or replace function public.list_chat_message_reactions_by_invite_token(
  token text,
  p_message_ids uuid[]
)
returns table (message_id uuid, user_id uuid, emoji text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;

  -- BANされている場合は一切見えない(2026-11追加)。
  return query
    select r.message_id, r.user_id, r.emoji
    from public.chat_message_reactions r
    join public.chat_messages m on m.id = r.message_id
    join public.rooms rm on rm.id = m.room_id
    join public.accounts a on a.id = rm.account_id
    where a.invite_token = token
      and r.message_id = any(p_message_ids)
      and not public.is_banned_for_account(a.id);
end;
$$;

revoke all on function public.list_chat_message_reactions_by_invite_token(text, uuid[]) from public;
revoke all on function public.list_chat_message_reactions_by_invite_token(text, uuid[]) from anon;
grant execute on function public.list_chat_message_reactions_by_invite_token(text, uuid[]) to authenticated;

-- 14. Realtimeの判定関数を、realtime_view_grantsの分岐を含む元の定義に戻す。
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

-- 15. 最終確認(元に戻すSQLと同じ内容)。
do $$
declare
  v_errors text := '';
begin
  if to_regprocedure('public.list_rooms_by_invite_token(text)') is null then
    v_errors := v_errors || '; list_rooms_by_invite_token が無い';
  end if;
  if to_regprocedure('public.list_chat_messages_by_invite_token(text, uuid, uuid)') is null then
    v_errors := v_errors || '; list_chat_messages_by_invite_token が無い';
  end if;
  if to_regprocedure('public.send_chat_message_by_invite_token(text, uuid, uuid, text, text, text, text)') is null then
    v_errors := v_errors || '; send_chat_message_by_invite_token が無い';
  end if;
  if to_regprocedure('public.edit_chat_message_by_invite_token(text, uuid, text, timestamptz)') is null then
    v_errors := v_errors || '; edit_chat_message_by_invite_token が無い';
  end if;
  if to_regprocedure('public.delete_chat_message_by_invite_token(text, uuid, timestamptz)') is null then
    v_errors := v_errors || '; delete_chat_message_by_invite_token が無い';
  end if;
  if to_regprocedure('public.create_chat_group_by_invite_token(text, uuid, uuid[])') is null then
    v_errors := v_errors || '; create_chat_group_by_invite_token が無い';
  end if;
  if to_regprocedure('public.list_chat_threads_by_invite_token(text, uuid)') is null then
    v_errors := v_errors || '; list_chat_threads_by_invite_token が無い';
  end if;
  if to_regprocedure('public.create_dm_mention_by_invite_token(text, uuid, text)') is null then
    v_errors := v_errors || '; create_dm_mention_by_invite_token が無い';
  end if;
  if to_regprocedure('public.set_chat_message_reaction_by_invite_token(text, uuid, text)') is null then
    v_errors := v_errors || '; set_chat_message_reaction_by_invite_token が無い';
  end if;
  if to_regprocedure('public.remove_chat_message_reaction_by_invite_token(text, uuid)') is null then
    v_errors := v_errors || '; remove_chat_message_reaction_by_invite_token が無い';
  end if;
  if to_regprocedure('public.list_chat_message_reactions_by_invite_token(text, uuid[])') is null then
    v_errors := v_errors || '; list_chat_message_reactions_by_invite_token が無い';
  end if;
  if to_regprocedure('public.grant_realtime_view_access(text)') is null then
    v_errors := v_errors || '; grant_realtime_view_access が無い';
  end if;
  if to_regclass('public.realtime_view_grants') is null then
    v_errors := v_errors || '; realtime_view_grants の表が無い';
  end if;
  if not exists (
    select 1 from pg_proc
    where oid = 'public.can_access_avatar_room_topic()'::regprocedure
      and prosrc like '%realtime_view_grants%'
  ) or not exists (
    select 1 from pg_proc
    where oid = 'public.can_message_user_channel(uuid)'::regprocedure
      and prosrc like '%realtime_view_grants%'
  ) then
    v_errors := v_errors || '; 判定関数の中身にrealtime_view_grantsが戻っていない';
  end if;

  if v_errors <> '' then
    raise exception '段階G-2の取り消し: 確認に失敗しました%。取り消します。', v_errors;
  end if;
end $$;

-- ============================================================
-- after_rollback: 元に戻した後の確認
-- ============================================================
select set_config('test.out', current_setting('test.out', true) || ' | after_rollback:T=', true);

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12', true);
  perform set_config('request.jwt.claims', '{"sub":"ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12","role":"authenticated"}', true);
  perform set_config('realtime.topic', 'avatar-room-3e4d2e3b-13e2-4e69-84e2-b959400bfbb4', true);
  if public.can_access_avatar_room_topic() then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || 'E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'fcd80cd6-2a10-4e6c-b848-fbbfb9992311', true);
  perform set_config('request.jwt.claims', '{"sub":"fcd80cd6-2a10-4e6c-b848-fbbfb9992311","role":"authenticated"}', true);
  perform set_config('realtime.topic', 'avatar-room-3e4d2e3b-13e2-4e69-84e2-b959400bfbb4', true);
  if public.can_access_avatar_room_topic() then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '883a628e-155b-4e76-96fa-c775fe5480d5', true);
  perform set_config('request.jwt.claims', '{"sub":"883a628e-155b-4e76-96fa-c775fe5480d5","role":"authenticated"}', true);
  perform set_config('realtime.topic', 'avatar-room-3e4d2e3b-13e2-4e69-84e2-b959400bfbb4', true);
  if public.can_access_avatar_room_topic() then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '07a74578-f5bb-4b91-bf11-752f008a583c', true);
  perform set_config('request.jwt.claims', '{"sub":"07a74578-f5bb-4b91-bf11-752f008a583c","role":"authenticated"}', true);
  perform set_config('realtime.topic', 'avatar-room-3e4d2e3b-13e2-4e69-84e2-b959400bfbb4', true);
  if public.can_access_avatar_room_topic() then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '07a74578-f5bb-4b91-bf11-752f008a583c', true);
  perform set_config('request.jwt.claims', '{"sub":"07a74578-f5bb-4b91-bf11-752f008a583c","role":"authenticated"}', true);
  perform set_config('realtime.topic', 'avatar-room-06396cb3-1ac8-4bd6-addd-d33f6ec73d20', true);
  if public.can_access_avatar_room_topic() then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

select set_config('test.out', current_setting('test.out', true) || ' C=', true);

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12', true);
  perform set_config('request.jwt.claims', '{"sub":"ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12","role":"authenticated"}', true);
  if public.can_message_user_channel('fcd80cd6-2a10-4e6c-b848-fbbfb9992311'::uuid) then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || 'E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'fcd80cd6-2a10-4e6c-b848-fbbfb9992311', true);
  perform set_config('request.jwt.claims', '{"sub":"fcd80cd6-2a10-4e6c-b848-fbbfb9992311","role":"authenticated"}', true);
  if public.can_message_user_channel('ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12'::uuid) then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '883a628e-155b-4e76-96fa-c775fe5480d5', true);
  perform set_config('request.jwt.claims', '{"sub":"883a628e-155b-4e76-96fa-c775fe5480d5","role":"authenticated"}', true);
  if public.can_message_user_channel('ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12'::uuid) then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '07a74578-f5bb-4b91-bf11-752f008a583c', true);
  perform set_config('request.jwt.claims', '{"sub":"07a74578-f5bb-4b91-bf11-752f008a583c","role":"authenticated"}', true);
  if public.can_message_user_channel('fcd80cd6-2a10-4e6c-b848-fbbfb9992311'::uuid) then
    v_result := 't';
  else
    v_result := 'f';
  end if;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_result, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

-- after_rollbackの関数・表の有無。
do $$
declare
  v_restored int := 0;
  v_kept_remaining int := 0;
begin
  if to_regprocedure('public.list_rooms_by_invite_token(text)') is not null then v_restored := v_restored + 1; end if;
  if to_regprocedure('public.list_chat_messages_by_invite_token(text, uuid, uuid)') is not null then v_restored := v_restored + 1; end if;
  if to_regprocedure('public.send_chat_message_by_invite_token(text, uuid, uuid, text, text, text, text)') is not null then v_restored := v_restored + 1; end if;
  if to_regprocedure('public.edit_chat_message_by_invite_token(text, uuid, text, timestamptz)') is not null then v_restored := v_restored + 1; end if;
  if to_regprocedure('public.delete_chat_message_by_invite_token(text, uuid, timestamptz)') is not null then v_restored := v_restored + 1; end if;
  if to_regprocedure('public.create_chat_group_by_invite_token(text, uuid, uuid[])') is not null then v_restored := v_restored + 1; end if;
  if to_regprocedure('public.list_chat_threads_by_invite_token(text, uuid)') is not null then v_restored := v_restored + 1; end if;
  if to_regprocedure('public.create_dm_mention_by_invite_token(text, uuid, text)') is not null then v_restored := v_restored + 1; end if;
  if to_regprocedure('public.set_chat_message_reaction_by_invite_token(text, uuid, text)') is not null then v_restored := v_restored + 1; end if;
  if to_regprocedure('public.remove_chat_message_reaction_by_invite_token(text, uuid)') is not null then v_restored := v_restored + 1; end if;
  if to_regprocedure('public.list_chat_message_reactions_by_invite_token(text, uuid[])') is not null then v_restored := v_restored + 1; end if;
  if to_regprocedure('public.grant_realtime_view_access(text)') is not null then v_restored := v_restored + 1; end if;

  if to_regprocedure('public.lookup_account_by_invite_token(text)') is not null then v_kept_remaining := v_kept_remaining + 1; end if;
  if to_regprocedure('public.join_account_by_invite_token(text)') is not null then v_kept_remaining := v_kept_remaining + 1; end if;

  perform set_config(
    'test.out',
    current_setting('test.out', true) || format(
      ' | after_rollback_funcs=%s/%s/%s/%s',
      v_restored,
      v_kept_remaining,
      case when to_regclass('public.realtime_view_grants') is not null then 'yes' else 'no' end,
      case when to_regclass('public.stage_f_legacy_guest_backup') is not null then 'yes' else 'no' end
    ),
    true
  );
end $$;

-- 結果を1行で表示する(これによってトランザクション全体がrollbackされる)。
do $$
begin
  raise exception 'RESULT:%', current_setting('test.out');
end $$;

rollback;
