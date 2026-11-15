-- 2026-11-15_add_get_own_account_guest_info.sql の戻しSQL。
-- 関数自体を削除する(この関数を呼ぶコードが残っている間はロールバック
-- しないこと)。
begin;

drop function if exists public.get_own_account_guest_info();

commit;
