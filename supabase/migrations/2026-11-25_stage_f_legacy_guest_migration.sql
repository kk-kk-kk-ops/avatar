-- 入室の仕組みの作り替え(docs/room-membership-plan.md)段階F。
--
-- 目的: 移行前の古いゲスト(profiles.role = 'guest' かつ
-- profiles.account_id がある人)を account_members に移し、
-- profiles.account_id / role を空(null)にする。これにより、
-- 以後はすべてのゲストが account_members ベースの「メンバー」として
-- 扱われるようになる(入室・チャット・Realtime等は、既存の
-- 段階A〜E・Bで作った account_members 経路がそのまま使われる。
-- 根拠は docs/stage-f-legacy-guest-migration.md の調査表を参照)。
--
-- 対象外: 持ち主(role = 'admin')・運営者(is_master)には一切触れない。
--
-- 適用方法: Supabase の SQL Editor から、このファイルの内容をそのまま
-- 直接実行する(PostgREST経由のAPI呼び出しではなく、直接のSQL接続で
-- 実行することで、profiles.account_id/roleの書き換えを禁止する
-- prevent_privileged_column_self_write トリガー〈auth.role() is null の
-- 時はバイパスされる〉の対象外になる)。
--
-- 元に戻す場合は、同じフォルダの
-- 2026-11-25_stage_f_legacy_guest_migration_rollback.sql を実行する。

begin;

-- 1. 控えの表(移す前の状態をすべて保存する。RLSを有効にし、
--    ポリシーを一切作らないため、サービスロール・直接のSQL接続以外からは
--    一切読めない)。
create table if not exists public.stage_f_legacy_guest_backup (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_id uuid not null,
  role text not null,
  -- 段階Fを実行する前から、この(user_id, account_id)の組の
  -- account_members行が既にあったかどうか。段階Fが新しく作った行だけを
  -- 元に戻す(rollback)時の判定に使う。
  member_row_preexisted boolean not null,
  backed_up_at timestamptz not null default now()
);
alter table public.stage_f_legacy_guest_backup enable row level security;
-- 意図的にSELECT等のポリシーを作らない(account_membersの書き込み用
-- ポリシーを意図的に作らない既存の方針と同じ考え方)。

-- 2. 控えを保存する。対象は「古いゲスト」(role = 'guest' かつ
--    account_idがある人)全員。所属ルームでBANされている人も対象に含める
--    (BAN中は一覧・入室から消え、行は残るという段階A-1の決まりに合わせる。
--    この扱いはユーザー確認済み)。
insert into public.stage_f_legacy_guest_backup
  (user_id, account_id, role, member_row_preexisted)
select
  p.user_id,
  p.account_id,
  p.role,
  exists (
    select 1 from public.account_members m
    where m.user_id = p.user_id and m.account_id = p.account_id
  )
from public.profiles p
where p.role = 'guest' and p.account_id is not null
on conflict (user_id) do nothing;

-- 3. account_members に行を作る(すでにある場合は何もしない)。
--    joined_at は profiles.created_at(プロフィール作成日時。実際に
--    最初にこのアカウントへ参加した日時に近い値)、last_accessed_at は
--    profiles.last_login_at(最終ログイン日時)を使う。どちらも
--    profilesに無い場合だけnow()にフォールバックする(通常は起きない)。
insert into public.account_members (user_id, account_id, joined_at, last_accessed_at)
select
  b.user_id,
  b.account_id,
  coalesce(p.created_at, now()),
  coalesce(p.last_login_at, now())
from public.stage_f_legacy_guest_backup b
join public.profiles p on p.user_id = b.user_id
on conflict (user_id, account_id) do nothing;

-- 4. profiles.account_id / role を空にする(持ち主・運営者には触れない。
--    対象をstage_f_legacy_guest_backupに記録した本人だけに絞る)。
update public.profiles p
set account_id = null, role = null
where p.user_id in (select user_id from public.stage_f_legacy_guest_backup);

-- 5. 移した人数(控えの件数)と、空にできた人数が一致することを確かめる。
--    一致しなければ例外を発生させ、トランザクション全体を取り消す。
do $$
declare
  v_backup_count bigint;
  v_cleared_count bigint;
begin
  select count(*) into v_backup_count from public.stage_f_legacy_guest_backup;

  select count(*) into v_cleared_count
  from public.profiles p
  join public.stage_f_legacy_guest_backup b on b.user_id = p.user_id
  where p.account_id is null and p.role is null;

  if v_backup_count <> v_cleared_count then
    raise exception
      '段階F: 控え件数(%)とprofilesを空にできた件数(%)が一致しません。取り消します。',
      v_backup_count, v_cleared_count;
  end if;

  raise notice '段階F: % 件の古いゲストを account_members に移し、profilesを空にしました。', v_backup_count;
end $$;

commit;
