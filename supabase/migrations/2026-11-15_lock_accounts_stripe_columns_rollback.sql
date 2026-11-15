-- 2026-11-15_lock_accounts_stripe_columns.sql の戻しSQL。
-- 戻し先は「現在の本番の定義」、つまり2026-11-15_lock_profiles_account_id.sql
-- 適用後の定義(profiles.account_idの保護を含み、accounts分岐へのstripe_
-- customer_id/stripe_subscription_id/livekit_server_idの保護は含まない)。
-- 2026-11-15_lock_profiles_account_id_rollback.sql(account_idの保護が無い、
-- さらに前の本番の定義)とは異なるので混同しないこと。
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
      -- account_idも本人による自己書き換えを禁止する(2026-11-15追加)。
      -- 利用者のログインセッションクライアントから他アカウントのIDに
      -- 書き換えられると、rooms/accounts等のRLSやlivekit-token・
      -- indigo-tokenの認可判定を正規に通過してしまい、他アカウントの
      -- ルーム・チャット・LiveKit通話・位置同期への侵入や、他アカウントの
      -- accounts行(招待トークン・Stripe顧客情報等)の閲覧が可能になる
      -- 欠陥が見つかったため。正規の書き込み経路(lib/accountProvisioning.ts・
      -- lib/joinAccountViaInvite.ts)はいずれもservice_role経由のため、
      -- この保護による機能への影響はない。
      if new.account_id is not null then
        raise exception 'account_idはこの経路からは設定できません';
      end if;
    elsif tg_op = 'UPDATE' then
      if new.role is distinct from old.role
         or new.is_master is distinct from old.is_master then
        raise exception 'role/is_masterはこの経路からは変更できません';
      end if;
      if new.account_id is distinct from old.account_id then
        raise exception 'account_idはこの経路からは変更できません';
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
