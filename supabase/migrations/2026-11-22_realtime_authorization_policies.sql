-- Realtime Authorization 項目6の段階3。
-- can_access_avatar_room_topic・can_message_user_channel 関数と、
-- realtime.messages への8つのポリシーを追加する。これらのポリシーは
-- private指定のチャンネルにだけ効くため、段階7(全チャンネルの
-- private:true化)までは既存の動作に影響しない想定。
-- 段階2(2026-11-22_realtime_view_grants.sql)を先に適用しておくこと。
-- 適用はTech Lead/ユーザーの承認後に行う。

-- アカウントメンバー(通常)またはviewOnly許可証を持つかを判定し、かつ
-- BANされていないかを合わせて判定する(presence/broadcast共通の入口)。
-- 2026-11-11修正: 旧実装は'avatar-room-' || r.id::text = realtime.topic()
-- という文字列連結比較で、メッセージ1件ごとにroomsテーブルを全件スキャン
-- していた。トピックからUUID部分を切り出し、主キー検索(r.id = <uuid>)に
-- 変えることで性能を改善する。切り出しはCASE式で「トピックが本当に
-- avatar-room-{UUID}の形の時だけ」行う(4-4節のuser-channelと同じ理由:
-- regexpチェックとキャストをandで繋ぐと評価順序が未規定のため、
-- avatar-room-以外のトピックでキャストエラーになり得る。CASEは
-- マッチした分岐しか評価しないため安全)。'avatar-room-'は
-- avatar(6)+'-'(1)+room(4)+'-'(1)=12文字のため、UUID部分は
-- substring(... from 13)で取り出す(fromは1始まり・inclusiveのため、
-- 12文字目=2つ目のハイフン自身を含めないよう13から始める)。
create or replace function public.can_access_avatar_room_topic()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    when realtime.topic() ~ '^avatar-room-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then exists (
      select 1
      from public.rooms r
      where r.id = substring(realtime.topic() from 13)::uuid
        and (
          exists (
            select 1 from public.profiles p
            where p.user_id = auth.uid() and p.account_id = r.account_id
          )
          or exists (
            select 1 from public.realtime_view_grants g
            where g.user_id = auth.uid()
              and g.account_id = r.account_id
              and g.expires_at > now()
          )
        )
        and not public.is_banned_for_account(r.account_id)
    )
    else false
  end;
$$;

-- 本番DBに触れずに確認する方法(テーブル参照なしの文字列SELECT、実行は承認後):
-- select
--   t as topic,
--   (t ~ '^avatar-room-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as matches,
--   case
--     when t ~ '^avatar-room-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
--     then substring(t from 13)::uuid
--     else null
--   end as extracted_uuid
-- from (values
--   ('avatar-room-' || gen_random_uuid()::text),
--   ('avatar-room-not-a-uuid'),
--   ('user-session-' || gen_random_uuid()::text),
--   ('user-' || gen_random_uuid()::text),
--   ('garbage')
-- ) as x(t);

revoke all on function public.can_access_avatar_room_topic() from public;
revoke all on function public.can_access_avatar_room_topic() from anon;
grant execute on function public.can_access_avatar_room_topic() to authenticated;

-- is_masterは意図的にここに含めない(含めるとbroadcast送信ポリシー経由で
-- 運営者も送信できてしまう。presence SELECTのみ別途ORで追加する)。

-- user-channel(方式C)の送信可否判定。指定したuser_idが、送信者
-- (auth.uid())と「同じアカウントに正当に関わっているか」
-- (通常メンバーまたは有効なviewOnly許可証、いずれかの組み合わせ)を判定し、
-- BANされていないことも確認する。
create or replace function public.can_message_user_channel(p_recipient_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from (
      select account_id from public.profiles where user_id = auth.uid()
      union
      select account_id from public.realtime_view_grants
      where user_id = auth.uid() and expires_at > now()
    ) as mine(account_id)
    where mine.account_id in (
      select account_id from public.profiles where user_id = p_recipient_user_id
      union
      select account_id from public.realtime_view_grants
      where user_id = p_recipient_user_id and expires_at > now()
    )
    and not public.is_banned_for_account(mine.account_id)
  );
$$;

revoke all on function public.can_message_user_channel(uuid) from public;
revoke all on function public.can_message_user_channel(uuid) from anon;
grant execute on function public.can_message_user_channel(uuid) to authenticated;

-- presence SELECT: メンバー/viewOnly または 運営者(is_master、avatar-roomトピックに限定)
drop policy if exists "avatar-room: presence access" on realtime.messages;
create policy "avatar-room: presence access"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'presence'
    and (
      public.can_access_avatar_room_topic()
      or (
        realtime.topic() ~ '^avatar-room-'
        and exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_master)
      )
    )
  );

-- presence INSERT: メンバー/viewOnlyのみ(運営者は含まない。track()しないため不要)
drop policy if exists "avatar-room: presence send" on realtime.messages;
create policy "avatar-room: presence send"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and public.can_access_avatar_room_topic()
  );

-- broadcast SELECT: メンバー/viewOnlyのみ(is_masterは含めない=運営者は閲覧も不可)
drop policy if exists "avatar-room: broadcast access" on realtime.messages;
create policy "avatar-room: broadcast access"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and public.can_access_avatar_room_topic()
  );

-- broadcast INSERT: メンバー/viewOnlyのみ
drop policy if exists "avatar-room: broadcast send" on realtime.messages;
create policy "avatar-room: broadcast send"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and public.can_access_avatar_room_topic()
  );

drop policy if exists "user-session: select own" on realtime.messages;
create policy "user-session: select own"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'user-session-' || auth.uid()::text
  );

drop policy if exists "user-session: insert own" on realtime.messages;
create policy "user-session: insert own"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'user-session-' || auth.uid()::text
  );

drop policy if exists "user-channel: select own" on realtime.messages;
create policy "user-channel: select own"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'user-' || auth.uid()::text
  );

-- 2026-11-09修正: 以前は regexp_replace(realtime.topic(), '^user-', '')::uuid
-- を無条件に評価しており、avatar-room-*/user-session-*等、"user-"で始まら
-- ないトピックへの送信時にキャストエラーになり得た(複数ポリシーはORで
-- 評価されるが、エラーは短絡評価の機会を奪い文全体を失敗させる)。CASE式で
-- 「トピックが本当にuser-{UUID}の形の時だけ」キャスト・判定するよう修正。
drop policy if exists "user-channel: insert same account" on realtime.messages;
create policy "user-channel: insert same account"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and case
      when realtime.topic() ~ '^user-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.can_message_user_channel(substring(realtime.topic() from 6)::uuid)
      else false
    end
  );
