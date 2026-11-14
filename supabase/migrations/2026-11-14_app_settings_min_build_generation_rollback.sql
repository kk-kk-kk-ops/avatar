-- 2026-11-14_app_settings_min_build_generation.sql の戻しSQL。
--
-- 切り戻し時は、まずmin_build_generation列を参照するコードを前の版へ戻し、
-- その後にこのSQLを適用すること(逆順だと、コードがまだ列を参照している間に
-- 列が消え、メンテナンス確認の問い合わせが失敗してメンテナンス検知が
-- 一時停止する。設計書6-2節参照)。
begin;

alter table public.app_settings
  drop column if exists min_build_generation;

commit;
