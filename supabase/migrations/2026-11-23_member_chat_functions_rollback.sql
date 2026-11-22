-- 2026-11-23_member_chat_functions.sql の戻しSQL。

drop function if exists public.list_chat_messages_as_member(uuid, uuid);
drop function if exists public.send_chat_message_as_member(uuid, uuid, text, text, text, text);
drop function if exists public.edit_chat_message_as_member(uuid, text, timestamptz);
drop function if exists public.delete_chat_message_as_member(uuid, timestamptz);
drop function if exists public.create_chat_group_as_member(uuid, uuid[]);
drop function if exists public.list_chat_threads_as_member(uuid);
drop function if exists public.create_dm_mention_as_member(uuid, text);
drop function if exists public.set_chat_message_reaction_as_member(uuid, text);
drop function if exists public.remove_chat_message_reaction_as_member(uuid);
drop function if exists public.list_chat_message_reactions_as_member(uuid[]);
