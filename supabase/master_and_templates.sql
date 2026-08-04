-- マスター権限とテンプレート機能の追加。
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- 実行順序:これまでのSQL(accounts〜map_layout_room)がすべて完了して
-- いること。このファイルは最後に実行する。

-- profiles: マスター権限フラグ。account_id/roleとは独立した「プラットフォーム
-- 全体を横断して見られるか」の権限で、既存のadmin/guestとは別軸にしている
-- (k.one.for.all.k@gmail.comのように、自分のアカウントのadminでありつつ
-- マスターでもある、という状態を許すため)。
alter table public.profiles
  add column if not exists is_master boolean not null default false;

-- is_masterの判定はSECURITY DEFINER関数を介して行う。ポリシー内で直接
-- 「exists (select 1 from profiles where ...)」のようにprofilesテーブルを
-- 素朴にサブクエリすると、そのサブクエリ自体がprofilesのSELECTポリシー
-- (このあと作るprofiles: select masterを含む)を再評価しようとして無限に
-- 再帰してしまう(Postgresエラー42P17 infinite recursion detected in
-- policy for relation "profiles")。関数はテーブル所有者の権限で実行され
-- RLSを経由しないため、この再帰を避けられる。
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

-- テンプレート(部屋のひな形)。背景画像・障害物・ミーティングエリアの配置を
-- マスターだけが編集できる。個々のルームは自分でレイアウトを持たず、常に
-- 紐づくtemplateのレイアウトを参照する(マップ編集は撤去し、マスターの
-- テンプレート編集だけに一本化するため)。
create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  background_image_url text not null,
  obstacles jsonb not null default '[]'::jsonb,
  meeting_area jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.templates enable row level security;

-- ログイン済みなら誰でも閲覧可能(ルーム作成時のテンプレート選択、
-- ルームのマップ表示に使うため)
drop policy if exists "templates: select authenticated" on public.templates;
create policy "templates: select authenticated"
  on public.templates for select
  using (auth.uid() is not null);

-- 追加・変更・削除はマスターのみ
drop policy if exists "templates: modify master" on public.templates;
create policy "templates: modify master"
  on public.templates for all
  using (public.is_master(auth.uid()))
  with check (public.is_master(auth.uid()));

-- rooms: どのテンプレートを使っているか
alter table public.rooms
  add column if not exists template_id uuid references public.templates(id);

-- Storage: テンプレートの背景画像アップロード用バケット
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

-- マスターはダッシュボードの集計のため、プラットフォーム全体の
-- profiles/accounts/roomsを横断して閲覧できる必要がある。既存の
-- 「本人の行だけ」ポリシーは残したまま、マスター用のSELECTポリシーを
-- 追加する(同じコマンドの複数のpermissiveポリシーはORで結合される)。
drop policy if exists "profiles: select master" on public.profiles;
create policy "profiles: select master"
  on public.profiles for select
  using (public.is_master(auth.uid()));

drop policy if exists "accounts: select master" on public.accounts;
create policy "accounts: select master"
  on public.accounts for select
  using (public.is_master(auth.uid()));

drop policy if exists "rooms: select master" on public.rooms;
create policy "rooms: select master"
  on public.rooms for select
  using (public.is_master(auth.uid()));

-- k.one.for.all.k@gmail.com には即座にマスター権限を付与する
-- (info@grovina-studio.comは初回ログイン時にアプリ側のコードで自動付与される)
update public.profiles
set is_master = true
where user_id in (
  select id from auth.users where email = 'k.one.for.all.k@gmail.com'
);
