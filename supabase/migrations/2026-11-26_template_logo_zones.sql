-- ②-1 ロゴ区画(テンプレート側)。
--
-- 目的: マスター画面のテンプレート編集画面に「ロゴ区画」機能を追加する
-- ための準備として、templatesテーブルに区画の一覧(logo_zones)と、
-- テンプレート標準のロゴ画像のURL(default_logo_image_url)の列を足す。
-- このSQLでは列を足すだけで、画面側の実装は含まない(次回の指示で行う)。
--
-- 適用方法: Supabase の SQL Editor から、このファイルの内容をそのまま
-- 直接実行する。
--
-- RLSの変更は不要: supabase/consolidated_setup.sqlのtemplatesテーブルの
-- ポリシーのうち、select("templates: select authenticated")は
-- auth.uid() is not nullのみで列を限定しておらず、modify
-- ("templates: modify master")もpublic.is_master(auth.uid())のみで
-- 列を限定していない。そのため新しい列を足しても、既存のポリシーの
-- ままでメンバーも読め、マスターだけが書き込める。
--
-- ほかのファイルとの関係:
-- - 元に戻す場合は、同じフォルダの
--   2026-11-26_template_logo_zones_rollback.sql を実行する。

begin;

alter table public.templates
  add column if not exists logo_zones jsonb not null default '[]'::jsonb;
alter table public.templates
  add column if not exists default_logo_image_url text;

-- 事後の確認: 2つの列が存在するかを確かめる。1つでも無ければ取り消す。
do $$
declare
  v_errors text := '';
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'templates'
      and column_name = 'logo_zones'
  ) then
    v_errors := v_errors || '; logo_zones 列が無い';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'templates'
      and column_name = 'default_logo_image_url'
  ) then
    v_errors := v_errors || '; default_logo_image_url 列が無い';
  end if;

  if v_errors <> '' then
    raise exception '②-1 ロゴ区画の列追加: 事後確認に失敗しました%。取り消します。', v_errors;
  end if;
end $$;

commit;
