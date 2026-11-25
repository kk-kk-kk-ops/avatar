-- 段階F(2026-11-25_stage_f_legacy_guest_migration.sql)を元に戻すSQL。
--
-- stage_f_legacy_guest_backup(控えの表)から profiles.account_id / role
-- を元に戻し、段階Fが新しく作った account_members の行だけを消す
-- (段階Fを実行する前から既にあった行は消さない。
-- member_row_preexisted で判定する)。
--
-- 適用方法: Supabase の SQL Editor から、このファイルの内容をそのまま
-- 直接実行する(理由は段階F本体のSQLのコメントと同じ)。
--
-- 注意: この元に戻すSQLの最後で stage_f_legacy_guest_backup テーブル自体を
-- 削除する。もう一度段階Fを試す場合は、控えが無い状態から作り直される。
-- 控えを消さずに残したい場合は、最後のdrop table文を実行前に取り除くこと
-- (その場合、次に段階Fを再実行してもinsertはon conflict (user_id) do
-- nothingで何もしないため、古い控えが残ったままになる点に注意)。

begin;

-- 1. profiles.account_id / role を控えから元に戻す。
update public.profiles p
set account_id = b.account_id, role = b.role
from public.stage_f_legacy_guest_backup b
where p.user_id = b.user_id;

-- 2. 段階Fが新しく作った account_members の行だけを消す
--    (member_row_preexisted = false の組だけ)。
delete from public.account_members m
using public.stage_f_legacy_guest_backup b
where m.user_id = b.user_id
  and m.account_id = b.account_id
  and b.member_row_preexisted = false;

-- 3. 件数確認: 控えの件数と、profilesを元に戻せた件数が一致することを
--    確かめる。一致しなければ例外を発生させ、トランザクション全体を
--    取り消す(控えの表はdropされない)。
do $$
declare
  v_backup_count bigint;
  v_restored_count bigint;
begin
  select count(*) into v_backup_count from public.stage_f_legacy_guest_backup;

  select count(*) into v_restored_count
  from public.profiles p
  join public.stage_f_legacy_guest_backup b on b.user_id = p.user_id
  where p.account_id = b.account_id and p.role = b.role;

  if v_backup_count <> v_restored_count then
    raise exception
      '段階Fの取り消し: 控え件数(%)とprofilesを元に戻せた件数(%)が一致しません。取り消します。',
      v_backup_count, v_restored_count;
  end if;

  raise notice '段階Fの取り消し: % 件のprofilesを元に戻し、段階Fが作ったaccount_membersの行を削除しました。', v_backup_count;
end $$;

-- 4. 控えの表自体を削除する(上の注意書き参照)。
drop table if exists public.stage_f_legacy_guest_backup;

commit;
