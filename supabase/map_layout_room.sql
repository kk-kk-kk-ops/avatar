-- map_layoutをルームごとに分けるための拡張。
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- accounts.sql・rooms.sqlを先に実行しておくこと(room_idの外部キー参照のため)。
-- migrate_existing_owner.sqlより先に、必ずこのファイルを実行すること
-- (migrate_existing_owner.sqlはこのファイルで追加されるroom_id列を
-- 更新するため、room_id列が存在しないと42703エラーになる)。

alter table public.map_layout
  add column if not exists room_id uuid references public.rooms(id) on delete cascade;

-- room_idごとに1行だけになるようにする(アプリ側はroom_idを指定した
-- upsert(onConflict: "room_id")で読み書きするため)。
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'map_layout_room_id_key'
  ) then
    alter table public.map_layout add constraint map_layout_room_id_key unique (room_id);
  end if;
end $$;

-- 編集(書き込み)のRLSを「そのルームが属するアカウントの管理者のみ」に絞り直す。
-- (ゲストはマップ編集不可。管理者だけがレイアウトを変更できる想定)
-- 閲覧(select)はルームプレビュー等でも使うため、これまで通り誰でも可能なままにする。
drop policy if exists "map_layout is editable by authenticated users" on public.map_layout;

create policy "map_layout is editable by room owner"
  on public.map_layout for all
  using (
    room_id in (
      select r.id from public.rooms r
      join public.accounts a on a.id = r.account_id
      where a.owner_user_id = auth.uid()
    )
  )
  with check (
    room_id in (
      select r.id from public.rooms r
      join public.accounts a on a.id = r.account_id
      where a.owner_user_id = auth.uid()
    )
  );
