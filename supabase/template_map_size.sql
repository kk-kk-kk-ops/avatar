-- テンプレートごとにマップの広さ(px)を変更できるようにする。
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- master_and_templates.sqlを先に実行しておくこと。
-- 既存テンプレートは従来の1900x1900のままになるようデフォルト値を設定する。

alter table public.templates
  add column if not exists map_width integer not null default 1900;
alter table public.templates
  add column if not exists map_height integer not null default 1900;
