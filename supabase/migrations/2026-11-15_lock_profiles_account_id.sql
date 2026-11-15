-- profiles.account_idを、既存のrole/is_masterと同じ扱いで権限昇格防止
-- トリガー(prevent_privileged_column_self_write())の保護対象に追加する。
--
-- 背景: 利用者のログインセッションクライアントから、自分のprofiles行の
-- account_idを直接UPDATE/INSERTで任意の実在アカウントのIDに書き換えられる
-- ことが判明した(2026-11-15調査)。account_idはRLS(rooms: select own
-- account、accounts: select own等)や app/api/livekit-token・
-- app/api/indigo-tokenの認可判定の根拠になっているため、書き換えられると
-- 他アカウントのルーム・チャット・LiveKit通話・位置同期への侵入や、
-- 他アカウントのaccounts行(招待トークン・Stripe顧客情報等)の閲覧が
-- 可能になってしまう。
--
-- 正規のアプリ機能でprofiles.account_idを書き込んでいるのは以下の2箇所のみで、
-- いずれもcreateServiceRoleClient()(service_role)経由であることを確認済み
-- (2026-11-15調査)。このため、本トリガー拡張は正規の機能を一切壊さない。
--   - lib/accountProvisioning.ts:91-94(新規アカウント作成時)
--   - lib/joinAccountViaInvite.ts:73-76(招待URL経由のゲスト参加時)
--
-- accounts分岐(plan/trial_ends_at/trial_usedの保護)は本番の現在の定義から
-- 変更しない。
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
