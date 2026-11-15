-- accounts.stripe_customer_id/stripe_subscription_id/livekit_server_idを、
-- 利用者のログインセッションクライアントからの書き換えから保護する
-- (段階2)。
--
-- 背景: これらの列には、既存のprevent_privileged_column_self_write()では
-- 何の制限も無く(保護対象はplan/trial_ends_at/trial_usedのみ)、ログイン
-- 済みユーザーがPostgREST経由で自分のaccounts行のstripe_customer_id/
-- stripe_subscription_idを他アカウントの実在する値に書き換えられた
-- (2026-11-14調査)。段階1(app/billing/checkout/actions.ts・
-- app/billing/portal/actions.tsのコード側対策)に続く、DB側の根本対策。
--
-- stripe_customer_id/stripe_subscription_id: INSERT時の非null設定・
-- UPDATE時の変更の両方を拒否する。正規の書き込みは段階1でservice_role化
-- した1箇所(app/billing/checkout/actions.ts、Stripe自身の応答を保存)と、
-- Stripe Webhook(app/api/stripe/webhook/route.ts、service_role)のみで、
-- いずれもservice_role経由のため影響を受けない。
--
-- livekit_server_id: UPDATE時の変更のみ拒否する(INSERT時は制限しない)。
-- 新規アカウント作成時のラウンドロビン割り当て(lib/accountProvisioning.ts、
-- 利用者のログインセッションクライアントでINSERT)が正規にこの列を
-- 設定するため、INSERT自体は塞がない。UPDATE側の唯一の利用者クライアント
-- 経由の書き込み(app/master/actions.tsのupdateAccountLivekitServer)は、
-- 他アカウントに対しては既存の「accounts: update own」RLS
-- (owner_user_id=auth.uid())により元々0行更新で無効なため、UPDATE拒否を
-- 追加しても実害のある機能を壊さない。
--
-- profiles分岐(2026-11-15_lock_profiles_account_id.sqlで追加したaccount_id
-- の保護を含む)は一切変更しない。
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
      -- stripe_customer_id/stripe_subscription_idも同じ理由でINSERT時の
      -- 設定を禁止する(2026-11-15追加、段階2)。正規のINSERT(新規アカウント
      -- 作成)はこの2列を設定しない。
      if new.stripe_customer_id is not null
         or new.stripe_subscription_id is not null then
        raise exception 'stripe_customer_id/stripe_subscription_idはこの経路からは設定できません';
      end if;
    elsif tg_op = 'UPDATE' then
      if new.plan is distinct from old.plan then
        raise exception 'planはこの経路からは変更できません';
      end if;
      if new.trial_ends_at is distinct from old.trial_ends_at
         or new.trial_used is distinct from old.trial_used then
        raise exception 'trial_ends_at/trial_usedはこの経路からは変更できません';
      end if;
      -- stripe_customer_id/stripe_subscription_idのUPDATE時の変更を拒否する
      -- (2026-11-15追加、段階2)。正規の書き込み(app/billing/checkout/
      -- actions.ts)は段階1でservice_role化済み。
      if new.stripe_customer_id is distinct from old.stripe_customer_id
         or new.stripe_subscription_id is distinct from old.stripe_subscription_id then
        raise exception 'stripe_customer_id/stripe_subscription_idはこの経路からは変更できません';
      end if;
      -- livekit_server_idのUPDATE時の変更を拒否する(2026-11-15追加、段階2)。
      -- INSERT時は新規アカウント作成のラウンドロビン割り当て
      -- (lib/accountProvisioning.ts)が利用者のクライアントで行うため制限しない。
      if new.livekit_server_id is distinct from old.livekit_server_id then
        raise exception 'livekit_server_idはこの経路からは変更できません';
      end if;
    end if;
  end if;

  return new;
end;
$$;

commit;
