-- 入室の仕組みの作り替え(docs/room-membership-plan.md)段階G-2。
--
-- 目的: 一時閲覧(viewOnly、既に自分のアカウントを持つ人が他人の招待URLを
-- 一時閲覧する古い機能)のために作られたデータベース側の関数・表を削除する。
-- 段階G-1(アプリのコード側の削除、コミット98a67d9・71af59e・49f607a)が
-- 本番適用済みで、これらの関数・表はもうどこからも呼ばれていない
-- (本番の関数一覧をユーザーがSQLで確認済み)。
--
-- 対象: *_by_invite_token の関数11個(lookup_account_by_invite_token・
-- join_account_by_invite_tokenは招待URLを開いた人をメンバーにする今も使う
-- 経路のため残す)・grant_realtime_view_access関数・realtime_view_grants
-- の表・控えの表 stage_f_legacy_guest_backup(段階Fの控え、段階Gで削除予定
-- だったもの)。Realtimeの判定関数(can_access_avatar_room_topic・
-- can_message_user_channel)は、realtime_view_grantsの分岐だけを抜いた形に
-- 作り直す(表を消す前に、同じトランザクションの中で必ず作り直す)。
--
-- 適用方法: Supabase の SQL Editor から、このファイルの内容をそのまま
-- 直接実行する。
--
-- ほかの2つのファイルとの関係:
-- - 元に戻す場合は、同じフォルダの
--   2026-11-25_stage_g2_remove_invite_token_paths_rollback.sql を実行する。
-- - 本番適用前の予行演習は、同じフォルダの
--   2026-11-25_stage_g2_rehearsal.sql(このファイルの①〜⑥と、元に戻すSQLの
--   中身を1つのトランザクションの中でそのまま試し、最後に必ず全体を
--   取り消す確認用SQL)を使う。

begin;

-- ① 事前の確認: realtime_view_grants に期限切れでない行が残っていないか。
--    1行でもあれば取り消す(viewOnlyの許可証は30分しか有効でないため、
--    通常は0件のはず)。
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
--    作り直す(段階Bで追加されたaccount_membersの分岐・profilesの分岐・
--    is_banned_for_account・security definer・set search_path・stable・
--    revoke/grantの行は1字も変えない)。
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

-- ③ もう呼ばれていない12個の関数を削除する(if existsは付けない。
--    引数の形が本番の一覧と違えばエラーで全体を取り消す)。
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

-- ⑥ 事後の確認: 想定どおりに消えている・残っているかを確かめる。
--    1つでも条件に当てはまれば取り消す。
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

commit;
