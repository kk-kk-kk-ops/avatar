-- 入室の仕組みの作り替えの段階A-2。新規追加のみで、元の関数は変えない。
-- まだどこからも呼ばれない。

-- 元の関数: list_chat_messages_by_invite_token
-- 鍵の差し替え: a.invite_token = token を、
-- 「呼び出した人がそのアカウントのaccount_membersに載っているか」に変える。
create or replace function public.list_chat_messages_as_member(
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
  where exists (
      select 1 from public.account_members am
      where am.user_id = auth.uid() and am.account_id = a.id
    )
    and r.id = target_room_id
    and not public.is_banned_for_account(a.id)
    and (
      (m.sender_user_id = auth.uid() and m.recipient_user_id = peer_user_id)
      or (m.sender_user_id = peer_user_id and m.recipient_user_id = auth.uid())
    )
  order by m.created_at asc
  limit 50;
$$;

revoke all on function public.list_chat_messages_as_member(uuid, uuid) from public;
revoke all on function public.list_chat_messages_as_member(uuid, uuid) from anon;
grant execute on function public.list_chat_messages_as_member(uuid, uuid) to authenticated;

-- 元の関数: send_chat_message_by_invite_token
-- 鍵の差し替え: a.invite_token = token を、
-- 「呼び出した人がそのアカウントのaccount_membersに載っているか」に変える。
create or replace function public.send_chat_message_as_member(
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
  where exists (
      select 1 from public.account_members am
      where am.user_id = auth.uid() and am.account_id = a.id
    )
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

revoke all on function public.send_chat_message_as_member(uuid, uuid, text, text, text, text) from public;
revoke all on function public.send_chat_message_as_member(uuid, uuid, text, text, text, text) from anon;
grant execute on function public.send_chat_message_as_member(uuid, uuid, text, text, text, text) to authenticated;

-- 元の関数: edit_chat_message_by_invite_token
-- 鍵の差し替え: a.invite_token = token を、
-- 「呼び出した人がそのアカウントのaccount_membersに載っているか」に変える。
create or replace function public.edit_chat_message_as_member(
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
  where exists (
      select 1 from public.account_members am
      where am.user_id = auth.uid() and am.account_id = a.id
    )
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

revoke all on function public.edit_chat_message_as_member(uuid, text, timestamptz) from public;
revoke all on function public.edit_chat_message_as_member(uuid, text, timestamptz) from anon;
grant execute on function public.edit_chat_message_as_member(uuid, text, timestamptz) to authenticated;

-- 元の関数: delete_chat_message_by_invite_token
-- 鍵の差し替え: a.invite_token = token を、
-- 「呼び出した人がそのアカウントのaccount_membersに載っているか」に変える。
create or replace function public.delete_chat_message_as_member(
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
  where exists (
      select 1 from public.account_members am
      where am.user_id = auth.uid() and am.account_id = a.id
    )
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

revoke all on function public.delete_chat_message_as_member(uuid, timestamptz) from public;
revoke all on function public.delete_chat_message_as_member(uuid, timestamptz) from anon;
grant execute on function public.delete_chat_message_as_member(uuid, timestamptz) to authenticated;

-- 元の関数: create_chat_group_by_invite_token
-- 鍵の差し替え: a.invite_token = token を、
-- 「呼び出した人がそのアカウントのaccount_membersに載っているか」に変える。
create or replace function public.create_chat_group_as_member(
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
    where r.id = target_room_id
      and exists (
        select 1 from public.account_members am
        where am.user_id = auth.uid() and am.account_id = a.id
      )
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

revoke all on function public.create_chat_group_as_member(uuid, uuid[]) from public;
revoke all on function public.create_chat_group_as_member(uuid, uuid[]) from anon;
grant execute on function public.create_chat_group_as_member(uuid, uuid[]) to authenticated;

-- 元の関数: list_chat_threads_by_invite_token
-- 鍵の差し替え: allowed CTE内のa.invite_token = tokenを、
-- 「呼び出した人がそのアカウントのaccount_membersに載っているか」に変える。
create or replace function public.list_chat_threads_as_member(
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
      and exists (
        select 1 from public.account_members am
        where am.user_id = auth.uid() and am.account_id = a.id
      )
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

revoke all on function public.list_chat_threads_as_member(uuid) from public;
revoke all on function public.list_chat_threads_as_member(uuid) from anon;
grant execute on function public.list_chat_threads_as_member(uuid) to authenticated;

-- 元の関数: create_dm_mention_by_invite_token
-- 鍵の差し替え: a.invite_token = token を、
-- 「呼び出した人がそのアカウントのaccount_membersに載っているか」に変える。
create or replace function public.create_dm_mention_as_member(
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
  where exists (
      select 1 from public.account_members am
      where am.user_id = auth.uid() and am.account_id = a.id
    )
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

revoke all on function public.create_dm_mention_as_member(uuid, text) from public;
revoke all on function public.create_dm_mention_as_member(uuid, text) from anon;
grant execute on function public.create_dm_mention_as_member(uuid, text) to authenticated;

-- 元の関数: set_chat_message_reaction_by_invite_token
-- 鍵の差し替え: a.invite_token = token を、
-- 「呼び出した人がそのアカウントのaccount_membersに載っているか」に変える。
create or replace function public.set_chat_message_reaction_as_member(
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
  where exists (
      select 1 from public.account_members am
      where am.user_id = auth.uid() and am.account_id = a.id
    )
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

revoke all on function public.set_chat_message_reaction_as_member(uuid, text) from public;
revoke all on function public.set_chat_message_reaction_as_member(uuid, text) from anon;
grant execute on function public.set_chat_message_reaction_as_member(uuid, text) to authenticated;

-- 元の関数: remove_chat_message_reaction_by_invite_token
-- 鍵の差し替え: a.invite_token = token を(select文・delete文の両方で)、
-- 「呼び出した人がそのアカウントのaccount_membersに載っているか」に変える。
create or replace function public.remove_chat_message_reaction_as_member(
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
  where exists (
      select 1 from public.account_members am
      where am.user_id = auth.uid() and am.account_id = a.id
    )
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
    and exists (
      select 1 from public.account_members am
      where am.user_id = auth.uid() and am.account_id = a.id
    )
    and r.message_id = p_message_id
    and r.user_id = auth.uid();
end;
$$;

revoke all on function public.remove_chat_message_reaction_as_member(uuid) from public;
revoke all on function public.remove_chat_message_reaction_as_member(uuid) from anon;
grant execute on function public.remove_chat_message_reaction_as_member(uuid) to authenticated;

-- 元の関数: list_chat_message_reactions_by_invite_token
-- 鍵の差し替え: a.invite_token = token を、
-- 「呼び出した人がそのアカウントのaccount_membersに載っているか」に変える。
create or replace function public.list_chat_message_reactions_as_member(
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
    where exists (
        select 1 from public.account_members am
        where am.user_id = auth.uid() and am.account_id = a.id
      )
      and r.message_id = any(p_message_ids)
      and not public.is_banned_for_account(a.id);
end;
$$;

revoke all on function public.list_chat_message_reactions_as_member(uuid[]) from public;
revoke all on function public.list_chat_message_reactions_as_member(uuid[]) from anon;
grant execute on function public.list_chat_message_reactions_as_member(uuid[]) to authenticated;
