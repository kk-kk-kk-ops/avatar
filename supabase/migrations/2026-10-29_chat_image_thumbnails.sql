-- ============================================================
-- チャット画像のサムネイル方式 対応マイグレーション
-- ============================================================
-- 目的: チャットの吹き出し表示で、拡大表示用の最終画像(最大1920px・
-- 最大500KB程度のWebP)をそのまま使っていたため、吹き出しを見るだけの
-- 場合でもSupabaseの通信量(Egress)を多く消費していた。吹き出し表示
-- 専用の小さいサムネイル(幅320px程度)を別途保存し、拡大表示のときだけ
-- 元の最終画像を読み込むようにすることで、通信量を削減する。
--
-- このファイルは本番Supabaseへ「1回だけ」適用する想定の、再実行しても
-- 安全な(drop if exists → 作り直しの)SQLです。consolidated_setup.sqlと
-- 同じスタイルを踏襲しています。適用後、本番での動作確認が取れたら
-- 同じ内容をconsolidated_setup.sql側にも反映します(ゼロから作り直す
-- 場合の正本を最新に保つため)。
--
-- 前提: このマイグレーションは「列・関数を追加/拡張するだけ」で、
-- 既存データを書き換えたり削除したりする処理は一切含みません。
-- 適用してもアプリの見た目や動作は変わりません(アプリコードが
-- thumbnail_pathを使うのは、別途デプロイするコード変更から)。
--
-- 全体をトランザクションで囲み、途中のどこかで失敗したら全て
-- ロールバックされるようにする(中途半端な状態が本番に残らない)。
-- ============================================================

begin;


-- 1. chat_messagesにサムネイルパス列を追加。
-- image_pathと同じく、サムネイルは常に画像付きメッセージにのみ
-- 付随する(単独では存在しない)ため、既存のchat_messages_content_check
-- 制約(本文or画像or削除済みのいずれか必須)は変更不要。
alter table public.chat_messages add column if not exists thumbnail_path text;

-- 1b. 「thumbnail_pathがあるならimage_pathも必ずある」をDB側でも保証する。
-- この列は今追加したばかりで全行nullのため、既存データが違反する
-- ことはあり得ないが、念のため追加前に0件であることを確認しておく
-- (0件以外ならここで例外になりマイグレーション全体がロールバックされる)。
do $$
begin
  if exists (
    select 1 from public.chat_messages
    where thumbnail_path is not null and image_path is null
  ) then
    raise exception 'thumbnail_pathがimage_path無しで存在する行があります(想定外)';
  end if;
end $$;

alter table public.chat_messages drop constraint if exists chat_messages_thumbnail_requires_image_check;
alter table public.chat_messages add constraint chat_messages_thumbnail_requires_image_check
  check (thumbnail_path is null or image_path is not null);


-- 2. 挿入時のなりすまし防止RLSに、thumbnail_pathのチェックを追加。
-- image_pathと全く同じ考え方(room_id/sender_user_id配下のパスしか
-- 許可しない)。
drop policy if exists "chat_messages: insert own dm" on public.chat_messages;
create policy "chat_messages: insert own dm"
  on public.chat_messages for insert
  with check (
    sender_user_id = auth.uid()
    and char_length(message) <= 500
    and (
      image_path is null
      or image_path like (room_id::text || '/' || sender_user_id::text || '/%')
    )
    and (
      thumbnail_path is null
      or thumbnail_path like (room_id::text || '/' || sender_user_id::text || '/%')
    )
    and (
      (
        recipient_user_id is not null
        and group_id is null
        and recipient_user_id <> auth.uid()
        and room_id in (
          select r.id from public.rooms r
          join public.profiles p on p.account_id = r.account_id
          where p.user_id = auth.uid()
        )
      )
      or (
        recipient_user_id is null
        and group_id is not null
        and group_id in (
          select group_id from public.chat_group_members where user_id = auth.uid()
        )
      )
    )
  );


-- 3. 招待リンク経由(viewOnly)の一覧取得関数に、thumbnail_pathを追加。
drop function if exists public.list_chat_messages_by_invite_token(text, uuid, uuid);

