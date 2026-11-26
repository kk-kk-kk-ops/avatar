-- ②-2 ロビーでのロゴ差し替え(DB側の準備)。
--
-- 目的: スタンダード・プロの持ち主がロビーで自分のルームのロゴ画像を
-- 差し替えられるようにするための準備として、roomsテーブルに
-- logo_image_url列を足し、この列を持ち主自身のセッションから直接
-- 書き換えられないようにする(プラン確認・画像変換を必ずService Role
-- 経由のServer Actionに通すため)。あわせて、持ち主判定の関数
-- (is_room_owner)・ロゴ情報を読む関数(get_room_logo_info)・画像の
-- 保存先バケット(room-logos)を作る。このSQLではデータベース側の準備
-- だけを行い、画面側の実装は含まない(次回の指示で行う)。
--
-- 適用方法: Supabase の SQL Editor から、このファイルの内容をそのまま
-- 直接実行する。
--
-- ほかのファイルとの関係:
-- - 元に戻す場合は、同じフォルダの
--   2026-11-26_room_logo_rollback.sql を実行する。
-- - 本番適用前の予行演習は、同じフォルダの
--   2026-11-26_room_logo_rehearsal.sql(このファイルと元に戻すSQLの
--   中身を1つのトランザクションの中でそのまま試し、最後に必ず全体を
--   取り消す確認用SQL)を使う。

begin;

-- (1) roomsにlogo_image_url列を足す(null可。未設定ならテンプレートの
--     ロゴを使う、という優先順位は画面側で解決する)。
alter table public.rooms
  add column if not exists logo_image_url text;

-- (2) logo_image_urlの直接の自己書き換えを防ぐ。既存のprevent_privileged_
--     column_self_write()(profiles・accounts用)には触らず、rooms専用の
--     新しい関数・トリガーを作る。通してよい条件は既存の関数と同じ
--     (service_role・is_superuser・auth.role() is nullのいずれか)。
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

-- (3) 呼んだ人がそのルームの持ち主(accounts.owner_user_id)かどうかを
--     返す関数。Storageのポリシー・Server Actionの両方から使う。
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

-- (4) ロゴ情報(rooms.logo_image_url・そのアカウントのaccounts.plan)を
--     読む関数。呼んだ人を入れる条件はget_own_or_member_room(p_room_id)の
--     最新の定義(持ち主・メンバー・BANの扱い)と全く同じにする。
--     get_member_room_entryには触らない(別の関数として新設する)。
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

-- (5) ロゴ画像の保存先バケット。元画像は{room_id}/raw/ランダム.拡張子へ
--     持ち主自身のセッションから直接アップロードし、変換後の画像は
--     {room_id}/ランダム.webpへサーバー(Service Role)が保存する。
--     update・delete用のポリシーは作らない(変換・削除はサーバーが
--     Service Role経由で行うため、持ち主のセッションから直接の上書き・
--     削除はできない)。
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

-- フォルダ名(1階層目)がuuidの形でない場合、先に正規表現で確かめてから
-- is_room_ownerへキャストする(形が違う名前でキャストエラーにしない)。
drop policy if exists "room-logos: owner insert raw" on storage.objects;
create policy "room-logos: owner insert raw"
  on storage.objects for insert
  with check (
    bucket_id = 'room-logos'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_room_owner(((storage.foldername(name))[1])::uuid)
    and (storage.foldername(name))[2] = 'raw'
  );

-- 事後の確認: 列・2つの関数・トリガー・バケット・2つのポリシーがそろって
-- いるかを確かめる。1つでも無ければ取り消す。
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

commit;
