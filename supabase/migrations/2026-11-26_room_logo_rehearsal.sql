-- ②-2(2026-11-26_room_logo.sql)と、その元に戻すSQL(同フォルダの
-- ...rollback.sql)を、本番適用前に1つのトランザクションの中で通して
-- 試す予行演習SQL。
--
-- 内容: 本体をそのまま適用した後、ひより(持ち主)・+test1・+test2・
-- +test3(いずれも成りすまし)でis_room_owner・get_room_logo_infoの
-- 結果を確かめ、logo_image_urlの直接の書き換えが本当に止められるか
-- (ひより自身でも止められること・ほかの列は今までどおり書けること・
-- 成りすまさない〈Service Role相当の〉書き込みは通ること)を確かめる。
-- 続けて元に戻すSQLを適用し、列・関数・トリガー・バケット・ポリシーが
-- 消えたことを確かめる。
--
-- begin ... rollback で囲んでいるため、実行しても本番データ・本番の列・
-- 関数・バケットは一切変化しない(結果を見るためだけのSQL)。
--
-- 適用方法: Supabase の SQL Editor で、このファイルの内容をそのまま
-- 直接実行する。最後にdo $$ … raise exception … end $$;で
-- 'RESULT:...'という1行がエラーとして表示される(raise exceptionに
-- よるもので、これによってトランザクション全体がrollbackされる)。
-- 末尾のrollback;は到達しないが、保険として書いてある。
--
-- ほかの2つのファイルとの関係: 本体(2026-11-26_room_logo.sql)と、
-- 元に戻すSQL(同...rollback.sql)の中身を、begin;・commit;を除いて
-- そのまま下に書き写している(文面は本体・元に戻すSQLと完全に一致
-- させること。直す場合は3つのファイルとも直す)。
--
-- 期待するRESULTの例(I=is_room_owner〈ひより・+test2・+test1〉、
-- L=get_room_logo_infoの行数〈ひより・+test2・+test1・+test3〉、
-- W=logo_image_urlの書き込み確認〈W1:ひよりで直接書き換え・W2:ひより
-- でname書き換え・W3:service_roleとしての書き換え・W4:ログインの情報
-- が無い状態での書き換え〉、objects=元に戻した後に残っているべきでない
-- ものの件数):
-- RESULT:main:I=t,f,f L=1,1,0,0 W=E:logo_image_urlはこの経路からは変更できません,ok,ok,ok | rollback:objects=0 bucket_left=t

begin;

-- ============================================================
-- 本体(2026-11-26_room_logo.sql)の(1)〜(5)と事後の確認を
-- そのまま実行する。
-- ============================================================

alter table public.rooms
  add column if not exists logo_image_url text;

create or replace function public.prevent_room_logo_self_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.role() = 'service_role'
     or current_setting('is_superuser', true) = 'on'
     or auth.role() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.logo_image_url is not null then
      raise exception 'logo_image_urlはこの経路からは設定できません';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.logo_image_url is distinct from old.logo_image_url then
      raise exception 'logo_image_urlはこの経路からは変更できません';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists rooms_prevent_logo_self_write on public.rooms;
create trigger rooms_prevent_logo_self_write
  before insert or update on public.rooms
  for each row
  execute function public.prevent_room_logo_self_write();

create or replace function public.is_room_owner(p_room_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.rooms r
    join public.accounts a on a.id = r.account_id
    where r.id = p_room_id
      and a.owner_user_id = auth.uid()
  );
$$;

revoke all on function public.is_room_owner(uuid) from public;
revoke all on function public.is_room_owner(uuid) from anon;
grant execute on function public.is_room_owner(uuid) to authenticated;

create or replace function public.get_room_logo_info(p_room_id uuid)
returns table (logo_image_url text, plan text)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.logo_image_url,
    (select a2.plan from public.accounts a2 where a2.id = r.account_id)
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

