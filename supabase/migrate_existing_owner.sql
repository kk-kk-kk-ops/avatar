-- 既存の「Grovina Office」ルーム(map_layout id='default')を、
-- k.one.for.all.k@gmail.com のアカウントへ移行する一回限りのスクリプト。
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- accounts.sql / rooms.sql / profiles.sql / map_layout_room.sql を
-- 先に実行しておくこと。このスクリプトも一度だけ実行すればよい
-- (再実行しても同じ結果になるよう存在チェックを入れている)。
--
-- 注:プランは暫定でproにしている(開発・運用担当者のアカウントのため、
-- ルーム数・人数の上限で作業が止まらないようにする想定)。変更したい
-- 場合はupdate文のplan値を書き換えてから実行すること。

do $$
declare
  v_user_id uuid;
  v_account_id uuid;
  v_room_id uuid;
begin
  select id into v_user_id
  from auth.users
  where email = 'k.one.for.all.k@gmail.com';

  if v_user_id is null then
    raise exception 'k.one.for.all.k@gmail.com のユーザーが見つかりません。先に一度Googleログインしてください。';
  end if;

  -- 既にこのユーザーがオーナーのアカウントがあれば使い回す(再実行対策)
  select id into v_account_id
  from public.accounts
  where owner_user_id = v_user_id
  limit 1;

  if v_account_id is null then
    insert into public.accounts (name, plan, owner_user_id)
    values ('Grovina Office', 'pro', v_user_id)
    returning id into v_account_id;
  end if;

  insert into public.profiles (user_id, account_id, role)
  values (v_user_id, v_account_id, 'admin')
  on conflict (user_id)
  do update set account_id = v_account_id, role = 'admin';

  -- 既にこのアカウントにルームがあれば使い回す(再実行対策)
  select id into v_room_id
  from public.rooms
  where account_id = v_account_id
  limit 1;

  if v_room_id is null then
    insert into public.rooms (account_id, name, preview_image)
    values (v_account_id, 'Grovina Office', '/map-background.webp')
    returning id into v_room_id;
  end if;

  update public.map_layout
  set room_id = v_room_id
  where id = 'default' and room_id is null;
end $$;
