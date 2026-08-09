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

-- plan列のCHECK制約。マスタープランは廃止したため、既存にplan='master'の
-- 行が残っていれば先に'free'へ移行してから(そうしないと制約違反になる)、
-- 'master'を含まない制約を作り直す。マスター権限アカウントは今後、
-- 通常の5プランのいずれかを持ち、DEBUG_PLAN_SWITCH_EMAILの仕組みで
-- 自由に切り替える(マスター画面へのアクセス権はis_masterフラグで別途
-- 管理しており、これとは無関係)。
update public.accounts set plan = 'free' where plan = 'master';

alter table public.accounts drop constraint if exists accounts_plan_check;
alter table public.accounts add constraint accounts_plan_check
  check (plan in ('free', 'light', 'standard', 'pro', 'business'));

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
--     kind('screen_share' | 'video_call')を持つ1つのテーブル・1組の
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
  check (kind in ('screen_share', 'video_call'));

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
  if p_kind not in ('screen_share', 'video_call') then
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
-- 残す)。既存の「投稿から1ヶ月で自動削除」のcronはそのまま生きているため、
-- 削除済み行もそのサイクルでいずれ物理削除される。
alter table public.chat_messages add column if not exists edited_at timestamptz;
alter table public.chat_messages add column if not exists deleted_at timestamptz;

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
  deleted_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select m.id, m.sender_user_id, m.sender_name, m.message, m.created_at,
    m.edited_at, m.deleted_at
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

-- 引数を追加(recipient_user_id)して関数シグネチャが変わったため、
-- 旧シグネチャ・新シグネチャの両方をdropしてから作り直す。
drop function if exists public.send_chat_message_by_invite_token(text, uuid, text, text);
drop function if exists public.send_chat_message_by_invite_token(text, uuid, uuid, text, text);

create function public.send_chat_message_by_invite_token(
  token text,
  target_room_id uuid,
  recipient_user_id uuid,
  sender_name text,
  message text
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
  if char_length(message) = 0 or char_length(message) > 500 then
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

  return query
    insert into public.chat_messages
      (room_id, sender_user_id, recipient_user_id, sender_name, message)
    values (v_room_id, auth.uid(), recipient_user_id, sender_name, message)
    returning chat_messages.id, chat_messages.created_at;
end;
$$;

grant execute on function public.send_chat_message_by_invite_token(text, uuid, uuid, text, text) to authenticated;

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
--   ・投稿から1ヶ月経過したメッセージは自動削除する(pg_cronで毎日実行)
--   ・ルーム自体が削除された場合は、chat_messages.room_idの
--     "on delete cascade"により1ヶ月を待たず即座に削除される
--     (上のcreate table定義で対応済み。追加対応不要)
--   画像添付機能は現時点で未実装(chat_messagesはmessage列のみ)のため、
--   画像の削除ルールはテキストと同じ仕組みが必要になった時点で
--   (Supabase Storageのオブジェクト削除を絡めて)別途実装する。
--
-- pg_cronの有効化・スケジュール登録は失敗してもこのブロック内で
-- 握りつぶし、後続のセクション(10以降の管理者付与処理など)が
-- 巻き込まれてロールバックされないようにする(Supabase SQL Editorは
-- 既定でスクリプト全体を1トランザクションとして実行するため、途中の
-- 1文の失敗でそれ以前・以降の変更も含め全てロールバックされてしまう)。
-- pg_cronの権限が無いプロジェクトでは、RAISE NOTICEの案内に従って
-- Database → Extensions で「pg_cron」を有効化してから再実行すること。
drop function if exists public.delete_expired_chat_messages();

create function public.delete_expired_chat_messages()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.chat_messages
  where created_at < now() - interval '1 month';
$$;

do $$
begin
  execute 'create extension if not exists pg_cron';
exception when others then
  raise notice 'pg_cron拡張の有効化に失敗しました(%)。Database → Extensions で手動有効化した後にこのSQLを再実行してください。チャット履歴の自動削除は登録されていません。', sqlerrm;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'delete-expired-chat-messages') then
      perform cron.unschedule('delete-expired-chat-messages');
    end if;
    perform cron.schedule(
      'delete-expired-chat-messages',
      '0 4 * * *',
      'select public.delete_expired_chat_messages();'
    );
  end if;
exception when others then
  raise notice 'delete-expired-chat-messagesジョブの登録に失敗しました(%)。', sqlerrm;
end $$;


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


-- ------------------------------------------------------------
-- 10. (廃止) 以前はここでマスター権限アカウントの契約プランを強制的に
--     'master'へ揃えていたが、マスタープランは廃止した。既存行の移行と
--     CHECK制約からの'master'除外は、上の「1. accounts」内で一度きり
--     実施済み。マスター権限アカウントも今後は通常の5プランのいずれかを
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

-- ============================================================
-- 完了。もう一度実行しても壊れないので、迷ったらこのファイルだけ
-- 実行し直せば現在の機能に必要な状態に揃います。
-- ============================================================
