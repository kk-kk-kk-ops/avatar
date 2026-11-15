-- 2026-11-15_lock_profiles_account_id.sql の戻しSQL。
-- prevent_privileged_column_self_write()を、account_idの保護を追加する前の
-- 本番の定義(2026-11-15時点でユーザーが共有した本番の全文と同一)に戻す。
begin;

create or replace function public.prevent_privileged_column_self_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.role() = 'service_role'
     or current_setting('is_superuser', true) = 'on'
     or auth.role() is null then
    return new;
  end if;

  if tg_table_name = 'profiles' then
    if tg_op = 'INSERT' then
      if new.role is not null or new.is_master is true then
        raise exception 'role/is_masterはこの経路からは設定できません';
      end if;
    elsif tg_op = 'UPDATE' then
      if new.role is distinct from old.role
         or new.is_master is distinct from old.is_master then
        raise exception 'role/is_masterはこの経路からは変更できません';
      end if;
    end if;
  elsif tg_table_name = 'accounts' then
    if tg_op = 'INSERT' then
      if new.plan is distinct from 'free' then
        raise exception '新規契約はfreeプランでのみ作成できます';
      end if;
      -- 30日間無料トライアル(2026-09追加)のtrial_ends_at/trial_usedも、
      -- plan列と同じ理由でこの経路からの設定を禁止する。ここを保護しないと、
      -- ログイン済みユーザーがPostgREST経由でtrial_ends_atを自由な未来の
      -- 日付に書き換え、Cron(app/api/cron/expire-trials)によるダウン
      -- グレードを無期限に回避できてしまう。
      if new.trial_ends_at is not null or new.trial_used is true then
        raise exception 'trial_ends_at/trial_usedはこの経路からは設定できません';
      end if;
    elsif tg_op = 'UPDATE' then
      if new.plan is distinct from old.plan then
        raise exception 'planはこの経路からは変更できません';
      end if;
      if new.trial_ends_at is distinct from old.trial_ends_at
         or new.trial_used is distinct from old.trial_used then
        raise exception 'trial_ends_at/trial_usedはこの経路からは変更できません';
      end if;
    end if;
  end if;

  return new;
end;
$$;

commit;
