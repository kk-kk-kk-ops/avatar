-- 2026-11-22_realtime_authorization_policies.sql の戻しSQL。
-- 段階2の戻しより先に実行すること。

drop policy if exists "avatar-room: presence access" on realtime.messages;
drop policy if exists "avatar-room: presence send" on realtime.messages;
drop policy if exists "avatar-room: broadcast access" on realtime.messages;
drop policy if exists "avatar-room: broadcast send" on realtime.messages;
drop policy if exists "user-session: select own" on realtime.messages;
drop policy if exists "user-session: insert own" on realtime.messages;
drop policy if exists "user-channel: select own" on realtime.messages;
drop policy if exists "user-channel: insert same account" on realtime.messages;

drop function if exists public.can_message_user_channel(uuid);
drop function if exists public.can_access_avatar_room_topic();