create function public.list_chat_messages_by_invite_token(
  token text,
  target_room_id uuid,
  peer_user_id uuid
)
returns table (
  id uuid,
  sender_user_id uuid,
  sender_name text,
  message text,
  created_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  image_path text,
  thumbnail_path text
)
language sql
security definer
set search_path = public
as $$
  select m.id, m.sender_user_id, m.sender_name, m.message, m.created_at,
    m.edited_at, m.deleted_at, m.image_path, m.thumbnail_path
  from public.chat_messages m
  join public.rooms r on r.id = m.room_id
  join public.accounts a on a.id = r.account_id
  where a.invite_token = token
    and r.id = target_room_id
    and (
      (m.sender_user_id = auth.uid() and m.recipient_user_id = peer_user_id)
      or (m.sender_user_id = peer_user_id and m.recipient_user_id = auth.uid())
    )
  order by m.created_at asc
  limit 50;
$$;

revoke all on function public.list_chat_messages_by_invite_token(text, uuid, uuid) from public;
revoke all on function public.list_chat_messages_by_invite_token(text, uuid, uuid) from anon;
grant execute on function public.list_chat_messages_by_invite_token(text, uuid, uuid) to authenticated;


-- 4. 招待リンク経由(viewOnly)の送信関数に、p_thumbnail_path引数を追加。
-- 引数を追加して関数シグネチャが変わるため、旧シグネチャをdropしてから
-- 作り直す(既存のsend_chat_message_by_invite_tokenと同じ方針)。
drop function if exists public.send_chat_message_by_invite_token(text, uuid, uuid, text, text, text);

