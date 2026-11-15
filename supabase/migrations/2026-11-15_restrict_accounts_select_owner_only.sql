-- 「accounts: select own」を、利用者のprofiles.account_idを辿った閲覧
-- (ゲスト・viewOnlyが自分の所属先アカウントの行を直接読める経路)を
-- 廃止し、owner_user_idが自分である行のみに限定する(段階5)。
--
-- 背景: 従来のポリシー(auth.uid() = owner_user_id OR id in (select
-- account_id from profiles where user_id = auth.uid()))は、ゲストでも
-- 自分の所属先アカウントのinvite_token・Stripe顧客情報等を直接読める
-- 状態だった。段階1〜3でprofiles.account_id・accountsのStripe列・
-- accounts作成経路を保護した結果、これらの列を正規の手段で他アカウントの
-- 値に書き換えることはできなくなったが、「accounts: select own」自体は
-- まだ本来ゲストに見せる必要のない列(Stripe顧客情報等)を含む全列を
-- 公開していた。段階4でゲストに必要な最小限の情報(plan, invite_token)
-- だけを返すget_own_account_guest_info()を用意し、app/page.tsx・
-- app/master/page.tsx・app/api/livekit-token/route.tsの読み取りをそちらに
-- 置き換えたため、ここでaccounts自体のSELECTを所有者のみに絞る。
--
-- 「accounts: select master」(is_masterによる全件閲覧)は変更しない。
begin;

drop policy if exists "accounts: select own" on public.accounts;
create policy "accounts: select own"
  on public.accounts for select
  using (auth.uid() = owner_user_id);

commit;
