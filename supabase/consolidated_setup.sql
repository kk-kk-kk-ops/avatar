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
  livekit_server_id text,
  created_at timestamptz not null default now()
);

alter table public.accounts enable row level security;

-- ------------------------------------------------------------
-- 1b. 権限昇格防止トリガー(関数本体+accounts分)。
--     profiles.role/is_master、accounts.planは「本人の行である」ことしか
--     RLSで表現できておらず(列単位の制限ができない)、ログイン済み
--     ユーザーがSupabaseのREST APIを直接叩けば自分のrole/is_master/plan
--     を書き換えられてしまう問題があった(2026-08 Tech Lead確認依頼
--     その25で発覚)。service_role以外からのこれらの列の変更を一律拒否
--     する。UPDATEだけでなくINSERTも対象にし、最初からis_master=true・
--     plan='pro'で行を作る形での迂回も防ぐ。
--
--     正規の変更(招待経由のrole付与、無料お試し開始時のrole付与、
--     マスターメール判定によるis_master付与、デバッグ用プラン切替)は
--     すべてアプリ側でservice_roleクライアント(lib/supabase/serviceRole.ts)
--     に切り替え済み。
--
--     2026-09-01追記(バイパス条件): 当初はSupabaseダッシュボード(SQL
--     Editor等)からの直接操作を「postgresロール=スーパーユーザー扱い」
--     としてcurrent_setting('is_superuser')でバイパスできる想定だったが、
--     Supabaseのホスティング環境ではSQL Editorが使うpostgresロールは
--     真のPostgreSQLスーパーユーザーではなく(is_superuser=off)、この
--     分岐は実際には一度も機能していなかった。そのため、PostgREST
--     (SupabaseのREST API)を経由しない書き込みを示す確実なsignalとして
--     auth.role() is nullも許可条件に加える。REST API経由の書き込みは、
--     anonキー・authenticatedユーザーのJWT・service_roleキーのいずれで
--     あっても、PostgRESTが必ずroleクレームをセットするためauth.role()が
--     nullになることは無い(=元の脆弱性の攻撃経路であるREST直叩きは
--     引き続き一切救われない)。nullになるのはSQL Editor・psql・
--     Supabase CLIのマイグレーション等、PostgRESTを経由しない直接DB
--     接続のみで、その経路にアクセスできる時点でトリガー自体を無効化
--     する等も可能な、別次元の信頼レベルの操作のため、ここをバイパス
--     しても防御力は落ちない。
--
--     2026-09-01追記(定義位置): この関数・accounts向けトリガーは、
--     直後の「plan='master'の既存行をfreeへ移行」処理より前に有効化
--     しておく必要があるため、accountsテーブル作成直後のこの位置に置く
--     (profiles向けトリガーはprofilesテーブル作成直後の「2a」に別途置く)。
--     旧・セクション16に両方まとめて置いていたが、それだとこのファイル内
--     で先に実行されるセクション11-13(管理者アカウントのrole='admin'
--     付与等)より後になってしまい、「前回実行時点の古いトリガー定義」が
--     適用されたまま失敗する不具合があった。
-- ------------------------------------------------------------
create or replace function public.prevent_privileged_column_self_write()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'service_role'
     or current_setting('is_superuser', true) = 'on'
     or auth.role() is null then
    return new;
  end if;

  if tg_table_name = 'profiles' then
    if tg_op = 'INSERT' then
      if new.role is not null or new.is_master is true then
        raise exception 'role/is_masterはこの経路からは設定できません';
      end if;
    elsif tg_op = 'UPDATE' then
      if new.role is distinct from old.role
         or new.is_master is distinct from old.is_master then
        raise exception 'role/is_masterはこの経路からは変更できません';
      end if;
    end if;
  elsif tg_table_name = 'accounts' then
    if tg_op = 'INSERT' then
      if new.plan is distinct from 'free' then
        raise exception '新規契約はfreeプランでのみ作成できます';
      end if;
    elsif tg_op = 'UPDATE' then
      if new.plan is distinct from old.plan then
        raise exception 'planはこの経路からは変更できません';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists accounts_prevent_privileged_self_write on public.accounts;
create trigger accounts_prevent_privileged_self_write
  before insert or update on public.accounts
  for each row
  execute function public.prevent_privileged_column_self_write();

-- plan列のCHECK制約。マスタープランは廃止したため、既存にplan='master'の
-- 行が残っていれば先に'free'へ移行してから(そうしないと制約違反になる)、
-- 'master'を含まない制約を作り直す。マスター権限アカウントは今後、
-- 通常の4プランのいずれかを持ち、DEBUG_PLAN_SWITCH_EMAILの仕組みで
-- 自由に切り替える(マスター画面へのアクセス権はis_masterフラグで別途
-- 管理しており、これとは無関係)。
update public.accounts set plan = 'free' where plan = 'master';

-- ビジネスプラン(50人上限)は、単一送信元からの同時接続50人規模で
-- WebARENA Indigo側のネットワーク遮断が発生することが負荷テストで
-- 判明したため廃止し、30人上限のプロプランに一本化した(2026-08)。
-- 契約時点でビジネスプラン利用者はゼロだったため移行処理は行っていない。
alter table public.accounts drop constraint if exists accounts_plan_check;
alter table public.accounts add constraint accounts_plan_check
  check (plan in ('free', 'light', 'standard', 'pro'));

alter table public.accounts
  add column if not exists invite_inviter_name text;

-- 契約(アカウント)ごとに固定で割り当てる物理LiveKitサーバーのID
-- (lib/livekitServers.tsのLIVEKIT_SERVERSに対応するid文字列。未設定(null)は
-- デフォルトサーバーを使う)。動的な人数監視による振り分けではなく、契約時点で
-- 固定することで「同じ部屋の利用者がサーバー違いで音声だけ分断される」事態を
-- 避ける設計(詳細はdeploy/livekit/LOAD_TEST_PLAN.md参照)。
alter table public.accounts
  add column if not exists livekit_server_id text;

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
-- 2a. 権限昇格防止トリガー(profiles分)。関数本体・経緯は「1b」参照。
--     このファイル内で後続のセクション11-13(管理者アカウントへの
--     role='admin'付与)より前に有効化しておく必要があるため、profiles
--     テーブル作成直後のこの位置に置く。
-- ------------------------------------------------------------
drop trigger if exists profiles_prevent_privileged_self_write on public.profiles;
create trigger profiles_prevent_privileged_self_write
  before insert or update on public.profiles
  for each row
  execute function public.prevent_privileged_column_self_write();


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
  spawn_x double precision,
  spawn_y double precision,
  created_at timestamptz not null default now()
);

alter table public.templates
  add column if not exists map_width integer not null default 1900;
alter table public.templates
  add column if not exists map_height integer not null default 1900;
-- 入室時のアバター初期位置(未設定=null の場合はマップ中心にスポーンする)
alter table public.templates
  add column if not exists spawn_x double precision;
alter table public.templates
  add column if not exists spawn_y double precision;
-- ワープポイント(2026-09追加)。WarpPoint[](lib/types.ts)をそのまま
-- 保存する。obstacles/meeting_areaと同じくテンプレート単位の配列で、
-- ルーム側では個別に持たない。
alter table public.templates
  add column if not exists warp_points jsonb not null default '[]'::jsonb;

-- 装飾オブジェクト機能(2026-09追加)。
-- object_library: 「オブジェクト登録」で登録した透過PNG画像のライブラリ
-- (TemplateObjectImage[]、lib/types.ts参照)。テンプレートごとに独立
-- (他のテンプレートとは共有しない)。
-- placed_objects: 実際にマップへ配置したインスタンス(PlacedObject[])。
-- 壁(obstacles)と違い実際に画像として表示され、当たり判定は持たない。
alter table public.templates
  add column if not exists object_library jsonb not null default '[]'::jsonb;
