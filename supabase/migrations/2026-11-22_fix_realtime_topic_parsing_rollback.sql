-- 2026-11-22_fix_realtime_topic_parsing.sql の戻しSQL。
-- 段階3(2026-11-22_realtime_authorization_policies.sql)適用後の状態に戻す。

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

drop function if exists public.can_message_user_channel_topic();

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