revoke all on function public.get_room_logo_info(uuid) from public;
revoke all on function public.get_room_logo_info(uuid) from anon;
grant execute on function public.get_room_logo_info(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'room-logos', 'room-logos', true,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "room-logos: public read" on storage.objects;
create policy "room-logos: public read"
  on storage.objects for select
  using (bucket_id = 'room-logos');

drop policy if exists "room-logos: owner insert raw" on storage.objects;
create policy "room-logos: owner insert raw"
  on storage.objects for insert
  with check (
    bucket_id = 'room-logos'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_room_owner(((storage.foldername(name))[1])::uuid)
    and (storage.foldername(name))[2] = 'raw'
  );

do $$
declare
  v_errors text := '';
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rooms'
      and column_name = 'logo_image_url'
  ) then
    v_errors := v_errors || '; rooms.logo_image_url 列が無い';
  end if;

  if to_regprocedure('public.prevent_room_logo_self_write()') is null then
    v_errors := v_errors || '; prevent_room_logo_self_write 関数が無い';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'rooms_prevent_logo_self_write'
      and tgrelid = 'public.rooms'::regclass
  ) then
    v_errors := v_errors || '; rooms_prevent_logo_self_write トリガーが無い';
  end if;

  if to_regprocedure('public.is_room_owner(uuid)') is null then
    v_errors := v_errors || '; is_room_owner 関数が無い';
  end if;

  if to_regprocedure('public.get_room_logo_info(uuid)') is null then
    v_errors := v_errors || '; get_room_logo_info 関数が無い';
  end if;

  if not exists (select 1 from storage.buckets where id = 'room-logos') then
    v_errors := v_errors || '; room-logos バケットが無い';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'room-logos: public read'
  ) then
    v_errors := v_errors || '; room-logos: public read ポリシーが無い';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'room-logos: owner insert raw'
  ) then
    v_errors := v_errors || '; room-logos: owner insert raw ポリシーが無い';
  end if;

  if v_errors <> '' then
    raise exception 'room_logo: 事後確認に失敗しました%。取り消します。', v_errors;
  end if;
end $$;

-- ============================================================
-- 成りすましでの確認(本体を適用した後)
-- ============================================================

select set_config('test.out', 'main:I=', true);

-- I: ひより(持ち主)→ t
do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12', true);
  perform set_config('request.jwt.claims', '{"sub":"ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12","role":"authenticated"}', true);
  if public.is_room_owner('3e4d2e3b-13e2-4e69-84e2-b959400bfbb4'::uuid) then
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

-- I: +test2(メンバー、持ち主ではない)→ f
do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'fcd80cd6-2a10-4e6c-b848-fbbfb9992311', true);
  perform set_config('request.jwt.claims', '{"sub":"fcd80cd6-2a10-4e6c-b848-fbbfb9992311","role":"authenticated"}', true);
  if public.is_room_owner('3e4d2e3b-13e2-4e69-84e2-b959400bfbb4'::uuid) then
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

-- I: +test1(無関係)→ f
do $$
declare
  v_result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '07a74578-f5bb-4b91-bf11-752f008a583c', true);
  perform set_config('request.jwt.claims', '{"sub":"07a74578-f5bb-4b91-bf11-752f008a583c","role":"authenticated"}', true);
  if public.is_room_owner('3e4d2e3b-13e2-4e69-84e2-b959400bfbb4'::uuid) then
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

select set_config('test.out', current_setting('test.out', true) || ' L=', true);

-- L: ひより(持ち主)→ 1行
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12', true);
  perform set_config('request.jwt.claims', '{"sub":"ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12","role":"authenticated"}', true);
  select count(*) into v_count from public.get_room_logo_info('3e4d2e3b-13e2-4e69-84e2-b959400bfbb4'::uuid);
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || v_count::text, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || 'E:' || sqlerrm, true);
end $$;

-- L: +test2(メンバー)→ 1行
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'fcd80cd6-2a10-4e6c-b848-fbbfb9992311', true);
  perform set_config('request.jwt.claims', '{"sub":"fcd80cd6-2a10-4e6c-b848-fbbfb9992311","role":"authenticated"}', true);
  select count(*) into v_count from public.get_room_logo_info('3e4d2e3b-13e2-4e69-84e2-b959400bfbb4'::uuid);
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_count::text, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

-- L: +test1(無関係)→ 0行
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '07a74578-f5bb-4b91-bf11-752f008a583c', true);
  perform set_config('request.jwt.claims', '{"sub":"07a74578-f5bb-4b91-bf11-752f008a583c","role":"authenticated"}', true);
  select count(*) into v_count from public.get_room_logo_info('3e4d2e3b-13e2-4e69-84e2-b959400bfbb4'::uuid);
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_count::text, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

