-- ②-1 ロゴ区画(2026-11-26_template_logo_zones.sql)を元に戻すSQL。
--
-- templatesテーブルに足したlogo_zones・default_logo_image_urlの2つの列を
-- 削除する。
--
-- 注意: ロゴ区画の画面側のコード(マスター画面の編集UI・会議室側の表示)を
-- 本番に出した後にこのSQLを実行すると、その時点でまだ存在しない列を
-- 読み書きしようとして会議室の読み込みが失敗する。このSQLを実行する前に、
-- 必ず画面側のコードを先に元に戻しておくこと。
--
-- 適用方法: Supabase の SQL Editor から、このファイルの内容をそのまま
-- 直接実行する。
--
-- ほかのファイルとの関係:
-- - 元に戻す対象の本体は、同じフォルダの
--   2026-11-26_template_logo_zones.sql。

begin;

alter table public.templates
  drop column if exists logo_zones;
alter table public.templates
  drop column if exists default_logo_image_url;

commit;
