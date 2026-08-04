-- 既存の「Grovina Office」ルームのレイアウト(map_layout)を最初の
-- テンプレートとして登録し、ルームをそのテンプレートに紐付ける。
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- master_and_templates.sql を先に実行しておくこと。
-- 一度だけ実行すればよい(再実行しても同じ結果になるよう存在チェックを
-- 入れている)。

do $$
declare
  v_room_id uuid;
  v_obstacles jsonb;
  v_meeting_area jsonb;
  v_template_id uuid;
begin
  select id into v_room_id from public.rooms where name = 'Grovina Office' limit 1;
  if v_room_id is null then
    raise exception 'Grovina Officeルームが見つかりません。先にmigrate_existing_owner.sqlを実行してください。';
  end if;

  select id into v_template_id from public.templates where name = 'Grovina Office' limit 1;

  if v_template_id is null then
    select obstacles, meeting_area into v_obstacles, v_meeting_area
    from public.map_layout
    where room_id = v_room_id;

    insert into public.templates (name, background_image_url, obstacles, meeting_area)
    values (
      'Grovina Office',
      '/map-background.webp',
      coalesce(v_obstacles, '[]'::jsonb),
      coalesce(v_meeting_area, '[]'::jsonb)
    )
    returning id into v_template_id;
  end if;

  update public.rooms
  set template_id = v_template_id
  where id = v_room_id and template_id is null;
end $$;
