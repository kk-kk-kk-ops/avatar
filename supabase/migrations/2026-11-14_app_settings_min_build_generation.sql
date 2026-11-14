-- 段階0(docs/realtime-authorization-plan.md 6-2節)の「必須更新」判定に使う
-- 世代番号のしきい値。この値より小さいBUILD_GENERATIONのクライアントだけを
-- 強制再読み込みの対象にする。デフォルト0=誰も強制されない。
--
-- 適用はこのSQLを先に反映し、その後にBUILD_GENERATIONを参照するコードを
-- デプロイすること(逆順だと、列が無い間メンテナンス確認の問い合わせが
-- 失敗し、メンテナンス検知も一時停止する。設計書6-2節参照)。
begin;

alter table public.app_settings
  add column if not exists min_build_generation integer not null default 0;

commit;