-- L: +test3(無関係)→ 0行
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '883a628e-155b-4e76-96fa-c775fe5480d5', true);
  perform set_config('request.jwt.claims', '{"sub":"883a628e-155b-4e76-96fa-c775fe5480d5","role":"authenticated"}', true);
  select count(*) into v_count from public.get_room_logo_info('3e4d2e3b-13e2-4e69-84e2-b959400bfbb4'::uuid);
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',' || v_count::text, true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

select set_config('test.out', current_setting('test.out', true) || ' W=', true);

-- W1: ひよりとして直接logo_image_urlを書き換え → 止められる(E)
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12', true);
  perform set_config('request.jwt.claims', '{"sub":"ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12","role":"authenticated"}', true);
  update public.rooms set logo_image_url = 'x' where id = '3e4d2e3b-13e2-4e69-84e2-b959400bfbb4'::uuid;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || 'ok', true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || 'E:' || sqlerrm, true);
end $$;

-- W2: ひよりとしてname(ロゴ以外の列)を書き換え → 通る(ok)
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12', true);
  perform set_config('request.jwt.claims', '{"sub":"ba701a8f-0dbb-4e74-b9b0-1004e3a0cc12","role":"authenticated"}', true);
  update public.rooms set name = name where id = '3e4d2e3b-13e2-4e69-84e2-b959400bfbb4'::uuid;
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',ok', true);
exception when others then
  reset role;
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

-- W3: サーバーと同じservice_roleとしてlogo_image_urlを書き換え → 通る(ok)
do $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update public.rooms set logo_image_url = 'x' where id = '3e4d2e3b-13e2-4e69-84e2-b959400bfbb4'::uuid;
  perform set_config('test.out', current_setting('test.out', true) || ',ok', true);
exception when others then
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

-- W4: ログインの情報が無い(SQL Editorと同じ)状態でlogo_image_urlを書き換え → 通る(ok)
do $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
  update public.rooms set logo_image_url = 'y' where id = '3e4d2e3b-13e2-4e69-84e2-b959400bfbb4'::uuid;
  perform set_config('test.out', current_setting('test.out', true) || ',ok', true);
exception when others then
  perform set_config('test.out', current_setting('test.out', true) || ',E:' || sqlerrm, true);
end $$;

-- ============================================================
-- 元に戻すSQL(2026-11-26_room_logo_rollback.sql)の中身を
-- そのまま実行する。
-- ============================================================

drop policy if exists "room-logos: owner insert raw" on storage.objects;
drop policy if exists "room-logos: public read" on storage.objects;

drop function if exists public.get_room_logo_info(uuid);
drop function if exists public.is_room_owner(uuid);

drop trigger if exists rooms_prevent_logo_self_write on public.rooms;
drop function if exists public.prevent_room_logo_self_write();

alter table public.rooms
  drop column if exists logo_image_url;

-- 消えたことの確認(残っているべきでないものの件数)。
do $$
declare
  v_remaining int := 0;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rooms'
      and column_name = 'logo_image_url'
  ) then
    v_remaining := v_remaining + 1;
  end if;
  if to_regprocedure('public.prevent_room_logo_self_write()') is not null then
    v_remaining := v_remaining + 1;
  end if;
  if exists (
    select 1 from pg_trigger
    where tgname = 'rooms_prevent_logo_self_write'
      and tgrelid = 'public.rooms'::regclass
  ) then
    v_remaining := v_remaining + 1;
  end if;
  if to_regprocedure('public.is_room_owner(uuid)') is not null then
    v_remaining := v_remaining + 1;
  end if;
  if to_regprocedure('public.get_room_logo_info(uuid)') is not null then
    v_remaining := v_remaining + 1;
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'room-logos: public read'
  ) then
    v_remaining := v_remaining + 1;
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'room-logos: owner insert raw'
  ) then
    v_remaining := v_remaining + 1;
  end if;

  perform set_config(
    'test.out',
    current_setting('test.out', true) || format(
      ' | rollback:objects=%s bucket_left=%s',
      v_remaining,
      exists (select 1 from storage.buckets where id = 'room-logos')
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