alter table public.templates
  add column if not exists placed_objects jsonb not null default '[]'::jsonb;

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
-- 9d. screen_watch_stats: 画面共有の「視聴累積時間」をマスター画面に
--     表示するための集計テーブル。月ごとに1行(id='YYYY-MM')持ち、
--     現在の月の行だけを参照することで、翌月になれば自動的に0から
--     始まる(=毎月1日リセット)。視聴者ごとにクライアントが30秒おきに
--     increment_screen_watch_seconds()を呼び、視聴人数分だけ加算される
--     (1人が30分視聴×5人なら合計2時間30分になる)。
-- ------------------------------------------------------------
create table if not exists public.screen_watch_stats (
  month text primary key,
  watch_seconds bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.screen_watch_stats enable row level security;

drop policy if exists "screen_watch_stats: select authenticated" on public.screen_watch_stats;
create policy "screen_watch_stats: select authenticated"
  on public.screen_watch_stats for select
  using (auth.uid() is not null);

-- 直接のINSERT/UPDATEポリシーは用意しない(下のSECURITY DEFINER関数
-- 経由でのみ更新できるようにし、クライアントから任意の値を書き込ませない)。

drop function if exists public.increment_screen_watch_seconds(integer);

create function public.increment_screen_watch_seconds(seconds integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds integer;
begin
  if auth.uid() is null then
    return;
  end if;
  -- 1回の加算は60秒までに制限し、クライアントからの誤送信・不正な
  -- 大量加算を防ぐ(想定は30秒おきの心拍送信)。
  v_seconds := greatest(0, least(seconds, 60));
  if v_seconds = 0 then
    return;
  end if;

  insert into public.screen_watch_stats (month, watch_seconds)
  values (to_char(now(), 'YYYY-MM'), v_seconds)
  on conflict (month) do update
    set watch_seconds = screen_watch_stats.watch_seconds + v_seconds,
        updated_at = now();
end;
$$;

grant execute on function public.increment_screen_watch_seconds(integer) to authenticated;


-- ------------------------------------------------------------
-- 9e. daily_usage: 「1日あたり利用時間」上限管理の汎用テーブル
--     (旧screen_share_usageを一般化。当初は画面共有専用だったが、
--     ビデオ通話にも全く同じ形の日次上限が必要になったため、種別列
--     kind('screen_share' | 'video_call' | 'voice_call')を持つ1つのテーブル・1組の
--     RPCに統合した。ロジック(JST4:00リセット・30秒ハートビート・
--     60秒/回の加算上限)を2重管理しないための判断)。
--     ログインユーザー・日・種別ごとに1行持ち、day_keyはJST 4:00を
--     境界とした日付("その時刻から4時間引いた日付")のため、日付が
--     変われば新しい行から自動的に0からカウントが始まる
--     (=毎日4:00リセット、明示的なリセットバッチ不要。screen_watch_stats
--     の月次リセットと同じ考え方)。利用中のクライアントが30秒おきに
--     increment_daily_usage_seconds()を呼んで加算する。プランごとの
--     上限分数(nullは無制限)はDBでは持たず、lib/types.tsのPLANSを
--     唯一の情報源としてクライアント側で「今日の使用量(このテーブル)
--     vs 上限」を比較する(他の上限値・maxPeoplePerRoom等と同じ方針。
--     無制限プランではこのテーブルへの読み書き自体を行わない)。
-- ------------------------------------------------------------

-- 旧テーブル名からの一度きりの移行(既存データを引き継ぐ)。まだ
-- daily_usageが存在せず、旧screen_share_usageが存在する場合だけリネームする。
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'screen_share_usage'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'daily_usage'
  ) then
    alter table public.screen_share_usage rename to daily_usage;
  end if;
end $$;

create table if not exists public.daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day_key date not null,
  kind text not null default 'screen_share',
  used_seconds integer not null default 0,
  updated_at timestamptz not null default now()
);

-- 上のcreate table if not existsは、リネームによって既にdaily_usageが
-- 存在するケースでは何もしない(既存テーブルの列は追加されない)ため、
-- kind列が無ければここで明示的に追加する。
alter table public.daily_usage add column if not exists kind text;

-- 旧screen_share_usageからリネームした行にはkindが無いため、画面共有として
-- 補完する(このテーブルは元々画面共有専用だったため)。
update public.daily_usage set kind = 'screen_share' where kind is null;

alter table public.daily_usage alter column kind set not null;

alter table public.daily_usage drop constraint if exists daily_usage_kind_check;
alter table public.daily_usage add constraint daily_usage_kind_check
  check (kind in ('screen_share', 'video_call', 'voice_call', 'image_upload'));

-- image_upload(1日の画像アップロード枚数)は秒数ではなく回数で数えるため、
-- used_secondsとは別に整数カウント用の列を持つ。
alter table public.daily_usage add column if not exists used_count integer not null default 0;

-- 主キーをリネーム前(user_id, day_key)から(user_id, day_key, kind)へ
-- 付け替える(リネームされたテーブルの旧PK名・新規作成時のPK名の両方を
-- 考慮してdropする)。
alter table public.daily_usage drop constraint if exists screen_share_usage_pkey;
alter table public.daily_usage drop constraint if exists daily_usage_pkey;
alter table public.daily_usage add constraint daily_usage_pkey
  primary key (user_id, day_key, kind);

alter table public.daily_usage enable row level security;

drop policy if exists "screen_share_usage: select own" on public.daily_usage;
drop policy if exists "daily_usage: select own" on public.daily_usage;
create policy "daily_usage: select own"
  on public.daily_usage for select
  using (auth.uid() = user_id);

-- 直接のINSERT/UPDATEポリシーは用意しない(下のSECURITY DEFINER関数
-- 経由でのみ更新できるようにし、クライアントから任意の値を書き込ませない)。

drop function if exists public.increment_screen_share_seconds(integer);
drop function if exists public.get_screen_share_used_seconds();
drop function if exists public.increment_daily_usage_seconds(text, integer);