create function public.send_chat_message_by_invite_token(
  token text,
  target_room_id uuid,
  recipient_user_id uuid,
  sender_name text,
  message text,
  p_image_path text default null,
  p_thumbnail_path text default null
)
returns table (id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if recipient_user_id = auth.uid() then
    raise exception '自分自身には送信できません';
  end if;
  if char_length(message) > 500 then
    raise exception 'メッセージの長さが不正です';
  end if;
  if char_length(message) = 0 and p_image_path is null then
    raise exception 'メッセージの長さが不正です';
  end if;

  select r.id into v_room_id
  from public.rooms r
  join public.accounts a on a.id = r.account_id
  where a.invite_token = token
    and r.id = target_room_id;

  if v_room_id is null then
    raise exception 'このルームへのアクセス権がありません';
  end if;

  -- 画像・サムネイル添付時のなりすまし防止(通常ルートのRLSと同じ検証)。
  if p_image_path is not null
     and p_image_path not like (v_room_id::text || '/' || auth.uid()::text || '/%') then
    raise exception '不正な画像パスです';
  end if;

  if p_thumbnail_path is not null
     and p_thumbnail_path not like (v_room_id::text || '/' || auth.uid()::text || '/%') then
    raise exception '不正なサムネイルパスです';
  end if;

  return query
    insert into public.chat_messages
      (room_id, sender_user_id, recipient_user_id, sender_name, message, image_path, thumbnail_path)
    values (v_room_id, auth.uid(), recipient_user_id, sender_name, message, p_image_path, p_thumbnail_path)
    returning chat_messages.id, chat_messages.created_at;
end;
$$;

revoke all on function public.send_chat_message_by_invite_token(text, uuid, uuid, text, text, text, text) from public;
revoke all on function public.send_chat_message_by_invite_token(text, uuid, uuid, text, text, text, text) from anon;
grant execute on function public.send_chat_message_by_invite_token(text, uuid, uuid, text, text, text, text) to authenticated;


-- 5. 保管期間切れメッセージの取得関数に、thumbnail_pathを追加。
-- app/api/cron/cleanup-chat-history/route.ts がこれを使って
-- Storage上の実ファイル(画像・サムネイル両方)を削除する。
--
-- [レビュー指摘による是正] この関数は本来「service_roleからのみ実行できる
-- (一般ユーザーには実行させない)」設計だが、元のconsolidated_setup.sqlでは
-- public/anonからのrevokeのみで、authenticatedからの明示的なrevokeが
-- 無かった。Supabaseのデフォルト権限により、関数作成時にauthenticatedへも
-- 自動でEXECUTEが付与されるため、実際にはログイン済みの一般ユーザーが
-- 直接呼び出せる状態になっていた可能性がある(全アカウント分の期限切れ
-- メッセージID・画像パスを取得できてしまう、意図しない権限)。このマイグ
-- レーションで明示的にrevokeし、本来の設計(service_role限定)に揃える。
drop function if exists public.get_expired_chat_message_ids();

create function public.get_expired_chat_message_ids()
returns table (id uuid, image_path text, thumbnail_path text)
language sql
security definer
set search_path = public
stable
as $$
  select m.id, m.image_path, m.thumbnail_path
  from public.chat_messages m
  join public.rooms r on r.id = m.room_id
  join public.accounts a on a.id = r.account_id
  where m.created_at < now() - (
    case a.plan
      when 'free' then interval '7 days'
      when 'light' then interval '1 month'
      when 'standard' then interval '1 month'
      when 'pro' then interval '3 months'
      else interval '1 month'
    end
  );
$$;

revoke all on function public.get_expired_chat_message_ids() from public;
revoke all on function public.get_expired_chat_message_ids() from anon;
revoke all on function public.get_expired_chat_message_ids() from authenticated;
grant execute on function public.get_expired_chat_message_ids() to service_role;


-- 6. グループ退出時の関数に、deleted_thumbnail_pathsを追加。
-- app/api/chat/cleanup-group-images/route.ts がこれを使って
-- Storage上の実ファイル(画像・サムネイル両方)を削除する。
-- (「id」列の曖昧参照エラーを避けるためchat_groups.idと明示的に
-- 修飾している既存の対策は、そのまま維持する)
drop function if exists public.leave_chat_group(uuid);
create function public.leave_chat_group(p_group_id uuid)
returns table (
  id uuid,
  created_at timestamptz,
  message text,
  sender_name text,
  deleted_image_paths text[],
  deleted_thumbnail_paths text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_name text;
  v_message text;
  v_id uuid;
  v_created_at timestamptz;
  v_remaining_members int;
  v_image_paths text[];
  v_thumbnail_paths text[];
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if not exists (
    select 1 from public.chat_group_members
    where group_id = p_group_id and user_id = auth.uid()
  ) then
    raise exception 'このグループのメンバーではありません';
  end if;

  select g.room_id into v_room_id from public.chat_groups g where g.id = p_group_id;

  select coalesce(p.display_name, 'メンバー') into v_name
  from public.profiles p where p.user_id = auth.uid();

  v_message := v_name || 'が退出しました';

  insert into public.chat_messages
    (room_id, sender_user_id, sender_name, group_id, message, is_system)
  values
    (v_room_id, auth.uid(), v_name, p_group_id, v_message, true)
  returning chat_messages.id, chat_messages.created_at into v_id, v_created_at;

  delete from public.chat_group_members
  where group_id = p_group_id and user_id = auth.uid();

  select count(*) into v_remaining_members
  from public.chat_group_members
  where group_id = p_group_id;

  if v_remaining_members = 0 then
    select array_agg(m.image_path) into v_image_paths
    from public.chat_messages m
    where m.group_id = p_group_id and m.image_path is not null;

    select array_agg(m.thumbnail_path) into v_thumbnail_paths
    from public.chat_messages m
    where m.group_id = p_group_id and m.thumbnail_path is not null;

    delete from public.chat_groups where chat_groups.id = p_group_id;
  end if;

  return query
    select v_id, v_created_at, v_message, v_name,
      coalesce(v_image_paths, array[]::text[]),
      coalesce(v_thumbnail_paths, array[]::text[]);
end;
$$;

revoke all on function public.leave_chat_group(uuid) from public;
revoke all on function public.leave_chat_group(uuid) from anon;
grant execute on function public.leave_chat_group(uuid) to authenticated;


commit;
