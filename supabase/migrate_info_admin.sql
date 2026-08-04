-- info@grovina-studio.com を管理者(プロプラン)にする一回限りのスクリプト。
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- accounts.sql〜master_and_templates.sql・migrate_grovina_template.sqlまで
-- すべて先に実行しておくこと(テンプレートを参照するため)。
-- info@grovina-studio.comは一度もGoogleログインしていないとauth.usersに
-- 存在しないため、未ログインなら先に一度ログインしてもらう必要がある
-- (このアカウントはis_masterが自動付与されるため、ログインすると
-- /masterへ飛ぶ。その状態のままでこのスクリプトを実行すればよい)。
-- 一度だけ実行すればよい(再実行しても同じ結果になるよう存在チェックを
-- 入れている)。
--
-- 注:プランは暫定でproにしている(運用担当者のアカウントのため、
-- ルーム数・人数の上限で作業が止まらないようにする想定)。変更したい
-- 場合はinsert文のplan値を書き換えてから実行すること。
-- 初期ルームは、既にあるGrovina Officeテンプレートを流用して1つ作成する
-- (テンプレートが見つからない場合はtemplate_id未設定のルームになるので、
-- 管理画面のルーム管理から後で作り直してもよい)。

do $$
declare
  v_user_id uuid;
  v_account_id uuid;
  v_room_id uuid;
  v_template_id uuid;
  v_background_image_url text;
begin
  select id into v_user_id
  from auth.users
  where email = 'info@grovina-studio.com';

  if v_user_id is null then
    raise exception 'info@grovina-studio.com のユーザーが見つかりません。先に一度Googleログインしてください。';
  end if;

  -- 既にこのユーザーがオーナーのアカウントがあれば使い回す(再実行対策)
  select id into v_account_id
  from public.accounts
  where owner_user_id = v_user_id
  limit 1;

  if v_account_id is null then
    insert into public.accounts (name, plan, owner_user_id)
    values ('Grovina Studio', 'pro', v_user_id)
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
    select id, background_image_url into v_template_id, v_background_image_url
    from public.templates
    where name = 'Grovina Office'
    limit 1;

    insert into public.rooms (account_id, name, preview_image, template_id)
    values (
      v_account_id,
      'Grovina Studio',
      coalesce(v_background_image_url, '/map-background.webp'),
      v_template_id
    );
  end if;
end $$;
