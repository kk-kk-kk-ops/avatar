-- 段階Fの処理を、テスト用の+test2(user_id = fcd80cd6-2a10-4e6c-b848-
-- fbbfb9992311)についてだけ試し、結果を1行で表示する確認用SQL。
--
-- begin ... rollback で囲んでいるため、実行しても本番データは変化しない
-- (結果を見るためだけのSQL)。+test2以外のユーザーには一切触れない。
--
-- 使い方: Supabase の SQL Editor で、このファイルの内容をそのまま
-- 直接実行する。最後にdo $$ … raise exception …end $$;で
-- 'RESULT:...'という1行がエラーとして表示される(raise exceptionに
-- よるもので、これによってトランザクション全体がrollbackされる)。
-- 末尾のrollback;は到達しないが、保険として書いてある。
--
-- 期待するRESULTの例(+test2が移行前からrole='guest'・
-- account_id=885f8633-7a45-45ac-b221-86790fb75640で、まだ
-- account_membersの行が無い場合):
-- RESULT:before=guest/885f8633-7a45-45ac-b221-86790fb75640/member=false; after=null/null/member=true; list=1 room=1 entry=1

begin;

-- 1. +test2の移行前の状態を一時的に保存する(トランザクション内だけの
--    一時テーブル。rollbackで自動的に無くなる)。
create temporary table stage_f_test2_before as
select
  p.user_id,
  p.account_id,
  p.role,
  p.created_at,
  p.last_login_at,
  exists (
    select 1 from public.account_members m
    where m.user_id = p.user_id and m.account_id = p.account_id
  ) as member_row_existed_before
from public.profiles p
where p.user_id = 'fcd80cd6-2a10-4e6c-b848-fbbfb9992311';

-- 移行前の状態をtest.outにためる。
select set_config(
  'test.out',
  format('before=%s/%s/member=%s',
    coalesce(role, 'null'),
    coalesce(account_id::text, 'null'),
    member_row_existed_before),
  true
)
from stage_f_test2_before;

-- 2. 段階Fと同じ処理を、+test2が実際に「古いゲスト」
--    (role = 'guest' かつ account_idがある)の場合だけ行う。
insert into public.account_members (user_id, account_id, joined_at, last_accessed_at)
select
  user_id, account_id, coalesce(created_at, now()), coalesce(last_login_at, now())
from stage_f_test2_before
where account_id is not null and role = 'guest'
on conflict (user_id, account_id) do nothing;

update public.profiles
set account_id = null, role = null
where user_id in (
  select user_id from stage_f_test2_before
  where account_id is not null and role = 'guest'
);

-- 移行後の状態(profiles.account_id/roleが空になったか、
-- account_membersの行があるか)をtest.outにためる。
select set_config(
  'test.out',
  current_setting('test.out', true) || format('; after=%s/%s/member=%s',
    coalesce(p.role, 'null'),
    coalesce(p.account_id::text, 'null'),
    exists (
      select 1 from public.account_members m
      where m.user_id = b.user_id and m.account_id = b.account_id
    )),
  true
)
from stage_f_test2_before b
join public.profiles p on p.user_id = b.user_id;

-- 3. +test2に成りすまして、メンバー経路で入室できるかを確認する。
set local role authenticated;
select set_config('request.jwt.claim.sub', 'fcd80cd6-2a10-4e6c-b848-fbbfb9992311', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"fcd80cd6-2a10-4e6c-b848-fbbfb9992311","role":"authenticated"}',
  true
);

-- list_my_room_memberships()にGlobyTown(account 885f8633-7a45-45ac-
-- b221-86790fb75640)が出るか。
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.list_my_room_memberships()
  where account_id = '885f8633-7a45-45ac-b221-86790fb75640';
  perform set_config('test.out', current_setting('test.out', true) || format('; list=%s', v_count), true);
exception when others then
  perform set_config('test.out', current_setting('test.out', true) || format('; list=ERROR:%s', sqlerrm), true);
end $$;

-- get_own_or_member_room(room 3e4d2e3b-13e2-4e69-84e2-b959400bfbb4)が
-- 1行か。
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.get_own_or_member_room('3e4d2e3b-13e2-4e69-84e2-b959400bfbb4');
  perform set_config('test.out', current_setting('test.out', true) || format(' room=%s', v_count), true);
exception when others then
  perform set_config('test.out', current_setting('test.out', true) || format(' room=ERROR:%s', sqlerrm), true);
end $$;

-- get_member_room_entry(同じroom)が1行か。
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.get_member_room_entry('3e4d2e3b-13e2-4e69-84e2-b959400bfbb4');
  perform set_config('test.out', current_setting('test.out', true) || format(' entry=%s', v_count), true);
exception when others then
  perform set_config('test.out', current_setting('test.out', true) || format(' entry=ERROR:%s', sqlerrm), true);
end $$;

reset role;

-- 結果を1行で表示する(これによってトランザクション全体がrollbackされる)。
do $$
begin
  raise exception 'RESULT:%', current_setting('test.out');
end $$;

rollback;
