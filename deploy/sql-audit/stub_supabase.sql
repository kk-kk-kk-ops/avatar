-- Supabaseの前提スキーマ(auth/storage、および認証ロール)を模擬する
-- 最小スタブ。consolidated_setup.sqlを素のPostgres上で構文・整合性検証
-- するためだけに使う(実運用では一切実行しない)。
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);
create or replace function auth.uid() returns uuid
language sql stable as $$ select null::uuid $$;
-- 実際のSupabaseはリクエストのJWTから'anon'/'authenticated'/'service_role'を
-- 返す。既定値はanon('' the safest default)にしておき、権限昇格防止
-- トリガーのテスト時だけcreate or replaceで一時的に差し替える。
create or replace function auth.role() returns text
language sql stable as $$ select 'anon'::text $$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
