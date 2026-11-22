-- 2026-11-22_realtime_view_grants.sql の戻しSQL。
-- 段階3(2026-11-22_realtime_authorization_policies.sql)を適用している場合は、
-- 必ず先に段階3の戻しSQLを実行すること(段階3の関数がこのテーブルを使っているため)。

drop function if exists public.grant_realtime_view_access(text);
drop table if exists public.realtime_view_grants;
