-- ============================================================
-- 現時点の全機能を満たすための「まとめSQL」。
-- Supabaseダッシュボード → SQL Editor に、この内容を丸ごと1回で
-- 貼り付けて実行してください。
--
-- これまで supabase/ 以下に個別ファイルとして積み上げてきたSQLを、
-- 「今の時点で必要な最終形」だけを残して1本にまとめたものです。
-- 全体が冪等(何度実行しても同じ結果になる)になるよう作ってあるので、
-- これまでにどのファイルをどの順番で実行したか分からなくなった場合も、
-- このファイルを1回実行すれば正しい状態に揃います
-- (逆に、個別ファイルをこれ以上ばらばらに実行する必要はありません)。
-- ============================================================


-- ------------------------------------------------------------
-- 1. accounts (契約単位の組織)
-- ------------------------------------------------------------
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free',
  trial_ends_at timestamptz,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  invite_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  stripe_customer_id text,
  stripe_subscription_id text,
  invite_inviter_name text,
  created_at timestamptz not null default now()
);

alter table public.accounts enable row level security;

-- plan列のCHECK制約('master'を含む最終形にする。既存テーブルにも反映
-- されるようdrop→addで作り直す)
alter table public.accounts drop constraint if exists accounts_plan_check;
alter table public.accounts add constraint accounts_plan_check
  check (plan in ('free', 'light', 'standard', 'pro', 'master'));

alter table public.accounts
  add column if not exists invite_inviter_name text;

drop policy if exists "accounts: insert own" on public.accounts;
create policy "accounts: insert own"
  on public.accounts for insert
  with check (auth.uid() = owner_user_id);

drop policy if exists "accounts: update own" on public.accounts;
create policy "accounts: update own"
  on public.accounts for update
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);


-- ------------------------------------------------------------
-- 2. profiles (Googleログインユーザー情報 + アカウント所属)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'google',
  display_name text,
  avatar_url text,
  email text,
  last_login_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists account_id uuid references public.accounts(id) on delete set null;
alter table public.profiles
  add column if not exists role text check (role in ('admin', 'guest'));
alter table public.profiles
  add column if not exists is_master boolean not null default false;

alter table public.profiles enable row level security;

drop policy if exists "profiles: select own" on public.profiles;
create policy "profiles: select own"
  on public.profiles for select
  using (auth.uid() = user_id);

drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own"
  on public.profiles for insert
  with check (auth.uid() = user_id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ------------------------------------------------------------
-- 3. is_master(uid) — RLSを経由せずis_masterを判定するSECURITY DEFINER
--    関数。ポリシー内で直接profilesをサブクエリすると無限再帰
--    (42P17)になるため、必ずこの関数経由で判定する。
-- ------------------------------------------------------------
create or replace function public.is_master(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select is_master from public.profiles where user_id = uid),
    false
  );
$$;

grant execute on function public.is_master(uuid) to authenticated;

-- profiles: マスターは全員のプロフィールを閲覧できる(本人の行だけの
-- 既存ポリシーとはORで組み合わされる)
drop policy if exists "profiles: select master" on public.profiles;
create policy "profiles: select master"
  on public.profiles for select
  using (public.is_master(auth.uid()));


-- ------------------------------------------------------------
-- 4. accounts: SELECTポリシー(profiles.account_idを参照するため
--    profiles作成後にここで定義する)
-- ------------------------------------------------------------
drop policy if exists "accounts: select own" on public.accounts;
create policy "accounts: select own"
  on public.accounts for select
  using (
    auth.uid() = owner_user_id
    or id in (select account_id from public.profiles where user_id = auth.uid())
  );

drop policy if exists "accounts: select master" on public.accounts;
create policy "accounts: select master"
  on public.accounts for select
  using (public.is_master(auth.uid()));


-- ------------------------------------------------------------
-- 5. templates (マップのひな形。マスターだけが編集できる)
-- ------------------------------------------------------------
create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  background_image_url text not null,
  obstacles jsonb not null default '[]'::jsonb,
  meeting_area jsonb not null default '[]'::jsonb,
  map_width integer not null default 1900,
  map_height integer not null default 1900,
  created_at timestamptz not null default now()
);

alter table public.templates
  add column if not exists map_width integer not null default 1900;
alter table public.templates
  add column if not exists map_height integer not null default 1900;

alter table public.templates enable row level security;

drop policy if exists "templates: select authenticated" on public.templates;
create policy "templates: select authenticated"
  on public.templates for select
  using (auth.uid() is not null);

drop policy if exists "templates: modify master" on public.templates;
create policy "templates: modify master"
  on public.templates for all
  using (public.is_master(auth.uid()))
  with check (public.is_master(auth.uid()));


