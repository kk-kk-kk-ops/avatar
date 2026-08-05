-- マスター権限を持つユーザーが所有するアカウントの契約プランを、
-- プロプランではなく専用の「マスター」プラン(ルーム数10・人数上限30名、
-- 課金対象外)にする。
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- master_and_templates.sql(is_master列の追加)を先に実行しておくこと。
-- 何度実行しても同じ結果になる(冪等)。
--
-- 注:マスタープランは通常のプラン選択画面(/plan)には出さないという
-- アプリ側の制約と対になっている(app側のPLAN_ORDER定数に'master'を
-- 加えないことで担保している)。

-- accounts.planのCHECK制約に'master'を追加する
alter table public.accounts drop constraint if exists accounts_plan_check;
alter table public.accounts add constraint accounts_plan_check
  check (plan in ('free', 'light', 'standard', 'pro', 'master'));

-- マスター権限を持つユーザーが所有する既存アカウントのプランを更新する。
-- 新たにマスター権限を付与したユーザーがいる場合も、このUPDATEを
-- 再実行すればそのアカウントのプランがmasterに揃う。
update public.accounts
set plan = 'master'
where owner_user_id in (
  select user_id from public.profiles where is_master = true
)
and plan <> 'master';
