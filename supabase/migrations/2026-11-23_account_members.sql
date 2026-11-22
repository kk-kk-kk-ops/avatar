-- 入室の仕組みの作り替えの段階A-1。新規追加のみで、まだどこからも呼ばれない。

-- 案: どのアカウント(≒ルーム。1アカウント1ルームのため)に、どのユーザーが
-- メンバーとして載っているかを記録する。招待URLで最初の1回だけ参加し、
-- 以後はこの表への有無で入室可否を判定する(profiles.account_idは使わない)。
create table if not exists public.account_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_accessed_at timestamptz not null default now(),
  primary key (user_id, account_id)
);
alter table public.account_members enable row level security;

-- 自分の行だけ読める。書き込み(insert/update/delete)用のポリシーは
-- 意図的に一切作らない。通常ロールからの直接の書き込みは常に拒否され、
-- 下のSECURITY DEFINER関数経由でのみ変更できる(realtime_view_grantsと
-- 同じ考え方)。
drop policy if exists "account_members: select own" on public.account_members;
create policy "account_members: select own"
  on public.account_members for select
  using (user_id = auth.uid());

-- 招待トークンを検証し、自分をそのアカウントのメンバーに追加する。
-- 自分が持ち主のアカウント(owner_user_id = auth.uid())は対象外
-- (持ち主は自分のルームとして別経路で扱うため、メンバー表には載せない)。
-- BAN確認は「書き込みの前」に行う(現状のjoinAccountViaInviteが
-- profiles更新後にBANを確認している問題の修正)。
--
-- 戻り値の列名は、account_members.account_idと同じ名前にしない
-- (PL/pgSQLの関数本体はRETURNS TABLEの列名をそのまま変数として暗黙に
-- 宣言するため、同じ名前のテーブル列が本体内のSQL文に登場すると
-- 曖昧になるおそれがある。特に下のinsert ... on conflict (user_id,
-- account_id)のaccount_idは、戻り値の列名がaccount_idのままだと
-- "column reference ... is ambiguous"になり得る。これを避けるため、
-- 戻り値の列名自体を最初からずらしておく)。
create or replace function public.join_account_by_invite_token(token text)
returns table (joined_account_id uuid, is_own_account boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_owner_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;

  select a.id, a.owner_user_id into v_account_id, v_owner_user_id
  from public.accounts a
  where a.invite_token = token;

  if v_account_id is null then
    raise exception '無効な招待リンクです';
  end if;

  if v_owner_user_id = auth.uid() then
    -- 自分自身の招待URL。メンバー表には何も書かない。
    return query select v_account_id, true;
    return;
  end if;

  if public.is_banned_for_account(v_account_id) then
    raise exception 'このルームへのアクセスが制限されています';
  end if;

  insert into public.account_members (user_id, account_id, joined_at, last_accessed_at)
  values (auth.uid(), v_account_id, now(), now())
  on conflict (user_id, account_id) do update set last_accessed_at = now();

  return query select v_account_id, false;
end;
$$;

revoke all on function public.join_account_by_invite_token(text) from public;
revoke all on function public.join_account_by_invite_token(text) from anon;
grant execute on function public.join_account_by_invite_token(text) to authenticated;

-- 入室画面のカード一覧用。自分が持ち主のアカウントは含めない
-- (呼び出し側がaccounts.owner_user_id = auth.uid()で別途1件取得し、
-- 先頭に出す)。招待トークンなど秘密の値は返さない。
create or replace function public.list_my_room_memberships()
returns table (
  account_id uuid,
  room_id uuid,
  room_name text,
  preview_image text,
  owner_display_name text,
  last_accessed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    m.account_id,
    r.id as room_id,
    coalesce(t.name, r.name) as room_name,
    coalesce(t.thumbnail_image_url, t.background_image_url, r.preview_image) as preview_image,
    coalesce(a.invite_inviter_name, p.display_name, 'メンバー') as owner_display_name,
    m.last_accessed_at
  from public.account_members m
  join public.rooms r on r.account_id = m.account_id
  join public.accounts a on a.id = m.account_id
  left join public.templates t on t.id = r.template_id
  left join public.profiles p on p.user_id = a.owner_user_id
  where m.user_id = auth.uid()
    and not public.is_banned_for_account(m.account_id)
  order by m.last_accessed_at desc;
$$;

revoke all on function public.list_my_room_memberships() from public;
revoke all on function public.list_my_room_memberships() from anon;
grant execute on function public.list_my_room_memberships() to authenticated;

create or replace function public.leave_account_membership(p_account_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.account_members
  where user_id = auth.uid() and account_id = p_account_id;
$$;

revoke all on function public.leave_account_membership(uuid) from public;
revoke all on function public.leave_account_membership(uuid) from anon;
grant execute on function public.leave_account_membership(uuid) to authenticated;

create or replace function public.touch_account_membership(p_account_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.account_members
  set last_accessed_at = now()
  where user_id = auth.uid() and account_id = p_account_id;
$$;

revoke all on function public.touch_account_membership(uuid) from public;
revoke all on function public.touch_account_membership(uuid) from anon;
grant execute on function public.touch_account_membership(uuid) to authenticated;

-- 会議室の管理者向けモーダル(在室者・BANの画面)の「メンバー」タブ用。
-- 呼び出し元が指定したアカウントの持ち主本人であることを確認する。
create or replace function public.list_account_members(p_account_id uuid)
returns table (
  user_id uuid,
  display_name text,
  joined_at timestamptz,
  last_accessed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select m.user_id, coalesce(p.display_name, 'メンバー'), m.joined_at, m.last_accessed_at
  from public.account_members m
  left join public.profiles p on p.user_id = m.user_id
  where m.account_id = p_account_id
    and exists (
      select 1 from public.accounts a
      where a.id = p_account_id and a.owner_user_id = auth.uid()
    )
  order by m.last_accessed_at desc;
$$;

revoke all on function public.list_account_members(uuid) from public;
revoke all on function public.list_account_members(uuid) from anon;
grant execute on function public.list_account_members(uuid) to authenticated;

-- LiveKit/Indigoトークン発行で使う。自分のルーム(owner)・メンバー
-- (account_members)のいずれでもなければ0行。BAN中も0行。
create or replace function public.get_own_or_member_room(p_room_id uuid)
returns table (account_id uuid, template_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  select r.account_id, r.template_id
  from public.rooms r
  where r.id = p_room_id
    and (
      exists (
        select 1 from public.accounts a
        where a.id = r.account_id and a.owner_user_id = auth.uid()
      )
      or exists (
        select 1 from public.account_members m
        where m.user_id = auth.uid() and m.account_id = r.account_id
      )
    )
    and not public.is_banned_for_account(r.account_id);
$$;

revoke all on function public.get_own_or_member_room(uuid) from public;
revoke all on function public.get_own_or_member_room(uuid) from anon;
grant execute on function public.get_own_or_member_room(uuid) to authenticated;
