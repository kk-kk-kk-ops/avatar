-- 「accounts: insert own」ポリシーに、「まだどこにも所属していない人だけが
-- 新しいaccounts行を作れる」という条件を追加する(段階3)。
--
-- 背景: 従来のポリシー(auth.uid() = owner_user_idのみ)は、既にどこかの
-- アカウントに所属している利用者(招待で参加した通常のゲスト等)でも、
-- 自分名義の新しいaccounts行を何個でも直接INSERTできる状態だった。これと
-- 段階1・2で対策したStripe列の書き換えを組み合わせると、所属先を持たない
-- 通常のゲストでも他アカウントのStripeカスタマーポータルを乗っ取れる経路に
-- なっていた(2026-11-14・15調査)。
--
-- 正規のINSERT経路(lib/accountProvisioning.ts:72-81、新規アカウント作成)は、
-- 呼び出し元の重複防止チェック(同ファイル:34-41)により、既に
-- profiles.account_idを持つユーザーに対してはINSERT自体を実行しない
-- (早期return)。したがってこの条件を追加しても正規の機能は壊れない。
begin;

drop policy if exists "accounts: insert own" on public.accounts;
create policy "accounts: insert own"
  on public.accounts for insert
  with check (
    auth.uid() = owner_user_id
    and not exists (
      select 1 from public.profiles
      where user_id = auth.uid() and account_id is not null
    )
  );

commit;