-- パラメータ名はdaily_usage.kind列と同名だと、PL/pgSQL側で列参照と
-- パラメータ参照のどちらか曖昧になる(plpgsql.variable_conflict設定次第で
-- エラーになりうる)ため、p_接頭辞を付けて確実に区別する。
create function public.increment_daily_usage_seconds(p_kind text, seconds integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds integer;
  v_day_key date;
  v_total integer;
begin
  if auth.uid() is null then
    return 0;
  end if;
  if p_kind not in ('screen_share', 'video_call', 'voice_call') then
    raise exception '不正な種別です';
  end if;
  -- 1回の加算は60秒までに制限し、クライアントからの誤送信・不正な
  -- 大量加算を防ぐ(想定は30秒おきの心拍送信)。
  v_seconds := greatest(0, least(seconds, 60));
  v_day_key := (timezone('Asia/Tokyo', now()) - interval '4 hours')::date;

  if v_seconds = 0 then
    select used_seconds into v_total
    from public.daily_usage
    where user_id = auth.uid() and day_key = v_day_key and kind = p_kind;
    return coalesce(v_total, 0);
  end if;

  insert into public.daily_usage (user_id, day_key, kind, used_seconds)
  values (auth.uid(), v_day_key, p_kind, v_seconds)
  on conflict (user_id, day_key, kind) do update
    set used_seconds = daily_usage.used_seconds + v_seconds,
        updated_at = now()
  returning used_seconds into v_total;

  return v_total;
end;
$$;

grant execute on function public.increment_daily_usage_seconds(text, integer) to authenticated;

-- 画面共有・ビデオ通話を開始する前に、今日すでに使った秒数を取得するための
-- 関数(ハートビートを待たず、開始ボタン表示時点で残り時間を出すために使う)。
drop function if exists public.get_daily_usage_used_seconds(text);

create function public.get_daily_usage_used_seconds(p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day_key date;
  v_total integer;
begin
  if auth.uid() is null then
    return 0;
  end if;
  v_day_key := (timezone('Asia/Tokyo', now()) - interval '4 hours')::date;
  select used_seconds into v_total
  from public.daily_usage
  where user_id = auth.uid() and day_key = v_day_key and kind = p_kind;
  return coalesce(v_total, 0);
end;
$$;

grant execute on function public.get_daily_usage_used_seconds(text) to authenticated;

-- 画像アップロード1日30枚(全プラン共通)の上限管理用。上記の秒数系関数と
-- 同じ day_key(JST 4:00境界)・テーブルを使うが、加算対象がused_countの
-- ため専用の関数にする(kindは常に'image_upload'固定でよいため引数化しない)。
--
-- 2026-09 QA指摘: 以前はp_limit引数が無く無条件に加算するだけだったため、
-- 「現在値を取得→上限未満か確認→加算」を呼び出し元(app/api/chat/
-- compress-image/route.ts)側で行っていた。この2回のRPC呼び出しの間に
-- 同時に別のアップロードが割り込むと、両方とも「上限未満」と判定して
-- しまい、1日の上限を多少超過しうるcheck-then-actのレースがあった。
-- p_limitを渡すと、ON CONFLICT DO UPDATE ... WHEREの行ロックにより
-- 「現在値の確認」と「加算」を1つの原子的な操作にできる(上限に達して
-- いる場合はDO UPDATEの対象行が更新されず、この呼び出し全体がFOUND=false
-- になるため、加算されなかったことをnullで呼び出し元に伝える)。
-- p_limitを省略(null)した場合は上限チェックをせず常に加算する
-- (呼び出し元で別途チェック済みの場合のための後方互換)。
drop function if exists public.increment_daily_image_upload_count();
drop function if exists public.increment_daily_image_upload_count(integer);

create function public.increment_daily_image_upload_count(p_limit integer default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day_key date;
  v_total integer;
begin
  if auth.uid() is null then
    return 0;
  end if;
  v_day_key := (timezone('Asia/Tokyo', now()) - interval '4 hours')::date;

  insert into public.daily_usage (user_id, day_key, kind, used_count)
  values (auth.uid(), v_day_key, 'image_upload', 1)
  on conflict (user_id, day_key, kind) do update
    set used_count = daily_usage.used_count + 1,
        updated_at = now()
    where p_limit is null or daily_usage.used_count < p_limit
  returning used_count into v_total;

  if not found then
    -- 上限に達しているため加算されなかった。呼び出し元はnullを
    -- 「今回のアップロードは拒否」として扱う。
    return null;
  end if;

  return v_total;
end;
$$;

grant execute on function public.increment_daily_image_upload_count(integer) to authenticated;

drop function if exists public.get_daily_image_upload_count();

create function public.get_daily_image_upload_count()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day_key date;
  v_total integer;
begin
  if auth.uid() is null then
    return 0;
  end if;
  v_day_key := (timezone('Asia/Tokyo', now()) - interval '4 hours')::date;
  select used_count into v_total
  from public.daily_usage
  where user_id = auth.uid() and day_key = v_day_key and kind = 'image_upload';
  return coalesce(v_total, 0);
end;
$$;

grant execute on function public.get_daily_image_upload_count() to authenticated;


-- ------------------------------------------------------------
-- 9f. chat_messages: 参加者ごとの1対1DM(旧仕様は「ルーム全体への
--     一括投稿」だったが、DM形式に刷新した)。
--     配信自体は既存のSupabase Realtime broadcast(avatar-room-{roomId}
--     チャンネル)にそのまま"dm"イベントを流すことで即時反映し、この
--     テーブルは「リロード後・再入室後も履歴が見える」ための永続化専用に
--     使う(postgres_changesの購読は使わない。スレッドを開いた時点で
--     相手との履歴をまとめてSELECTするだけで済むため)。
--     宛先(recipient_user_id)は、バーチャル空間の参加者ID
--     (ブラウザセッションごとのランダムID)ではなく、認証済み
--     ユーザーの安定ID(auth.uid())を使う。参加者IDはリロードのたびに
--     変わってしまい、DMの宛先として使うと過去のスレッドが別人扱いに
--     なってしまうため。
-- ------------------------------------------------------------
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  sender_name text not null,
  message text not null,
  created_at timestamptz not null default now()
);

-- DM化にあたっての一度きりの移行。旧「ルーム全体への一括投稿」データには
-- 宛先という概念が無くDMへ意味的に変換できないため、recipient_user_id列が
-- まだ無い場合(=このブロックを初めて実行する場合)にのみ、旧データを
-- 削除してから列を追加する。既にDM化済み(列が存在する)場合は何もしない
-- ため、再実行してもそれ以降に蓄積したDMデータは消えない。
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'chat_messages'
      and column_name = 'recipient_user_id'
  ) then
    delete from public.chat_messages;
    alter table public.chat_messages
      add column recipient_user_id uuid references auth.users(id) on delete cascade not null;
  end if;
end $$;

-- メッセージの編集・削除(自分の送信分のみ)対応。編集はedited_atを、
-- 削除はdeleted_atを立てる論理削除にする(messageは空文字にし、行自体は
-- 残す)。削除済み行も、保管期間経過後は下のget_expired_chat_message_ids()
-- 経由のバッチ削除でいずれ物理削除される。
alter table public.chat_messages add column if not exists edited_at timestamptz;
alter table public.chat_messages add column if not exists deleted_at timestamptz;

-- 画像添付機能用。Supabase Storageの"chat-images"バケット内のパスを
-- 保持する(未添付メッセージはnull)。パスは常に
-- "{room_id}/{sender_user_id}/{uuid}.webp"の形式(なりすまし防止の検証を
-- 下のinsert own dmポリシーで行う)。
alter table public.chat_messages add column if not exists image_path text;

-- グループチャット退出時の「○○が退出しました」通知用(2026-08-30)。
-- 通常のメッセージと区別して表示する(枠なし・赤文字)ためのフラグ。
alter table public.chat_messages add column if not exists is_system boolean not null default false;

-- テキストも画像も無い空メッセージを禁止する(画像添付時はmessageが
-- 空文字でも許容するため、画像添付機能の導入に合わせてこの制約を追加)。
-- 論理削除(上のedited_at/deleted_at列。削除時はmessageを空文字にする
-- 既存の仕様)された行は、本文・画像どちらも無い状態が正常なので、
-- deleted_at is not nullの行はこの制約の対象外にする
-- (これを入れ忘れると、本番に既に存在する削除済みメッセージ行が
-- 軒並み制約違反になり、ALTER TABLE自体が失敗する)。
alter table public.chat_messages drop constraint if exists chat_messages_content_check;
alter table public.chat_messages add constraint chat_messages_content_check
  check (message <> '' or image_path is not null or deleted_at is not null);

create index if not exists chat_messages_room_id_created_at_idx
  on public.chat_messages (room_id, created_at);
create index if not exists chat_messages_thread_idx
  on public.chat_messages (room_id, sender_user_id, recipient_user_id);

alter table public.chat_messages enable row level security;

drop policy if exists "chat_messages: select own account rooms" on public.chat_messages;
drop policy if exists "chat_messages: select own dm" on public.chat_messages;
create policy "chat_messages: select own dm"
  on public.chat_messages for select
  using (
    (sender_user_id = auth.uid() or recipient_user_id = auth.uid())
    and room_id in (
      select r.id from public.rooms r
      join public.profiles p on p.account_id = r.account_id
      where p.user_id = auth.uid()
    )
  );

drop policy if exists "chat_messages: insert own account rooms" on public.chat_messages;
drop policy if exists "chat_messages: insert own dm" on public.chat_messages;
create policy "chat_messages: insert own dm"
  on public.chat_messages for insert
  with check (
    sender_user_id = auth.uid()
    and recipient_user_id <> auth.uid()
    and char_length(message) <= 500
    -- 画像添付時のなりすまし防止: image_pathは必ず自分の
    -- "{room_id}/{sender_user_id}/"配下でなければならない
    -- (他人がアップロードした画像パスを勝手に参照させない)。
    and (
      image_path is null
      or image_path like (room_id::text || '/' || sender_user_id::text || '/%')
    )
    and room_id in (
      select r.id from public.rooms r
      join public.profiles p on p.account_id = r.account_id
      where p.user_id = auth.uid()
    )
    -- 宛先(recipient_user_id)がアカウントのprofilesに所属することは
    -- 検証しない。viewOnly(招待URL経由のゲスト)は設計上そのアカウントの
    -- profilesに入らないため、この検証があると管理者からviewOnlyゲストへの
    -- DMだけが拒否されてしまう(send_chat_message_by_invite_token関数
    -- 経由のゲスト→管理者方向は同様の検証を行っておらず非対称だった)。
    -- 実際に読めるかどうかはSELECT側のRLS([recipient_user_id = auth.uid()]
    -- かつ本人のアカウントのルーム)、またはviewOnly側はinvite_token突合の
    -- SECURITY DEFINER関数で別途制御されるため、ここを緩めても閲覧範囲は
    -- 広がらない。
  );

-- 自分が送信したメッセージの編集・削除用。sender_user_id = auth.uid()の
-- 行だけを対象にする(recipient側は更新できない)。編集・削除どちらも
-- 同じ行に対するUPDATEのため、1つのポリシーで両方をカバーする。
drop policy if exists "chat_messages: update own dm" on public.chat_messages;
create policy "chat_messages: update own dm"
  on public.chat_messages for update
  using (sender_user_id = auth.uid())
  with check (sender_user_id = auth.uid());

-- 9f-1a. sender_nameのなりすまし防止トリガー(2026-09 QA指摘)。
--   sender_nameは元々「メッセージ送信時点の表示名スナップショット」として
--   クライアントが自由に送信する設計だったが、RLS「chat_messages: insert
--   own dm」はsender_user_id = auth.uid()のみを検証しており、sender_name
--   の値自体はprofiles.display_nameと一切突き合わせていなかった。その
--   ため、送信者が自分のプロフィール名とは異なる任意の名前(別の実在
--   参加者の名前等)を騙って送信できてしまっていた。
--
--   通常のクライアントは元々「送信時点の自分の表示名」を正しく送っている
--   ため、INSERT時に必ずprofiles.display_nameで上書きしても正直な利用者
--   から見た挙動は変わらない(値が一致しているため)。profilesの行が
--   見つからない場合(理論上ほぼ起こらないが念のため)は、既存の
--   NEW.sender_nameをそのまま残す(INSERT自体を失敗させない)。
--   通常ルート(RLS経由の直接INSERT)・招待URL経由の
--   send_chat_message_by_invite_token()・leave_chat_group()の退出通知
--   のいずれの経路で挿入されても、BEFORE INSERTトリガーのため一律に適用
--   される。
create or replace function public.force_chat_message_sender_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  select coalesce(display_name, email) into v_display_name
  from public.profiles
  where user_id = new.sender_user_id;

  if v_display_name is not null and v_display_name <> '' then
    new.sender_name := v_display_name;
  end if;

  return new;
end;
$$;

drop trigger if exists chat_messages_force_sender_name on public.chat_messages;
create trigger chat_messages_force_sender_name
  before insert on public.chat_messages
  for each row
  execute function public.force_chat_message_sender_name();

-- 9f-2. viewOnly(既に自分のアカウントを持つ人が他人の招待URLを一時閲覧中)
--       のチャット対応。上記のRLSは「自分のprofiles.account_id = ルームの
--       account_id」だけを許可するため、viewOnlyのケース(profiles.account_id
--       を書き換えない設計。招待URLバグ修正の経緯を参照)では読み書きどちらも
--       弾かれてしまう。list_rooms_by_invite_token と同じ考え方で、招待
--       トークンの一致をSECURITY DEFINERで検証したうえでRLSを迂回する
--       関数を別途用意し、viewOnly時はクライアントからこちらを呼ぶ
--       (app/api/livekit-token/route.tsの認可判定と同じ「通常ルート/
--       viewOnlyルート」の使い分け)。DMになったため、どちらの関数も
--       会話相手(peer_user_id / recipient_user_id)を引数に取る。
-- 引数を追加(peer_user_id)して関数シグネチャが変わったため、旧シグネチャ
-- (本番に既に存在しうる)・新シグネチャ(再実行時に既に存在しうる)の
-- 両方をdropしてから作り直す。
drop function if exists public.list_chat_messages_by_invite_token(text, uuid);
drop function if exists public.list_chat_messages_by_invite_token(text, uuid, uuid);

create function public.list_chat_messages_by_invite_token(
  token text,
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
  image_path text
)
language sql
security definer
set search_path = public
as $$
  select m.id, m.sender_user_id, m.sender_name, m.message, m.created_at,
    m.edited_at, m.deleted_at, m.image_path
  from public.chat_messages m
  join public.rooms r on r.id = m.room_id
  join public.accounts a on a.id = r.account_id
  where a.invite_token = token
    and r.id = target_room_id
    and (
      (m.sender_user_id = auth.uid() and m.recipient_user_id = peer_user_id)
      or (m.sender_user_id = peer_user_id and m.recipient_user_id = auth.uid())
    )
  order by m.created_at asc
  limit 50;
$$;

grant execute on function public.list_chat_messages_by_invite_token(text, uuid, uuid) to authenticated;

-- 引数を追加(p_image_path)して関数シグネチャが変わったため、
-- 旧シグネチャ・新シグネチャの両方をdropしてから作り直す。
drop function if exists public.send_chat_message_by_invite_token(text, uuid, text, text);
drop function if exists public.send_chat_message_by_invite_token(text, uuid, uuid, text, text);
drop function if exists public.send_chat_message_by_invite_token(text, uuid, uuid, text, text, text);

create function public.send_chat_message_by_invite_token(
  token text,
  target_room_id uuid,
  recipient_user_id uuid,
  sender_name text,
  message text,
  p_image_path text default null
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
  where a.invite_token = token
    and r.id = target_room_id;

  if v_room_id is null then
    raise exception 'このルームへのアクセス権がありません';
  end if;

  -- 画像添付時のなりすまし防止(通常ルートのRLSと同じ検証)。
  if p_image_path is not null
     and p_image_path not like (v_room_id::text || '/' || auth.uid()::text || '/%') then
    raise exception '不正な画像パスです';
  end if;

  return query
    insert into public.chat_messages
      (room_id, sender_user_id, recipient_user_id, sender_name, message, image_path)
    values (v_room_id, auth.uid(), recipient_user_id, sender_name, message, p_image_path)
    returning chat_messages.id, chat_messages.created_at;
end;
$$;

grant execute on function public.send_chat_message_by_invite_token(text, uuid, uuid, text, text, text) to authenticated;

-- viewOnly向けのメッセージ編集。通常ルートは上のRLS
-- ("chat_messages: update own dm")で直接UPDATEできるが、viewOnlyは
-- そのRLSでも(profiles.account_idが対象アカウントと一致しないため)
-- 弾かれるので、招待トークンを検証するSECURITY DEFINER関数を用意する。
-- パラメータ名は列名と区別するためp_接頭辞を付ける
-- (increment_daily_usage_secondsと同じ理由)。
drop function if exists public.edit_chat_message_by_invite_token(text, uuid, text, timestamptz);

create function public.edit_chat_message_by_invite_token(
  token text,
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
  where a.invite_token = token
    and m.id = p_message_id
    and m.sender_user_id = auth.uid()
    and m.deleted_at is null;

  if v_room_id is null then
    raise exception 'このメッセージは編集できません';
  end if;

  update public.chat_messages
  set message = p_new_message, edited_at = p_edited_at
  where id = p_message_id;
end;
$$;

grant execute on function public.edit_chat_message_by_invite_token(text, uuid, text, timestamptz) to authenticated;

-- viewOnly向けのメッセージ削除(論理削除)。上のedit関数と同じ考え方。
drop function if exists public.delete_chat_message_by_invite_token(text, uuid, timestamptz);

create function public.delete_chat_message_by_invite_token(
  token text,
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
  where a.invite_token = token
    and m.id = p_message_id
    and m.sender_user_id = auth.uid();

  if v_room_id is null then
    raise exception 'このメッセージは削除できません';
  end if;

  update public.chat_messages
  set message = '', deleted_at = p_deleted_at
  where id = p_message_id;
end;
$$;

grant execute on function public.delete_chat_message_by_invite_token(text, uuid, timestamptz) to authenticated;

-- 9f-3. チャット履歴の削除ポリシー。
--   ・保管期間はプラン別(free:7日/light,standard:1ヶ月/pro:3ヶ月)。
--     判定は「削除処理実行時点でのそのルームが属するアカウントの現在の
--     プラン」を使う(chat_messages.room_id → rooms.account_id → accounts.plan)。
--   ・ルーム自体が削除された場合は、chat_messages.room_idの
--     "on delete cascade"により保管期間を待たず即座に削除される
--     (上のcreate table定義で対応済み。追加対応不要)
--
--   従来はここでpg_cronから直接delete_expired_chat_messages()を呼んで
--   いたが、画像添付機能(image_path列。導入時に追記)のStorageオブジェクト
--   本体はSQLのDELETEだけでは実ファイルが削除されない(storage.objectsの
--   行を消してもStorageバックエンド上の実体は残る、というSupabase Storageの
--   既知の制約)。そのため実際の削除実行はアプリ側
--   (app/api/cron/cleanup-chat-history/route.ts、Vercel Cronから毎日
--   4:00 JSTに起動)に移し、ここでは「削除対象を選ぶだけ」のSECURITY
--   DEFINER関数を用意する。service_roleからのみ実行できるようにし、
--   一般ユーザー(authenticated/anon)には実行権限を渡さない。
drop function if exists public.delete_expired_chat_messages();

drop function if exists public.get_expired_chat_message_ids();

create function public.get_expired_chat_message_ids()
returns table (id uuid, image_path text)
language sql
security definer
set search_path = public
stable
as $$
  select m.id, m.image_path
  from public.chat_messages m
  join public.rooms r on r.id = m.room_id
  join public.accounts a on a.id = r.account_id
  where m.created_at < now() - (
    case a.plan
      when 'free' then interval '7 days'
      when 'light' then interval '1 month'
      when 'standard' then interval '1 month'
      when 'pro' then interval '3 months'
      else interval '1 month'
    end
  );
$$;

revoke all on function public.get_expired_chat_message_ids() from public;
grant execute on function public.get_expired_chat_message_ids() to service_role;

-- 旧pg_cronジョブ(delete-expired-chat-messages)は上記の理由で廃止。
-- 既存プロジェクトに残っている場合に備え、存在すれば解除しておく
-- (pg_cron拡張が無いプロジェクトでは何もしない)。
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'delete-expired-chat-messages') then
      perform cron.unschedule('delete-expired-chat-messages');
    end if;
  end if;
exception when others then
  raise notice 'delete-expired-chat-messagesジョブの解除に失敗しました(%)。', sqlerrm;
end $$;


-- ------------------------------------------------------------
-- 9f-3. chat_read_state / list_chat_threads / mark_chat_thread_read:
--   サイドバーの「チャット」タブ(相手ごとの最新メッセージ一覧、LINEの
--   トーク一覧のようなUI)用。未読数をログインセッションをまたいで
--   保持したいという要望のため、既読位置(last_read_at)を専用テーブルに
--   永続化する(以前はクライアント側のstateのみで管理しており、
--   ログインし直すと0にリセットされていた)。
-- ------------------------------------------------------------
create table if not exists public.chat_read_state (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  peer_user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (room_id, user_id, peer_user_id)
);

alter table public.chat_read_state enable row level security;

drop policy if exists "chat_read_state: select own" on public.chat_read_state;
create policy "chat_read_state: select own"
  on public.chat_read_state for select
  using (user_id = auth.uid());

drop policy if exists "chat_read_state: insert own" on public.chat_read_state;
create policy "chat_read_state: insert own"
  on public.chat_read_state for insert
  with check (user_id = auth.uid());

drop policy if exists "chat_read_state: update own" on public.chat_read_state;
create policy "chat_read_state: update own"
  on public.chat_read_state for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- スレッドを開いた際に既読位置を更新する(1対1)。
drop function if exists public.mark_chat_thread_read(uuid, uuid);
create function public.mark_chat_thread_read(p_room_id uuid, p_peer_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.chat_read_state (room_id, user_id, peer_user_id, last_read_at)
  values (p_room_id, auth.uid(), p_peer_user_id, now())
  on conflict (room_id, user_id, peer_user_id)
  do update set last_read_at = excluded.last_read_at;
$$;

revoke all on function public.mark_chat_thread_read(uuid, uuid) from public;
grant execute on function public.mark_chat_thread_read(uuid, uuid) to authenticated;


-- ------------------------------------------------------------
-- 9f-3b. chat_groups / chat_group_members / chat_group_read_state:
--   「チャット」タブのグループチャット機能用。1対1(chat_messages.
--   recipient_user_id)とは別に、chat_messages.group_idでグループ宛て
--   メッセージを表現する(recipient_user_id/group_idのどちらか一方だけが
--   埋まる)。既読管理は1対1(chat_read_state)とキーの形が異なる
--   (相手の代わりにグループID)ため、別テーブルに分けている。
-- ------------------------------------------------------------
create table if not exists public.chat_groups (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 任意のグループ名(未設定=nullの場合は参加者名から自動生成する)。
alter table public.chat_groups add column if not exists name text;

create table if not exists public.chat_group_members (
  group_id uuid not null references public.chat_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- chat_groupsのポリシーがchat_group_membersを参照するため、両方のテーブルを
-- 作成してからRLSを有効化・ポリシーを定義する(順序を逆にすると、まだ
-- 存在しないテーブルを参照してCREATE POLICY自体がエラーになる)。
alter table public.chat_groups enable row level security;

drop policy if exists "chat_groups: select member" on public.chat_groups;
create policy "chat_groups: select member"
  on public.chat_groups for select
  using (
    id in (select group_id from public.chat_group_members where user_id = auth.uid())
  );

alter table public.chat_group_members enable row level security;

-- 2026-08-30修正: 元々このポリシーはchat_group_members自身を再帰的に
-- サブクエリしていたため、Postgresが"infinite recursion detected in
-- policy for relation \"chat_group_members\""(42P17)を返すバグがあった。
-- chat_messagesのSELECT/INSERTポリシー(9f-3b以降)がグループ判定のために
-- chat_group_membersをサブクエリする作りになっているため、グループが
-- 一切関係ない1対1DMのクエリまで巻き添えで500エラーになっていた。
-- SECURITY DEFINER関数(RLSを経由せずテーブルの所有者権限で読む)経由に
-- することで自己参照の連鎖を断ち切る。
create or replace function public.is_chat_group_member(
  p_group_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.chat_group_members
    where group_id = p_group_id and user_id = p_user_id
  );
$$;

revoke all on function public.is_chat_group_member(uuid, uuid) from public;
grant execute on function public.is_chat_group_member(uuid, uuid) to authenticated;

drop policy if exists "chat_group_members: select same group" on public.chat_group_members;
create policy "chat_group_members: select same group"
  on public.chat_group_members for select
  using (
    public.is_chat_group_member(group_id, auth.uid())
  );

create table if not exists public.chat_group_read_state (
  group_id uuid not null references public.chat_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.chat_group_read_state enable row level security;

drop policy if exists "chat_group_read_state: select own" on public.chat_group_read_state;
create policy "chat_group_read_state: select own"
  on public.chat_group_read_state for select
  using (user_id = auth.uid());

drop policy if exists "chat_group_read_state: insert own" on public.chat_group_read_state;
create policy "chat_group_read_state: insert own"
  on public.chat_group_read_state for insert
  with check (user_id = auth.uid());

drop policy if exists "chat_group_read_state: update own" on public.chat_group_read_state;
create policy "chat_group_read_state: update own"
  on public.chat_group_read_state for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 既存のchat_messages(1対1専用だった)をグループメッセージにも使えるよう
-- 拡張する。recipient_user_id/group_idはどちらか一方だけが埋まる
-- (both null・both not nullは許可しない)。
alter table public.chat_messages add column if not exists group_id uuid references public.chat_groups(id) on delete cascade;
alter table public.chat_messages alter column recipient_user_id drop not null;

alter table public.chat_messages drop constraint if exists chat_messages_target_check;
alter table public.chat_messages add constraint chat_messages_target_check
  check (
    (recipient_user_id is not null and group_id is null)
    or (recipient_user_id is null and group_id is not null)
  );

create index if not exists chat_messages_group_id_created_at_idx
  on public.chat_messages (group_id, created_at);

-- 1対1のRLSに、グループ宛てメッセージの分岐を追加する(既存の1対1部分は
-- 条件を変えていない)。
drop policy if exists "chat_messages: select own dm" on public.chat_messages;
create policy "chat_messages: select own dm"
  on public.chat_messages for select
  using (
    (
      recipient_user_id is not null
      and (sender_user_id = auth.uid() or recipient_user_id = auth.uid())
      and room_id in (
        select r.id from public.rooms r
        join public.profiles p on p.account_id = r.account_id
        where p.user_id = auth.uid()
      )
    )
    or (
      group_id is not null
      and group_id in (
        select group_id from public.chat_group_members where user_id = auth.uid()
      )
    )
  );

drop policy if exists "chat_messages: insert own dm" on public.chat_messages;
create policy "chat_messages: insert own dm"
  on public.chat_messages for insert
  with check (
    sender_user_id = auth.uid()
    and char_length(message) <= 500
    and (
      image_path is null
      or image_path like (room_id::text || '/' || sender_user_id::text || '/%')
    )
    and (
      (
        recipient_user_id is not null
        and group_id is null
        and recipient_user_id <> auth.uid()
        and room_id in (
          select r.id from public.rooms r
          join public.profiles p on p.account_id = r.account_id
          where p.user_id = auth.uid()
        )
      )
      or (
        recipient_user_id is null
        and group_id is not null
        and group_id in (
          select group_id from public.chat_group_members where user_id = auth.uid()
        )
      )
    )
  );

-- グループ作成。グループ本体・メンバー行(自分含む)をまとめて作る
-- (メンバーをまとめて追加するには他人の行をINSERTする必要があり、単純な
-- RLSでは表現しづらいため、SECURITY DEFINERの関数を経由する。members一覧
-- の各ユーザーIDがそのルームに実在するかまでは検証しない。これは既存の
-- 1対1DM(insert own dmポリシー)が宛先の所属を検証していないのと同じ
-- 設計方針で、実際に読めるかどうかは常にSELECT側のRLSで担保される)。
drop function if exists public.create_chat_group(uuid, uuid[]);
create function public.create_chat_group(p_room_id uuid, p_member_user_ids uuid[])
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
    join public.profiles p on p.account_id = r.account_id
    where r.id = p_room_id and p.user_id = auth.uid()
  ) then
    raise exception 'このルームへのアクセス権がありません';
  end if;

  -- 重複作成防止: 自分を含めた選択メンバーの集合が完全一致する既存の
  -- グループがあれば、新規作成せずそのグループIDを返す(2026-08-30追加)。
  select array_agg(distinct m order by m) into v_target_members
  from unnest(array_append(p_member_user_ids, auth.uid())) as m;

  select g.id into v_group_id
  from public.chat_groups g
  where g.room_id = p_room_id
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
  values (p_room_id, auth.uid())
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

grant execute on function public.create_chat_group(uuid, uuid[]) to authenticated;

-- 2026-08-30追加: viewOnly(既に自分のアカウントを持つ人が他人の招待URLを
-- 一時閲覧中)向けのグループ作成。上のcreate_chat_group()はprofiles経由の
-- アカウント所属を必須にしているため、viewOnlyで呼ぶと「このルームへの
-- アクセス権がありません」で失敗していた。招待トークンの一致で認可する
-- 点以外はcreate_chat_group()と同じ。
drop function if exists public.create_chat_group_by_invite_token(text, uuid, uuid[]);
create function public.create_chat_group_by_invite_token(
  token text,
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
    where r.id = target_room_id and a.invite_token = token
  ) then
    raise exception 'このルームへのアクセス権がありません';
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

grant execute on function public.create_chat_group_by_invite_token(text, uuid, uuid[]) to authenticated;

-- スレッドを開いた際に既読位置を更新する(グループ)。
drop function if exists public.mark_chat_group_read(uuid);
create function public.mark_chat_group_read(p_group_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.chat_group_read_state (group_id, user_id, last_read_at)
  values (p_group_id, auth.uid(), now())
  on conflict (group_id, user_id)
  do update set last_read_at = excluded.last_read_at;
$$;

revoke all on function public.mark_chat_group_read(uuid) from public;
grant execute on function public.mark_chat_group_read(uuid) to authenticated;

-- グループ名の変更。メンバーなら誰でも変更できる(空文字を渡した場合は
-- nullに戻し、自動生成の名前に戻す)。
drop function if exists public.rename_chat_group(uuid, text);
create function public.rename_chat_group(p_group_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if not exists (
    select 1 from public.chat_group_members
    where group_id = p_group_id and user_id = auth.uid()
  ) then
    raise exception 'このグループのメンバーではありません';
  end if;
  update public.chat_groups
  set name = nullif(trim(p_name), '')
  where id = p_group_id;
end;
$$;

grant execute on function public.rename_chat_group(uuid, text) to authenticated;

-- グループの削除(メッセージ・メンバー・既読情報もon delete cascadeで
-- まとめて消える)。誤操作で全員分のグループが消えてしまわないよう、
-- 作成者のみに許可する。
drop function if exists public.delete_chat_group(uuid);
create function public.delete_chat_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  delete from public.chat_groups
  where id = p_group_id and created_by = auth.uid();
  if not found then
    raise exception 'このグループを削除する権限がありません';
  end if;
end;
$$;

grant execute on function public.delete_chat_group(uuid) to authenticated;

-- グループチャットからの退出(2026-08-30追加、2026-08-31に空グループの
-- 自動削除を追加)。UI上の「削除」機能は「退出」に置き換えた
-- (LINE/Teams等と同様、退出した本人の画面からは消えるが、グループ自体・
-- 他のメンバーの履歴には影響しない)。退出したことを他のメンバーに
-- 知らせるシステムメッセージ(is_system=true)を通常のグループメッセージ
-- として1件挿入してから、自分のchat_group_members行を削除する。以後は
-- SELECT側のRLS(group_id in (select ... where user_id=auth.uid()))上、
-- 自分はこのグループのメンバーではなくなるため、新着メッセージは一切
-- 見えなくなる(=退出後は通知が来ない)。会員判定のみでよく、アカウント
-- 所属を問わないため、viewOnly向けの別ルートは不要(create_chat_groupと
-- 異なりここではprofilesを見ない)。
--
-- 退出後に誰もメンバーがいなくなった場合、DBに残しても容量を圧迫する
-- だけのため、グループ本体(chat_groups)を削除する(on delete cascadeで
-- chat_messages/chat_group_read_stateもまとめて消える)。ただしSupabase
-- Storageの添付画像実体はSQLのDELETEだけでは消えない既知の制約がある
-- (get_expired_chat_message_idsと同じ理由)ため、削除直前に画像パスの
-- 一覧を集めてdeleted_image_pathsとして返し、呼び出し元(アプリ側の
-- service_role経由API)に実ファイルの削除を委ねる。
drop function if exists public.leave_chat_group(uuid);
create function public.leave_chat_group(p_group_id uuid)
returns table (
  id uuid,
  created_at timestamptz,
  message text,
  sender_name text,
  deleted_image_paths text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_name text;
  v_message text;
  v_id uuid;
  v_created_at timestamptz;
  v_remaining_members int;
  v_image_paths text[];
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if not exists (
    select 1 from public.chat_group_members
    where group_id = p_group_id and user_id = auth.uid()
  ) then
    raise exception 'このグループのメンバーではありません';
  end if;

  select g.room_id into v_room_id from public.chat_groups g where g.id = p_group_id;

  select coalesce(p.display_name, 'メンバー') into v_name
  from public.profiles p where p.user_id = auth.uid();

  v_message := v_name || 'が退出しました';

  insert into public.chat_messages
    (room_id, sender_user_id, sender_name, group_id, message, is_system)
  values
    (v_room_id, auth.uid(), v_name, p_group_id, v_message, true)
  returning chat_messages.id, chat_messages.created_at into v_id, v_created_at;

  delete from public.chat_group_members
  where group_id = p_group_id and user_id = auth.uid();

  select count(*) into v_remaining_members
  from public.chat_group_members
  where group_id = p_group_id;

  if v_remaining_members = 0 then
    select array_agg(m.image_path) into v_image_paths
    from public.chat_messages m
    where m.group_id = p_group_id and m.image_path is not null;

    -- 2026-09 QA指摘(不具合1): この関数はreturns table (id uuid, ...)の
    -- ため、id という名前のPL/pgSQL変数(戻り値列)が暗黙に存在する。
    -- 以前はここが「where id = p_group_id」と無修飾だったため、
    -- テーブル列chat_groups.idなのか関数の戻り値idなのかで
    -- "column reference \"id\" is ambiguous"(42702)エラーになり、
    -- 最後の1人が退出しようとすると必ず失敗していた(関数作成時からの
    -- 潜在バグ。この分岐は今回のQAで初めて実機で通されるまで未検出だった)。
    delete from public.chat_groups where chat_groups.id = p_group_id;
  end if;

  return query
    select v_id, v_created_at, v_message, v_name, coalesce(v_image_paths, array[]::text[]);
end;
$$;

revoke all on function public.leave_chat_group(uuid) from public;
grant execute on function public.leave_chat_group(uuid) to authenticated;

-- チャットタブの一覧表示用に、そのルームで自分がやり取りした相手・
-- 参加しているグループを、最終やり取り順にまとめて返す。1対1の表示名は
-- profiles.display_name(最新の表示名)を優先し、profilesが無い場合のみ
-- 送信時点のスナップショット(chat_messages.sender_name)にフォールバック
-- する(=改名して再入室した相手は自動的に最新の名前で表示される)。
-- グループの表示名は、自分以外のメンバーの表示名を「、」区切りで並べた
-- ものを自動生成する。profilesは本人以外SELECTできないRLSのため、
-- SECURITY DEFINERで読む。
-- (viewOnlyゲストのスレッドは対象外。viewOnlyは既存のlist_chat_messages_
-- by_invite_token経由の別ルートのみで、一覧化はスコープ外とする)
drop function if exists public.list_chat_threads(uuid);
create function public.list_chat_threads(p_room_id uuid)
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
  with allowed as (
    select 1
    from public.rooms r
    join public.profiles p on p.account_id = r.account_id
    where r.id = p_room_id and p.user_id = auth.uid()
  ),
  peers as (
    select distinct
      case when m.sender_user_id = auth.uid() then m.recipient_user_id else m.sender_user_id end as peer_id
    from public.chat_messages m
    where m.room_id = p_room_id
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
      on m.room_id = p_room_id
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
      on rs.room_id = p_room_id and rs.user_id = auth.uid() and rs.peer_user_id = m.sender_user_id
    where m.room_id = p_room_id
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
    where g.room_id = p_room_id
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
  select * from dm_rows
  union all
  select * from group_rows
  order by last_message_at desc;
$$;

revoke all on function public.list_chat_threads(uuid) from public;
grant execute on function public.list_chat_threads(uuid) to authenticated;

-- 2026-08-30追加: viewOnly(既に自分のアカウントを持つ人が他人の招待URLを
-- 一時閲覧中。profiles.account_idを書き換えない設計)向けのチャット一覧。
-- 上のlist_chat_threads()はprofiles.account_id経由でアカウント所属を
-- 確認するため、viewOnlyでは常に空を返してしまい、DM履歴・グループ
-- チャットのどちらも一切表示されない不具合になっていた。招待トークンの
-- 一致で認可する点以外はlist_chat_threads()と同じロジック(グループの
-- 判定はもともとchat_group_members.user_id=auth.uid()のみで行っており、
-- プロフィールのアカウント所属を問わないため、この部分は変更していない)。
drop function if exists public.list_chat_threads_by_invite_token(text, uuid);
create function public.list_chat_threads_by_invite_token(
  token text,
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
  with allowed as (
    select 1
    from public.rooms r
    join public.accounts a on a.id = r.account_id
    where r.id = target_room_id and a.invite_token = token
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
  select * from dm_rows
  union all
  select * from group_rows
  order by last_message_at desc;
$$;

revoke all on function public.list_chat_threads_by_invite_token(text, uuid) from public;
grant execute on function public.list_chat_threads_by_invite_token(text, uuid) to authenticated;


-- ------------------------------------------------------------
-- 9f-3c. chat_mentions: グループチャットの@メンション通知(2026-09-02
--   追加)。メッセージ送信時に、本文中の「@全員」または「@<メンバー表示名>」
--   を解析したクライアントが、create_chat_mentions()経由でこのテーブルに
--   1メンション対象者につき1行ずつ挿入する(「@全員」は送信者を除く
--   その時点の全メンバーへ展開して1行ずつ)。
--
--   INSERT用のRLSポリシーはあえて用意しない。「自分が送信したメッセージ
--   かどうか」「対象ユーザーが実際にそのグループのメンバーかどうか
--   (クライアントからのなりすまし防止)」の検証がRLSのusing/with checkだけ
--   では表現しづらいため、create_chat_mentions()というSECURITY DEFINER
--   関数を必ず経由させる(create_chat_groupと同じ考え方)。
--   SELECT/UPDATE(既読化)は、mentioned_user_id = auth.uid()の行に
--   限定する通常のRLSで足りる(viewOnlyゲストも含め、auth.uid()だけで
--   完結する判定のため9f-2のような特別対応は不要)。
-- ------------------------------------------------------------
create table if not exists public.chat_mentions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  group_id uuid not null references public.chat_groups(id) on delete cascade,
  mentioned_user_id uuid not null references auth.users(id) on delete cascade,
  mentioner_user_id uuid not null references auth.users(id) on delete cascade,
  mentioner_name text not null,
  is_everyone boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists chat_mentions_mentioned_user_id_created_at_idx
  on public.chat_mentions (mentioned_user_id, created_at desc);

alter table public.chat_mentions enable row level security;

drop policy if exists "chat_mentions: select own" on public.chat_mentions;
create policy "chat_mentions: select own"
  on public.chat_mentions for select
  using (mentioned_user_id = auth.uid());

drop policy if exists "chat_mentions: update own" on public.chat_mentions;
create policy "chat_mentions: update own"
  on public.chat_mentions for update
  using (mentioned_user_id = auth.uid())
  with check (mentioned_user_id = auth.uid());

-- グループメンバーの表示名一覧(@メンションのポップアップ候補用)。
-- profilesの通常SELECT RLSは本人の行しか許可していないため、同じ
-- グループのメンバー同士であれば表示名を見られるようこの関数経由にする。
drop function if exists public.list_chat_group_member_names(uuid);
create function public.list_chat_group_member_names(p_group_id uuid)
returns table (user_id uuid, display_name text)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_chat_group_member(p_group_id, auth.uid()) then
    raise exception 'このグループのメンバーではありません';
  end if;

  return query
    select gm.user_id, coalesce(p.display_name, p.email, 'ユーザー')
    from public.chat_group_members gm
    left join public.profiles p on p.user_id = gm.user_id
    where gm.group_id = p_group_id;
end;
$$;

grant execute on function public.list_chat_group_member_names(uuid) to authenticated;

-- メンション行の作成。p_mention_everyoneがtrueの場合はp_mentioned_user_ids
-- を無視し、その時点のグループメンバー全員(送信者本人を除く)へ展開する。
-- p_mention_everyoneがfalseの場合も、指定されたuser_idが実際にそのグループの
-- メンバーであることをここで検証してから挿入する(なりすまし・存在しない
-- ユーザーへのメンション作成を防ぐ)。
drop function if exists public.create_chat_mentions(uuid, uuid, text, boolean, uuid[]);
create function public.create_chat_mentions(
  p_message_id uuid,
  p_group_id uuid,
  p_mentioner_name text,
  p_mention_everyone boolean,
  p_mentioned_user_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;

  -- 対象メッセージが実在し、このグループ宛てで、かつ自分が送信した
  -- メッセージであることを検証する(他人が送ったメッセージに対して
  -- 勝手にメンション通知を作れないようにするため)。
  if not exists (
    select 1 from public.chat_messages m
    where m.id = p_message_id
      and m.group_id = p_group_id
      and m.sender_user_id = auth.uid()
  ) then
    raise exception 'このメッセージにはメンションを作成できません';
  end if;

  if p_mention_everyone then
    insert into public.chat_mentions
      (message_id, group_id, mentioned_user_id, mentioner_user_id, mentioner_name, is_everyone)
    select p_message_id, p_group_id, gm.user_id, auth.uid(), p_mentioner_name, true
    from public.chat_group_members gm
    where gm.group_id = p_group_id
      and gm.user_id <> auth.uid();
  else
    insert into public.chat_mentions
      (message_id, group_id, mentioned_user_id, mentioner_user_id, mentioner_name, is_everyone)
    select p_message_id, p_group_id, gm.user_id, auth.uid(), p_mentioner_name, false
    from public.chat_group_members gm
    where gm.group_id = p_group_id
      and gm.user_id <> auth.uid()
      and gm.user_id = any(p_mentioned_user_ids);
  end if;
end;
$$;

grant execute on function public.create_chat_mentions(uuid, uuid, text, boolean, uuid[]) to authenticated;

-- 通知一覧の「〇〇さんからメンションされました」の表示名を、送信時点の
-- スナップショット(chat_mentions.mentioner_name)ではなく最新のDB値から
-- 表示できるようにするための取得関数(2026-09報告: 表示名を変更しても
-- 過去の通知の表示が古いままだった)。profilesは本人しかSELECTできない
-- RLSのため、list_chat_group_member_namesと同じ考え方でSECURITY DEFINER
-- 経由にする。ただし対象はグループ全体ではなく「実際に自分にメンション
-- 通知を送ってきたことがある相手」に限定し、任意のユーザーの表示名を
-- 取得できてしまわないようにする。
drop function if exists public.list_mentioner_names(uuid[]);
create function public.list_mentioner_names(p_mentioner_user_ids uuid[])
returns table (user_id uuid, display_name text)
language sql
security definer
set search_path = public
stable
as $$
  select distinct p.user_id, coalesce(p.display_name, p.email, 'ユーザー')
  from public.profiles p
  where p.user_id = any(p_mentioner_user_ids)
    and exists (
      select 1 from public.chat_mentions cm
      where cm.mentioner_user_id = p.user_id
        and cm.mentioned_user_id = auth.uid()
    );
$$;

grant execute on function public.list_mentioner_names(uuid[]) to authenticated;


-- ------------------------------------------------------------
-- 9f-4. chat-images: チャットの画像添付機能用Storageバケット。
--   非公開バケット(public: false)。DMの内容は本来sender/recipient以外に
--   見えてはいけないため、template-imagesのような公開バケットにはしない。
--   読み取りは公開URL/RLSでのSELECTを一切許可せず、認可チェック付きの
--   署名付きURL発行エンドポイント(app/api/chat/image-url/route.ts、
--   Service Role経由)からのみ行う。
--
--   パスは常に2階層目が自分のuser_idになるよう統一している:
--     - アップロード直後の生画像: raw/{自分のuser_id}/{uuid}.{ext}
--     - サーバーで圧縮済みの最終画像: {room_id}/{自分のuser_id}/{uuid}.webp
--   そのためINSERT/DELETEどちらも
--   "(storage.foldername(name))[2] = auth.uid()::text" という1つの条件で
--   両パターンを共通にカバーできる。
--   最終画像への書き込みはRoute Handler(compress-image)がService Role経由で
--   行うためRLSをバイパスする(=INSERTポリシーはraw/向けのみで足りる)。
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-images', 'chat-images', false,
  15728640, -- 15MB (lib/types.tsのCHAT_IMAGE_MAX_BYTESと同じ値。アプリ側の
            -- バリデーションに加えて、Storage自体でも上限を強制する)
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "chat-images: insert own raw" on storage.objects;
create policy "chat-images: insert own raw"
  on storage.objects for insert
  with check (
    bucket_id = 'chat-images'
    and (storage.foldername(name))[1] = 'raw'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "chat-images: delete own" on storage.objects;
create policy "chat-images: delete own"
  on storage.objects for delete
  using (
    bucket_id = 'chat-images'
    and (storage.foldername(name))[2] = auth.uid()::text
  );


-- ------------------------------------------------------------
-- 9f-5. chat_message_reactions: トークへの固定絵文字リアクション
--   (👍 ❤️ 😂 😮 👏 の5種類のみ)。1人1トークにつき1リアクションまでを
--   (message_id, user_id)のunique制約でDBレベルでも保証する。別の絵文字を
--   選び直した場合は既存行をupsertで上書きする(アプリ側はon conflictの
--   upsert、またはviewOnly向けは下のSECURITY DEFINER関数内でon conflict
--   do updateする)。
--   配信はchat_messages(9f)と同じ考え方で、既存のavatar-room-{roomId}
--   broadcastチャンネルにhttpSend()でイベントを流して即時反映し、この
--   テーブルは「リロード後・再入室後も見える」ための永続化専用に使う。
-- ------------------------------------------------------------
create table if not exists public.chat_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

alter table public.chat_message_reactions drop constraint if exists chat_message_reactions_emoji_check;
alter table public.chat_message_reactions add constraint chat_message_reactions_emoji_check
  check (emoji in ('👍', '❤️', '😂', '😮', '👏'));

create index if not exists chat_message_reactions_message_id_idx
  on public.chat_message_reactions (message_id);

alter table public.chat_message_reactions enable row level security;

-- SELECT: 対象メッセージがRLS上SELECTできる(=そのDM/グループの参加者で
-- ある)場合のみリアクションも見える。chat_messagesの参加者判定
-- (1対1/グループ/viewOnly)を重複実装せず、既存のSELECTポリシーに
-- 判定を委譲する(chat_messagesへのサブクエリ自体がchat_messages側の
-- RLSに従うため、ここで改めて条件を書き下す必要が無い)。
drop policy if exists "chat_message_reactions: select thread participant" on public.chat_message_reactions;
create policy "chat_message_reactions: select thread participant"
  on public.chat_message_reactions for select
  using (
    exists (select 1 from public.chat_messages m where m.id = message_id)
  );

-- INSERT/UPDATE: 自分のuser_idとしてのみ、かつ対象メッセージが見える
-- 範囲でのみ追加・上書きできる(他人になりすましたリアクションや、
-- 本来見えないはずのメッセージへのリアクションを防ぐ)。upsert
-- (on conflict do update)はinsert時・conflict更新時の両方でそれぞれの
-- ポリシーが評価されるため、insert/updateどちらにも同じ条件を付ける。
drop policy if exists "chat_message_reactions: insert own" on public.chat_message_reactions;
create policy "chat_message_reactions: insert own"
  on public.chat_message_reactions for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.chat_messages m where m.id = message_id)
  );

drop policy if exists "chat_message_reactions: update own" on public.chat_message_reactions;
create policy "chat_message_reactions: update own"
  on public.chat_message_reactions for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.chat_messages m where m.id = message_id)
  );

-- DELETE: 自分が付けたリアクションの取り消し用(絵文字を選び直す際の
-- 内部的な削除、および将来的な「同じ絵文字を再タップで解除」用)。
drop policy if exists "chat_message_reactions: delete own" on public.chat_message_reactions;
create policy "chat_message_reactions: delete own"
  on public.chat_message_reactions for delete
  using (user_id = auth.uid());

-- viewOnly(招待URL経由の一時ゲスト)向け。1対1DMのRLSは
-- profiles.account_id経由のアカウント所属を要求するため、viewOnlyでは
-- 通常のSELECT/INSERT/UPDATEどちらも弾かれる(9f-2と同じ理由)。
-- edit_chat_message_by_invite_token / delete_chat_message_by_invite_token
-- と同じ考え方で、招待トークンがそのメッセージの所属ルーム(room_id→
-- account_id)と一致することをSECURITY DEFINER関数側で検証する。
-- (グループチャットはchat_group_membersに実際のメンバー行が入るため
-- 通常のRLSで済み、この関数を経由する必要はない。)
drop function if exists public.set_chat_message_reaction_by_invite_token(text, uuid, text);
create function public.set_chat_message_reaction_by_invite_token(
  token text,
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
  where a.invite_token = token
    and m.id = p_message_id;

  if v_room_id is null then
    raise exception 'このメッセージにはリアクションできません';
  end if;

  insert into public.chat_message_reactions (message_id, user_id, emoji)
  values (p_message_id, auth.uid(), p_emoji)
  on conflict (message_id, user_id)
  do update set emoji = excluded.emoji, created_at = now();
end;
$$;

grant execute on function public.set_chat_message_reaction_by_invite_token(text, uuid, text) to authenticated;

drop function if exists public.remove_chat_message_reaction_by_invite_token(text, uuid);
create function public.remove_chat_message_reaction_by_invite_token(
  token text,
  p_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;

  delete from public.chat_message_reactions r
  using public.chat_messages m,
        public.rooms rm,
        public.accounts a
  where r.message_id = m.id
    and rm.id = m.room_id
    and a.id = rm.account_id
    and a.invite_token = token
    and r.message_id = p_message_id
    and r.user_id = auth.uid();
end;
$$;

grant execute on function public.remove_chat_message_reaction_by_invite_token(text, uuid) to authenticated;

-- viewOnly向けのリアクション一覧取得。1対1DMのメッセージ一覧
-- (list_chat_messages_by_invite_token)取得後、そのメッセージID群を渡して
-- 呼ぶ想定(既存関数の戻り値形状を変えたくないため、別関数として分離)。
drop function if exists public.list_chat_message_reactions_by_invite_token(text, uuid[]);
create function public.list_chat_message_reactions_by_invite_token(
  token text,
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

  return query
    select r.message_id, r.user_id, r.emoji
    from public.chat_message_reactions r
    join public.chat_messages m on m.id = r.message_id
    join public.rooms rm on rm.id = m.room_id
    join public.accounts a on a.id = rm.account_id
    where a.invite_token = token
      and r.message_id = any(p_message_ids);
end;
$$;

grant execute on function public.list_chat_message_reactions_by_invite_token(text, uuid[]) to authenticated;


-- ------------------------------------------------------------
-- 9g. online_sessions: β版の「全顧客合計オンライン人数1000人で新規契約
--     停止」判定用。ユーザーごとに1行だけ持ち、バーチャル空間に入室中の
--     クライアントが30秒おきにlast_seen_atを更新する(心拍)。「オンライン」
--     の判定は行を消さず、90秒(心拍3回分)以内に更新があったかで見る
--     (退室直後の数十秒は多少カウントに残るが、βの上限判定としては
--     許容範囲とする)。
-- ------------------------------------------------------------
create table if not exists public.online_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

-- 多重ログイン(同一user_idでの複数タブ・複数デバイス)検知用
-- (2026-09追加。手順9)。ブラウザタブごとにクライアント側で生成する
-- ランダムな値(sessionStorageに保存。タブを閉じるまで同じ値が続く)。
-- 既存行にはまだ値が無い(null)ため、claim_session側で「以前のセッション
-- 情報が無い」として扱われ、この列追加直後に誤って誰かを強制ログアウト
-- させることはない。
alter table public.online_sessions
  add column if not exists session_token text;

alter table public.online_sessions enable row level security;

drop policy if exists "online_sessions: upsert own" on public.online_sessions;
create policy "online_sessions: upsert own"
  on public.online_sessions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 全体のオンライン人数を数えるだけの関数。online_sessionsへのSELECT権限を
-- 全ユーザーに開放すると他人のuser_id一覧が見えてしまうため、件数だけを
-- 返すSECURITY DEFINER関数経由にする。
drop function if exists public.get_online_session_count();

create function public.get_online_session_count()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer from public.online_sessions
  where last_seen_at > now() - interval '90 seconds';
$$;

grant execute on function public.get_online_session_count() to authenticated;

-- 多重ログイン検知(2026-09追加。手順9)。バーチャル空間・管理画面・
-- マスター画面のいずれかを開いた時点で、クライアントが自分の
-- session_token(タブごとのランダム値)を渡してこの関数を呼ぶ。
-- 「このuser_idに既に別のsession_tokenが記録されていた」場合、その
-- 古いsession_tokenを返す。呼び出し元(lib/useSessionGuard.ts)は、
-- 戻り値が非nullであれば、その古いsession_tokenを対象にSupabase
-- Realtimeのuser-session-{userId}チャンネルへ強制ログアウトの
-- 通知を配信する(=後からログインした方を優先し、既存セッションを
-- 強制的に切断する)。
drop function if exists public.claim_session(text);

create function public.claim_session(p_session_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous_token text;
begin
  if auth.uid() is null then
    return null;
  end if;

  select session_token into v_previous_token
  from public.online_sessions
  where user_id = auth.uid();

  insert into public.online_sessions (user_id, session_token, last_seen_at)
  values (auth.uid(), p_session_token, now())
  on conflict (user_id) do update
    set session_token = excluded.session_token,
        last_seen_at = excluded.last_seen_at;

  if v_previous_token is not null and v_previous_token <> p_session_token then
    return v_previous_token;
  end if;
  return null;
end;
$$;

grant execute on function public.claim_session(text) to authenticated;

-- 契約(アカウント)作成時に、どの物理LiveKitサーバーへ割り当てるかを
-- ラウンドロビンで決めるための集計関数。individual accountの中身は返さず
-- livekit_server_idごとの件数のみを返すため、認証済みユーザー全員に実行を
-- 許可してよい(RLSの「accounts: select own」では他アカウントの件数すら
-- 見えないため、新規契約時点ではこの関数経由でしか集計できない)。
drop function if exists public.count_accounts_by_livekit_server();

create function public.count_accounts_by_livekit_server()
returns table (livekit_server_id text, account_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select livekit_server_id, count(*) as account_count
  from public.accounts
  where livekit_server_id is not null
  group by livekit_server_id;
$$;

grant execute on function public.count_accounts_by_livekit_server() to authenticated;


-- ------------------------------------------------------------
-- 10. (廃止) 以前はここでマスター権限アカウントの契約プランを強制的に
--     'master'へ揃えていたが、マスタープランは廃止した。既存行の移行と
--     CHECK制約からの'master'除外は、上の「1. accounts」内で一度きり
--     実施済み。マスター権限アカウントも今後は通常の4プランのいずれかを
--     持ち、DEBUG_PLAN_SWITCH_EMAILの仕組みで自由に切り替える
--     (マスター画面へのアクセス権はis_masterフラグで別途管理しており、
--     プランとは無関係のため、この節の削除による影響はない)。
-- ------------------------------------------------------------


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
      values ('Grovina Office', 'free', v_user_id)
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
      values ('Grovina Studio', 'free', v_user_id)
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

-- ------------------------------------------------------------
-- 15. banned_participants: 管理画面ダッシュボードの「強制退出」で
--     BANされた参加者を、管理者が「解除」するまでそのアカウントの
--     ルームへ再入室できないようにするためのリスト。
-- ------------------------------------------------------------
create table if not exists public.banned_participants (
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  banned_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

alter table public.banned_participants enable row level security;

-- 本人は自分がBANされているか(ルーム入室時のガードに使う)、
-- 管理者は自分のアカウント分のBAN一覧を閲覧できる。
drop policy if exists "banned_participants: select" on public.banned_participants;
create policy "banned_participants: select"
  on public.banned_participants for select
  using (
    auth.uid() = user_id
    or account_id in (
      select id from public.accounts where owner_user_id = auth.uid()
    )
  );

-- 追加・削除(強制退出・解除)は自分がオーナーのアカウント分のみ。
drop policy if exists "banned_participants: modify own account as owner" on public.banned_participants;
create policy "banned_participants: modify own account as owner"
  on public.banned_participants for all
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

-- BAN一覧を表示名付きで取得する関数。profilesは本人しかSELECTできない
-- RLS("profiles: select own")のため、管理者が他人のdisplay_nameを
-- 見るにはSECURITY DEFINER経由が必要。
drop function if exists public.list_banned_participants(uuid);

create function public.list_banned_participants(p_account_id uuid)
returns table (
  user_id uuid,
  display_name text,
  banned_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.accounts
    where id = p_account_id and owner_user_id = auth.uid()
  ) then
    raise exception '権限がありません';
  end if;

  return query
    select b.user_id, p.display_name, b.banned_at
    from public.banned_participants b
    left join public.profiles p on p.user_id = b.user_id
    where b.account_id = p_account_id
    order by b.banned_at desc;
end;
$$;

grant execute on function public.list_banned_participants(uuid) to authenticated;


-- ------------------------------------------------------------
-- 16. 権限昇格防止トリガー
--     2026-09-01: このファイル内でセクション11-13(管理者アカウントの
--     role='admin'付与等)がこのセクションより前で実行されるため、この
--     位置に定義があると「トリガーがまだ存在しない古い状態」でそれらの
--     INSERT/UPDATEが走ってしまう(=前回実行時点の古いトリガー定義が
--     DBに残っていればそちらが適用され、今回のファイル内での修正が
--     一切反映されないまま失敗する)不具合があった。関数・両トリガーの
--     定義自体は、保護対象のprofiles/accountsテーブル作成直後
--     (「1b」「2a」)に移動済み。このセクション番号は欠番として残す。
-- ------------------------------------------------------------


-- ------------------------------------------------------------
-- 17. login_lockouts: 通常ログイン(メール/パスワード)の総当たり対策。
--     メールアドレス単位・IPアドレス単位それぞれで、直近15分以内に
--     10回失敗したら15分間ロックする(しきい値・時間は
--     components/auth/actions.tsのMAX_ATTEMPTS/LOCK_WINDOW_MSと
--     揃えること)。クライアントからは一切アクセスさせず(RLS有効・
--     ポリシーなし)、Server Action内のservice_roleクライアントからのみ
--     読み書きする。
--
--     これはうちのログイン画面を経由した総当たりへの対策であり、
--     anonキーでSupabaseの認証APIを直接叩く攻撃までは防げない
--     (そちらはSupabase Auth基盤側のレート制限が本質的な防波堤)。
-- ------------------------------------------------------------
create table if not exists public.login_lockouts (
  id text primary key, -- 'email:<lowercased email>' または 'ip:<ip>'
  failed_count integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.login_lockouts enable row level security;
-- 直接のSELECT/INSERT/UPDATE/DELETEポリシーは用意しない
-- (service_role以外は一切アクセスできない)。


-- ============================================================
-- 完了。もう一度実行しても壊れないので、迷ったらこのファイルだけ
-- 実行し直せば現在の機能に必要な状態に揃います。
-- ============================================================