-- ------------------------------------------------------------
-- 6. rooms (バーチャル空間。1アカウントが複数持てる)
-- ------------------------------------------------------------
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  preview_image text not null default '/map-background.webp',
  template_id uuid references public.templates(id),
  created_at timestamptz not null default now()
);

alter table public.rooms
  add column if not exists template_id uuid references public.templates(id);

alter table public.rooms enable row level security;

drop policy if exists "rooms: select own account" on public.rooms;
create policy "rooms: select own account"
  on public.rooms for select
  using (
    account_id in (
      select account_id from public.profiles where user_id = auth.uid()
    )
  );

drop policy if exists "rooms: modify own account as owner" on public.rooms;
create policy "rooms: modify own account as owner"
  on public.rooms for all
  using (
    account_id in (
      select id from public.accounts where owner_user_id = auth.uid()
    )
  )
  with check (
    account_id in (
      select id from public.accounts where owner_user_id = auth.uid()
    )
  );

drop policy if exists "rooms: select master" on public.rooms;
create policy "rooms: select master"
  on public.rooms for select
  using (public.is_master(auth.uid()));


-- ------------------------------------------------------------
-- 7. map_layout (旧仕様。既存ルームの移行元データとして残っている)
-- ------------------------------------------------------------
create table if not exists public.map_layout (
  id text primary key default 'default',
  obstacles jsonb not null,
  meeting_area jsonb not null,
  room_id uuid references public.rooms(id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table public.map_layout
  add column if not exists room_id uuid references public.rooms(id) on delete cascade;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'map_layout_room_id_key'
  ) then
    alter table public.map_layout add constraint map_layout_room_id_key unique (room_id);
  end if;
end $$;

alter table public.map_layout enable row level security;

drop policy if exists "map_layout is viewable by everyone" on public.map_layout;
create policy "map_layout is viewable by everyone"
  on public.map_layout for select
  using (true);

drop policy if exists "map_layout is editable by everyone" on public.map_layout;
drop policy if exists "map_layout is editable by authenticated users" on public.map_layout;
drop policy if exists "map_layout is editable by room owner" on public.map_layout;
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


-- ------------------------------------------------------------
-- 8. Storage: テンプレートの背景画像アップロード用バケット
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('template-images', 'template-images', true)
on conflict (id) do nothing;

drop policy if exists "template-images: public read" on storage.objects;
create policy "template-images: public read"
  on storage.objects for select
  using (bucket_id = 'template-images');

drop policy if exists "template-images: master insert" on storage.objects;
create policy "template-images: master insert"
  on storage.objects for insert
  with check (
    bucket_id = 'template-images'
    and public.is_master(auth.uid())
  );

drop policy if exists "template-images: master update" on storage.objects;
create policy "template-images: master update"
  on storage.objects for update
  using (
    bucket_id = 'template-images'
    and public.is_master(auth.uid())
  );

drop policy if exists "template-images: master delete" on storage.objects;
create policy "template-images: master delete"
  on storage.objects for delete
  using (
    bucket_id = 'template-images'
    and public.is_master(auth.uid())
  );


-- ------------------------------------------------------------
-- 9. 招待トークンからアカウントを検索する関数(最終形: id/name/plan/
--    owner_user_id/invite_inviter_nameを返す)。未ログインのTOP
--    ページでも招待者名を表示するため、anonにも実行権限を付与する。
-- ------------------------------------------------------------
drop function if exists public.lookup_account_by_invite_token(text);

create function public.lookup_account_by_invite_token(token text)
returns table (
  id uuid,
  name text,
  plan text,
  owner_user_id uuid,
  invite_inviter_name text
)
language sql
security definer
set search_path = public
as $$
  select id, name, plan, owner_user_id, invite_inviter_name
  from public.accounts
  where invite_token = token;
$$;

grant execute on function public.lookup_account_by_invite_token(text) to authenticated;
grant execute on function public.lookup_account_by_invite_token(text) to anon;

-- 9b. 招待トークンからルーム一覧を取得する関数。既に自分のアカウントを
--     持つ人が他人の招待URL(/rooms?invite=token)を一時閲覧する
--     viewOnlyのケースでは、「rooms: select own account」のRLSが
--     自分自身の所属アカウントのルームしか許可しないため、素の
--     テーブルSELECTだと対象アカウントのルームが常に0件になってしまう
--     (「ルームがありません」と表示される不具合の原因)。トークンの
--     一致を条件にSECURITY DEFINERでRLSを迂回して返す。
drop function if exists public.list_rooms_by_invite_token(text);

create function public.list_rooms_by_invite_token(token text)
returns table (
  id uuid,
  account_id uuid,
  template_id uuid,
  name text,
  preview_image text
)
language sql
security definer
set search_path = public
as $$
  select r.id, r.account_id, r.template_id, r.name, r.preview_image
  from public.rooms r
  join public.accounts a on a.id = r.account_id
  where a.invite_token = token
  order by r.created_at asc;
$$;

grant execute on function public.list_rooms_by_invite_token(text) to authenticated;


-- ------------------------------------------------------------
-- 9c. app_settings: アプリ全体で共有する設定(現状はアバターの表示
--     サイズのみ)。1行(id='default')だけを使う。マスターだけが変更でき、
--     ログイン済みの全員が閲覧できる(バーチャル空間の表示に必要なため)。
-- ------------------------------------------------------------
create table if not exists public.app_settings (
  id text primary key default 'default',
  avatar_size_px integer not null default 17,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id, avatar_size_px)
values ('default', 17)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "app_settings: select authenticated" on public.app_settings;
create policy "app_settings: select authenticated"
  on public.app_settings for select
  using (auth.uid() is not null);

drop policy if exists "app_settings: update master" on public.app_settings;
create policy "app_settings: update master"
  on public.app_settings for update
  using (public.is_master(auth.uid()))
  with check (public.is_master(auth.uid()));


-- ------------------------------------------------------------
-- 10. マスター権限アカウントの契約プランを'master'に揃える
--     (プロプランではなく専用プラン。ルーム数10・人数上限30名、
--     課金対象外。/plan の選択肢には出さない)
-- ------------------------------------------------------------
update public.accounts
set plan = 'master'
where owner_user_id in (
  select user_id from public.profiles where is_master = true
)
and plan <> 'master';


-- ------------------------------------------------------------
-- 11. k.one.for.all.k@gmail.com には即座にマスター権限を付与する
--     (info@grovina-studio.comは初回ログイン時にアプリ側のコードで
--     自動付与されるためここでは不要)
-- ------------------------------------------------------------
update public.profiles
set is_master = true
where user_id in (
  select id from auth.users where email = 'k.one.for.all.k@gmail.com'
);


-- ------------------------------------------------------------
-- 12. 既存の「Grovina Office」ルームをk.one.for.all.k@gmail.comの
--     アカウントへ移行する(一度きりの処理。既に移行済みなら何もしない)
-- ------------------------------------------------------------
do $$
declare
  v_user_id uuid;
  v_account_id uuid;
  v_room_id uuid;
begin
  select id into v_user_id
  from auth.users
  where email = 'k.one.for.all.k@gmail.com';

  if v_user_id is not null then
    select id into v_account_id
    from public.accounts
    where owner_user_id = v_user_id
    limit 1;

    if v_account_id is null then
      insert into public.accounts (name, plan, owner_user_id)
      values ('Grovina Office', 'master', v_user_id)
      returning id into v_account_id;
    end if;

    insert into public.profiles (user_id, account_id, role)
    values (v_user_id, v_account_id, 'admin')
    on conflict (user_id)
    do update set account_id = v_account_id, role = 'admin';

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
  end if;
end $$;


-- ------------------------------------------------------------
-- 13. info@grovina-studio.com を管理者にする(既にログイン済みの
--     場合のみ実行される。まだ一度もログインしていなければスキップ
--     されるので、その場合は先に一度ログインしてから再実行すること)
-- ------------------------------------------------------------
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

  if v_user_id is not null then
    select id into v_account_id
    from public.accounts
    where owner_user_id = v_user_id
    limit 1;

    if v_account_id is null then
      insert into public.accounts (name, plan, owner_user_id)
      values ('Grovina Studio', 'master', v_user_id)
      returning id into v_account_id;
    end if;

    insert into public.profiles (user_id, account_id, role)
    values (v_user_id, v_account_id, 'admin')
    on conflict (user_id)
    do update set account_id = v_account_id, role = 'admin';

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
  end if;
end $$;


-- ------------------------------------------------------------
-- 14. 既存の「Grovina Office」ルームのレイアウトを最初のテンプレート
--     として登録し、ルームをそのテンプレートに紐付ける
-- ------------------------------------------------------------
do $$
declare
  v_room_id uuid;
  v_obstacles jsonb;
  v_meeting_area jsonb;
  v_template_id uuid;
begin
  select id into v_room_id from public.rooms where name = 'Grovina Office' limit 1;

  if v_room_id is not null then
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
  end if;
end $$;

-- ============================================================
-- 完了。もう一度実行しても壊れないので、迷ったらこのファイルだけ
-- 実行し直せば現在の機能に必要な状態に揃います。
-- ============================================================
