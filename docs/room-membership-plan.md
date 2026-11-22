# 入室の仕組みの作り替え 設計書(設計のみ・未適用)

2026-11-22時点の設計。**この文書のSQL・方針はいずれも未適用。** 本番への反映は、各段階ごとにユーザーの明示的な承認を得てから行う。コード・SQLのファイルはこの文書の作成時点では一切変更していない。

---

## 1節 背景と決定事項

### 1-1. 今の問題

- **ゲストの所属先が上書きされる問題**: `lib/joinAccountViaInvite.ts`は、自分のアカウントを持たない人(純粋なゲスト)が招待URLを開くたびに`profiles.account_id`/`role`を新しい招待先で上書きする(`lib/joinAccountViaInvite.ts:68-80`)。その結果、`/`を招待トークン無しで開いたときの振り分け(`lib/authRouting.ts:24-39`)は**最後に上書きされた`account_id`だけ**を見るため、「一度他人の招待URLに入ると、その後『/』から入っても最後に入った招待URLのルームに行ってしまう」現象が起きる。1人が同時に複数のルームに所属できないデータモデル(`profiles.account_id`は1人1つ)そのものが原因。
- **招待参加時にBANを確認せずに所属先を書き換える問題**: `joinAccountViaInvite`自体にはBAN確認が無く、`profiles.account_id`/`role`を書き換えた**後**に、`app/page.tsx:150-166`(`renderRoomJoin`内)で初めて`banned_participants`を確認し、BAN中なら`BannedNotice`を表示する。つまり、BANされている人が再度招待URLを踏むと、入室はできないものの所属先の書き換え自体は起きてしまう(実害は小さいが、設計として望ましくない)。

### 1-2. 決まった方針(作り方)

- `profiles.account_id`は「自分のルーム(自分が持ち主のアカウント)」にだけ使う。招待で入った人の所属先を書き換えるのはやめる(`profiles.role`の`"guest"`も使わなくなる方向)。
- 他人のルームには、自分のルームを持っていない人も含めて**全員**、今のviewOnlyの仕組み(`profiles`を書き換えず、都度トークン/証跡で認可する方式)で入る。
- ただし入るときの鍵を、「今の招待URL(招待トークン)」から「メンバーの一覧表に載っていること」に差し替える。招待URLは、一覧表に載るための入口として**最初の1回だけ**使う。

### 1-3. 製品として決めたこと

- 入室画面: 自分のルームと、メンバーになっているルームを、カード(サムネイル・ルーム名・管理者名・最終アクセス日)で一覧表示。並び順は自分のルームが先頭、その後は最終アクセスの新しい順。選んで入室する。**自分のルームしか持っていない人(メンバーのルームが0件)にも、常にこのカード一覧を見せる(2026-11-22決定)。**
- 自分のルームを持っていない人にだけ「ルームを作成する」ボタンを出す(1人1ルーム)。
- 招待URLの再発行: 古いURLでは新しくメンバーになれない。すでにメンバーの人は入り続けられる。
- 一覧から自分で抜けられる(カードのメニューから「一覧から外す」)。外したら入れなくなり、もう一度入るには有効な招待URLが必要。
- 持ち主は、会議室の管理者向けモーダル(在室者・BANの画面)で「メンバー」の一覧を見られる。外す操作は今のBANで行う。
- BANされた人の一覧からは、そのルームを消す(入れない)。BANを解除したら戻る。
- 人数上限は今のまま「入室中の人数」で数える(メンバーの人数では制限しない)。
- チャット・DMは今までどおりルームごと(ルームをまたいだ表示はしない)。

---

## 2節 今の仕組みの一覧

前回の調査(2026-11-22、作業2〜3)と今回の調査(作業1)の結果をまとめる。

### 2-1. DB(supabase/consolidated_setup.sql)

| 名前 | 行番号 | 判定内容 |
|---|---|---|
| accounts: insert own | 234-243 | `profiles.account_id is not null`なら新規`accounts`作成を拒否(1人1ルームの強制)。**招待で所属先が書き換わる現状では、ゲストもここで弾かれる** |
| (記録)accounts: select own | 349-359 | 2026-11-15に「`profiles.account_id`経由の閲覧」を廃止し`owner_user_id`限定にした旨の記録。ゲストに必要な情報は`get_own_account_guest_info()`に分離済み |
| rooms: select own account | 457-464 | `account_id in (select account_id from profiles where user_id=auth.uid())` |
| rooms: modify own account as owner / map_layout is editable by room owner / banned_participants: select・modify own account as owner / announcement_reads: own account | 466-478、519-534、646-669、3619-3633 | いずれも`accounts.owner_user_id = auth.uid()`(持ち主判定。account_idのメンバー判定とは別軸) |
| get_own_account_guest_info() | 756-775 | `profiles.account_id = a.id` かつ `not is_banned_for_account` |
| chat_messages: select/insert own dm(現行版) | 1986-2043 | `room_id in (select r.id from rooms join profiles ...)`+グループ判定+BAN確認 |
| create_chat_group(p_room_id, ...) | 2052-2075 | `exists(select 1 from rooms join profiles where r.id=p_room_id and p.user_id=auth.uid())` |
| list_chat_threads(p_room_id) | 2388-2417 | 同様の判定+BAN確認 |
| create_chat_mentions / create_dm_mention(非招待版) | 2766-2859 | `profiles.account_id`は使わず、`chat_messages.sender_user_id`/`chat_group_members`だけで判定 |
| `*_by_invite_token`関数群(12個) | 783-3197 | `lookup_account_by_invite_token`・`list_rooms_by_invite_token`・`list_chat_messages_by_invite_token`・`send_chat_message_by_invite_token`・`edit_chat_message_by_invite_token`・`delete_chat_message_by_invite_token`・`create_chat_group_by_invite_token`・`list_chat_threads_by_invite_token`・`create_dm_mention_by_invite_token`・`set_chat_message_reaction_by_invite_token`・`remove_chat_message_reaction_by_invite_token`・`list_chat_message_reactions_by_invite_token`。すべて`accounts.invite_token = token`の一致+`not is_banned_for_account`で判定。`profiles`は書き換えない |
| is_banned_for_account(uuid) / is_banned_for_room(uuid) | 717-752 | `banned_participants`テーブルを参照。呼び出し本人(`auth.uid()`)のBAN状態のみ判定 |
| can_access_avatar_room_topic() | 3747-3785(PL/pgSQL版) | `profiles.account_id = r.account_id` または `realtime_view_grants`(有効期限内) |
| can_message_user_channel(uuid) | 3789-3816 | 送信者・宛先ともに`profiles.account_id`(または`realtime_view_grants`)で同じアカウントか判定 |
| can_message_user_channel_topic() | 3829-3852 | トピックの形を確認し`can_message_user_channel`を呼ぶだけ |
| realtime.messagesへの8ポリシー | 3863-3942 | 上記関数を呼ぶ(判定の実体は関数側) |
| realtime_view_grants / grant_realtime_view_access | 3693-3737 | viewOnly専用の30分間許可証(テーブル+発行関数) |

### 2-2. サーバー側のコード

| 場所 | 判定方法 |
|---|---|
| `lib/joinAccountViaInvite.ts`(全体) | 招待参加の3分岐: 自分の招待URL/既に別アカウント持ち(viewOnly)/純粋なゲスト(`account_id`書き換え) |
| `app/page.tsx:393-470`(`renderRoomJoin`/`renderViewOnlyRoomJoin`) | 入室画面の振り分け。`resolveUserRouteState`(`lib/authRouting.ts`)の`type`で分岐 |
| `app/api/livekit-token/route.ts:31-52`・`app/api/indigo-token/route.ts:55-81` | 通常ルート(rooms RLS)→無ければ`list_rooms_by_invite_token`(viewOnly) |
| `app/api/livekit-token/route.ts:67-86`・`indigo-token/route.ts:99-118` | `banned_participants`直接クエリでBAN確認 |
| `app/api/chat/image-url/route.ts:48-72` | 通常: `chat_messages`のRLS / viewOnly: `list_chat_messages_by_invite_token` |
| `lib/billingAccountGuard.ts:27-60`(`requireVerifiedBillingAccount`) | `profiles.role==="admin"` かつ `accounts.owner_user_id===本人`(1件) かつ `profiles.account_id===account.id` |
| `lib/accountProvisioning.ts:33-41`(`provisionAccountForUser`) | 「既に`profiles.account_id`があれば新規アカウントを作らない」で1人1ルームを強制 |

### 2-3. 画面側のコード(components/AvatarSpace.tsx)

`viewOnlyInviteToken`への参照は82件。主な分岐:
1. チャット関連RPCの経路振り分け(DM一覧・送信・編集・削除・リアクション・グループ作成・メンション・スレッド一覧)で、`viewOnlyInviteToken`があれば`*_by_invite_token`関数、無ければ通常のテーブル操作(最多)。
2. LiveKit/Indigo/画像URLトークン要求に`viewOnlyInviteToken`を`inviteToken`として付与。
3. ログアウト・退出後のリダイレクト先(`/`か`/?invite=トークン`か)。
4. 「自分のルームへ」ボタン(`ownRoomHref`)の表示条件。
5. `isMaster`は常に`false`(viewOnly中はマスター権限を一切行使できない)。

### 2-4. 持ち主判定

| 場所 | 内容 |
|---|---|
| `lib/billingAccountGuard.ts:27-60` | 課金・管理画面モーダル全部が依存する唯一の入口 |
| `lib/authRouting.ts:36-39` | `role`が`"admin"`/`"guest"`かで`UserRouteState.type`を分ける |
| `lib/accountProvisioning.ts:91-94` | 新規ルーム作成時に`role: "admin"`を付与 |
| `lib/joinAccountViaInvite.ts:75` | ゲスト参加時に`role: "guest"`を付与(今回これを廃止する) |
| `supabase/consolidated_setup.sql:3584-3591` | `announcements: select master or admin`。`profiles.role='admin'`をアカウントを問わずグローバルに判定 |

---

## 3節 メンバーの一覧表の設計(SQL案)

**この節のSQLはすべて案であり、このファイルの中だけの記載。`supabase/`配下のファイルは作成・変更していない。**

### 3-1. テーブル(案: `account_members`)

```sql
-- 案: どのアカウント(≒ルーム。1アカウント1ルームのため)に、どのユーザーが
-- メンバーとして載っているかを記録する。招待URLで最初の1回だけ参加し、
-- 以後はこの表への有無で入室可否を判定する(profiles.account_idは使わない)。
create table if not exists public.account_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_accessed_at timestamptz not null default now(),
  primary key (user_id, account_id)
);
alter table public.account_members enable row level security;

-- 自分の行だけ読める。書き込み(insert/update/delete)用のポリシーは
-- 意図的に一切作らない。通常ロールからの直接の書き込みは常に拒否され、
-- 下のSECURITY DEFINER関数経由でのみ変更できる(realtime_view_grantsと
-- 同じ考え方)。
create policy "account_members: select own"
  on public.account_members for select
  using (user_id = auth.uid());
```

### 3-2. 関数案

**(1) 招待トークンでメンバーになる**

```sql
-- 招待トークンを検証し、自分をそのアカウントのメンバーに追加する。
-- 自分が持ち主のアカウント(owner_user_id = auth.uid())は対象外
-- (持ち主は自分のルームとして別経路で扱うため、メンバー表には載せない)。
-- BAN確認は「書き込みの前」に行う(現状のjoinAccountViaInviteが
-- profiles更新後にBANを確認している問題の修正)。
--
-- 戻り値の列名は、account_members.account_idと同じ名前にしない
-- (PL/pgSQLの関数本体はRETURNS TABLEの列名をそのまま変数として暗黙に
-- 宣言するため、同じ名前のテーブル列が本体内のSQL文に登場すると
-- 曖昧になるおそれがある。特に下のinsert ... on conflict (user_id,
-- account_id)のaccount_idは、戻り値の列名がaccount_idのままだと
-- "column reference ... is ambiguous"になり得る。これを避けるため、
-- 戻り値の列名自体を最初からずらしておく)。
create or replace function public.join_account_by_invite_token(token text)
returns table (joined_account_id uuid, is_own_account boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_owner_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;

  select a.id, a.owner_user_id into v_account_id, v_owner_user_id
  from public.accounts a
  where a.invite_token = token;

  if v_account_id is null then
    raise exception '無効な招待リンクです';
  end if;

  if v_owner_user_id = auth.uid() then
    -- 自分自身の招待URL。メンバー表には何も書かない。
    return query select v_account_id, true;
    return;
  end if;

  if public.is_banned_for_account(v_account_id) then
    raise exception 'このルームへのアクセスが制限されています';
  end if;

  insert into public.account_members (user_id, account_id, joined_at, last_accessed_at)
  values (auth.uid(), v_account_id, now(), now())
  on conflict (user_id, account_id) do update set last_accessed_at = now();

  return query select v_account_id, false;
end;
$$;

revoke all on function public.join_account_by_invite_token(text) from public;
revoke all on function public.join_account_by_invite_token(text) from anon;
grant execute on function public.join_account_by_invite_token(text) to authenticated;
```

**(2) 一覧を取得する(カード表示用。BANされているルームは除く)**

カード表示の値は、既存の`app/page.tsx:15-50`(`applyTemplateNameToRooms`)と同じ考え方にする。すなわち、ルーム名・サムネイルは`rooms.name`/`rooms.preview_image`ではなく、**今紐づいているテンプレート**の`templates.name`/`templates.thumbnail_image_url`(無ければ`background_image_url`)を優先し、テンプレートが見つからない時だけ`rooms`側の保存値にフォールバックする。管理者名は`accounts.invite_inviter_name`(`app/admin/actions.ts`の`performUpdateInviterName`が書き込む列、`supabase/consolidated_setup.sql:27`で定義)を優先し、無ければ持ち主の`profiles.display_name`を使う。招待トークンなど秘密の値は返さない。

```sql
-- 入室画面のカード一覧用。自分が持ち主のアカウントは含めない
-- (呼び出し側がaccounts.owner_user_id = auth.uid()で別途1件取得し、
-- 先頭に出す)。招待トークンなど秘密の値は返さない。
create or replace function public.list_my_room_memberships()
returns table (
  account_id uuid,
  room_id uuid,
  room_name text,
  preview_image text,
  owner_display_name text,
  last_accessed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    m.account_id,
    r.id as room_id,
    coalesce(t.name, r.name) as room_name,
    coalesce(t.thumbnail_image_url, t.background_image_url, r.preview_image) as preview_image,
    coalesce(a.invite_inviter_name, p.display_name, 'メンバー') as owner_display_name,
    m.last_accessed_at
  from public.account_members m
  join public.rooms r on r.account_id = m.account_id
  join public.accounts a on a.id = m.account_id
  left join public.templates t on t.id = r.template_id
  left join public.profiles p on p.user_id = a.owner_user_id
  where m.user_id = auth.uid()
    and not public.is_banned_for_account(m.account_id)
  order by m.last_accessed_at desc;
$$;

revoke all on function public.list_my_room_memberships() from public;
revoke all on function public.list_my_room_memberships() from anon;
grant execute on function public.list_my_room_memberships() to authenticated;
```

**(3) 一覧から外す**

```sql
create or replace function public.leave_account_membership(p_account_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.account_members
  where user_id = auth.uid() and account_id = p_account_id;
$$;

revoke all on function public.leave_account_membership(uuid) from public;
revoke all on function public.leave_account_membership(uuid) from anon;
grant execute on function public.leave_account_membership(uuid) to authenticated;
```

**(4) 最終アクセス日時を更新する(実際に入室した時に呼ぶ。一覧表示時には呼ばない)**

```sql
create or replace function public.touch_account_membership(p_account_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.account_members
  set last_accessed_at = now()
  where user_id = auth.uid() and account_id = p_account_id;
$$;

revoke all on function public.touch_account_membership(uuid) from public;
revoke all on function public.touch_account_membership(uuid) from anon;
grant execute on function public.touch_account_membership(uuid) to authenticated;
```

**(5) 持ち主がメンバー一覧を見る**

```sql
-- 会議室の管理者向けモーダル(在室者・BANの画面)の「メンバー」タブ用。
-- 呼び出し元が指定したアカウントの持ち主本人であることを確認する。
create or replace function public.list_account_members(p_account_id uuid)
returns table (
  user_id uuid,
  display_name text,
  joined_at timestamptz,
  last_accessed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select m.user_id, coalesce(p.display_name, 'メンバー'), m.joined_at, m.last_accessed_at
  from public.account_members m
  left join public.profiles p on p.user_id = m.user_id
  where m.account_id = p_account_id
    and exists (
      select 1 from public.accounts a
      where a.id = p_account_id and a.owner_user_id = auth.uid()
    )
  order by m.last_accessed_at desc;
$$;

revoke all on function public.list_account_members(uuid) from public;
revoke all on function public.list_account_members(uuid) from anon;
grant execute on function public.list_account_members(uuid) to authenticated;
```

**他の関数案の同種の問題の確認**: `list_my_room_memberships`・`leave_account_membership`・`touch_account_membership`・`list_account_members`はいずれも`language sql`(PL/pgSQLではない)であり、SQL言語の関数には「RETURNS TABLEの列名が本体内で変数として振る舞う」という仕組みが無いため、同じ種類の曖昧さは起きない。加えて、これらの引数名はすべて`p_account_id`のように`p_`を付けてテーブルの列名(`account_id`)と重ならないようにしており、本体内のSQLも常に`m.account_id`のようにテーブル別名で列を指定している。したがって`join_account_by_invite_token`以外には同じ問題は無いと確認した。

**BANとの関係(設計上の要点)**: `leave_account_membership`以外ではメンバー表の行を**BANでは削除しない**。`list_my_room_memberships`・`can_access_avatar_room_topic`等の「見える/入れるか」の判定側でBANを都度除外することで、「BANされた人の一覧からはそのルームを消す」「BANを解除したら戻る」の両方を、行を消さずに実現する。

---

## 4節 既存部分の変更方針

### 4-1. `*_by_invite_token`関数12個

**方針: 鍵を「トークンの一致」から「`account_members`への所属」に変える。** 具体的には、新しい関数を既存の関数と**並べて**作り(引数から`token text`を外し`auth.uid()`の所属だけで判定)、クライアント側をそちらに切り替えた後、古い`*_by_invite_token`版を削除する(本文書6節参照)。

- 旧: `where a.invite_token = token and not is_banned_for_account(a.id)`
- 新: `where exists (select 1 from account_members m where m.user_id = auth.uid() and m.account_id = a.id) and not is_banned_for_account(a.id)`

**12個のうち、どれをどうするかの一覧:**

| 旧(`*_by_invite_token`) | 新(トークン不要版) | 備考 |
|---|---|---|
| `lookup_account_by_invite_token(token)` | **変更不要・残す** | 未ログイン画面のOGP表示(`app/page.tsx`の`generateMetadata`)、および`join_account_by_invite_token`の中で、ログイン前・参加前の時点のトークン解決に使うため、今後も必要 |
| `list_rooms_by_invite_token(token)` | 新関数`get_own_or_member_room(p_room_id uuid)`に役割を統合(下記) | 継続的な呼び出し(LiveKit/Indigoトークン発行時のルーム確認)には使わなくなる |
| `list_chat_messages_by_invite_token` | `list_chat_messages_as_member(target_room_id, peer_user_id)` | |
| `send_chat_message_by_invite_token` | `send_chat_message_as_member(...)` | |
| `edit_chat_message_by_invite_token` | `edit_chat_message_as_member(...)` | |
| `delete_chat_message_by_invite_token` | `delete_chat_message_as_member(...)` | |
| `create_chat_group_by_invite_token` | `create_chat_group_as_member(...)` | |
| `list_chat_threads_by_invite_token` | `list_chat_threads_as_member(...)` | **既存の非招待版`list_chat_threads(p_room_id)`(`profiles.account_id`判定)とは別に新設する。** 新方式では「自分のルーム(owner)」だけが`profiles.account_id`経由の既存関数を使い、それ以外(今の「ゲスト」「viewOnly」の両方)は全員この新関数に統合されるため |
| `create_dm_mention_by_invite_token` | `create_dm_mention_as_member(...)` | |
| `set_chat_message_reaction_by_invite_token` | `set_chat_message_reaction_as_member(...)` | |
| `remove_chat_message_reaction_by_invite_token` | `remove_chat_message_reaction_as_member(...)` | |
| `list_chat_message_reactions_by_invite_token` | `list_chat_message_reactions_as_member(...)` | |

**サーバー(4-2)がメンバーかどうかを確かめる新関数の案:**

```sql
-- LiveKit/Indigoトークン発行で使う。自分のルーム(owner)・メンバー
-- (account_members)のいずれでもなければ0行。BAN中も0行。
create or replace function public.get_own_or_member_room(p_room_id uuid)
returns table (account_id uuid, template_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  select r.account_id, r.template_id
  from public.rooms r
  where r.id = p_room_id
    and (
      exists (
        select 1 from public.accounts a
        where a.id = r.account_id and a.owner_user_id = auth.uid()
      )
      or exists (
        select 1 from public.account_members m
        where m.user_id = auth.uid() and m.account_id = r.account_id
      )
    )
    and not public.is_banned_for_account(r.account_id);
$$;

revoke all on function public.get_own_or_member_room(uuid) from public;
revoke all on function public.get_own_or_member_room(uuid) from anon;
grant execute on function public.get_own_or_member_room(uuid) to authenticated;
```

この1関数が、`app/api/livekit-token/route.ts`・`app/api/indigo-token/route.ts`の「通常ルート(rooms RLS)→無ければviewOnly(`list_rooms_by_invite_token`)」という2段階のフォールバックを1回の呼び出しに置き換える(4-2参照)。

### 4-2. サーバー側

| 対象 | 変更方針 |
|---|---|
| `app/api/livekit-token/route.ts`・`app/api/indigo-token/route.ts` | 最終的には`inviteToken`パラメータを廃止し、4-1の`get_own_or_member_room(room_id)`だけを呼ぶ形にする。移行中(6節C段階)は、`get_own_or_member_room`が0行だった場合のみ旧`list_rooms_by_invite_token`(トークン)にフォールバックする、の順で両方を受け付ける |
| `app/api/chat/image-url/route.ts` | 同様に、最終的には`inviteToken`を廃止し、`list_chat_messages_by_invite_token`相当は4-1の`list_chat_messages_as_member`に差し替える。移行中は両方を受け付ける(通常→`as_member`→トークン、の順で試す) |
| `lib/joinAccountViaInvite.ts` | **3分岐(自分の招待URL/既に自分のアカウントを持つ=今のviewOnly/純粋なゲスト)をやめ、3-2(1)の`join_account_by_invite_token`を1回呼ぶだけにする。** 戻り値`is_own_account`が`true`(自分の招待URL)なら何もしない。`false`なら、**自分のルームを持っているかどうかに関係なく**(今のviewOnlyに当たる人もそうでない人も)`account_members`に載っており、メンバーとして入室する。`profiles`は一切更新しない。今のviewOnly分岐(`isOwnAccount: false, viewOnly: true`を返してトークンで入る経路)は、この段階で使われなくなる(型・コードそのものの削除は6節G段階) |
| `app/page.tsx`(`renderRoomJoin`/`renderViewOnlyRoomJoin`/`resolveUserRouteState`) | 「自分のアカウントを持っているか」(`accounts.owner_user_id`)と「`account_members`に1件以上あるか」を**別々に**取得し、どちらか一方でもあればカード一覧画面を表示する。`UserRouteState`の`type: "guest"`は廃止する(**4-4参照**) |
| `lib/accountProvisioning.ts`(`provisionAccountForUser`)・`accounts: insert own`ポリシー(2-1) | **判定を変える必要はない。** 「1人1ルーム」は`accounts.owner_user_id`のUNIQUE制約(`accounts_owner_user_id_key`、2026-11-18適用。6節参照)でDB側が既に守っているため、今の`profiles.account_id is not null`判定のままで、新方式のメンバー(`profiles.account_id`が空のまま)は今のとおりルームを作成できる |

### 4-3. 画面側(components/AvatarSpace.tsx、82か所)

`viewOnlyInviteToken`という「文字列のトークンを全箇所に引き回す」設計をやめ、**「自分のルームかどうか」を表す真偽値1つ(例: `isOwnRoom`)+ `roomId`/`accountId`**だけを引き回す形に変える。各分岐は次のように単純化される。

- チャット関連RPC: `isOwnRoom ? 通常のテーブル操作 : 4-1の新関数(トークン不要)`
- LiveKit/Indigo/画像URL: `inviteToken`を送らなくなる(サーバー側が`auth.uid()`と`roomId`から`account_members`を見て判定するため)
- ログアウト・退出後のリダイレクト先: 招待トークンを含む`/?invite=...`ではなく、入室画面(カード一覧)である`/`へ統一できる可能性がある(7節の未決事項)
- 「自分のルームへ」ボタン: `isOwnRoom`が`false`かつ自分のアカウントがある場合に表示(ロジックは変わらない)

**入室画面のURLの形**: 初回参加(招待URLを踏む)は現状どおり`/?invite=トークン`。カード一覧から選んで入室する場合は、トークンではなく**ルームID**で指定する形(案: `/?room={roomId}`)にする。カード一覧自体は`list_my_room_memberships()`(+自分のアカウントがあれば1件)から組み立てるため、毎回トークンを運ぶ必要がない。

### 4-4. `profiles.role`の扱い

`"guest"`は新方式では書き込まれなくなる。`"admin"`は持ち主判定(`accountProvisioning.ts`)に残るが、2-4の`requireVerifiedBillingAccount`・`authRouting.ts`の判定ロジックも「`role==="admin"`」のままで変更不要(持ち主の判定は`account_id`/`role`の組ではなく`accounts.owner_user_id`中心に寄せるのが望ましいが、本設計の範囲外。7節に記載)。

### 4-5. 「ルームを作成する」の流れ(/plan)

`app/plan/page.tsx:6-20`・`app/plan/actions.ts:17-47`・`lib/accountProvisioning.ts:29-41`をRead で確認した。現在のルーム作成画面は次の3段構えになっている。

1. `app/plan/page.tsx:17-20`: `resolveUserRouteState`の結果が`isMaster`→`/master`、`type==="admin"`→`/`、**`type==="guest"`→`/`** にリダイレクトする。`"no-account"`の場合だけこの画面(`CreateRoomStart`)が表示される。
2. 画面の「ルームを作成」操作は`app/plan/actions.ts:17-47`の`startFreeTrial()`を呼ぶ。
3. `startFreeTrial`は`lib/accountProvisioning.ts:29-41`の`provisionAccountForUser`を呼び、**「既に`profiles.account_id`がある場合は何もせず終了する(新規作成しない)」**で1人1ルームを強制している(`existingProfile?.account_id`の真偽だけを見る)。

**メンバー表に行がある人(他人のルームのメンバー)が自分のルームを作れるかの確認結果**: 上記1の`app/plan/page.tsx:20`の`state.type==="guest"`判定が、**今の「ゲスト」をこの画面に到達させないための壁になっている**。新方式では`account_members`は`profiles.role`を書き換えないため、`resolveUserRouteState`の`type`は`account_members`だけでは変わらない(`profiles.account_id`が無い限り`"no-account"`のまま)。したがって、**新方式のメンバー(`account_members`にだけ行があり、`profiles.account_id`は空)は、`"guest"`分岐を削除しなくても、そもそも`type`が`"no-account"`になるため今のままこの画面に到達できる。**

`app/plan/page.tsx:20`の`state.type==="guest"`判定自体は、入室画面を切り替える段階(6節の新しいE段階)で、`UserRouteState`の`"guest"`の廃止と**一緒に**外す(1節の決定どおり、`"guest"`という`type`自体が無くなるため、この行も当然不要になる)。

3の`provisionAccountForUser`の判定(`profiles.account_id is not null`)は、**変更不要**。1-1で確認したとおり「1人1ルーム」は`accounts.owner_user_id`のUNIQUE制約でDB側が既に守っており、新方式のメンバーは`profiles.account_id`が空のままなので、今の判定のままで正しく新規作成できる。既存のレガシーな`"guest"`(`profiles.account_id`が他人のアカウントに設定済み)については、**先にこの判定を緩めてはいけない**: `provisionAccountForUser`が実行されると`profiles.account_id`が本人の新しいアカウントに書き換わり、招待元のルームへの(`profiles.account_id`経由の)アクセスを同時に失ってしまうため(6節参照)。レガシーゲストが自分のルームを作れるようになるのは、6節の移し替え(新しいF段階)で`account_members`に移った後でよい。

---

## 5節 項目6(Realtime Authorization)への影響と直し方

2026-11-22に本番適用済みの部品への影響は次のとおり。

| 部品 | 影響 | 直し方 |
|---|---|---|
| `realtime_view_grants`・`grant_realtime_view_access` | viewOnly専用の30分許可証という設計自体が、`account_members`(TTLの無い恒久的な所属)に置き換わるため不要になる | 移行完了後(6節のG段階)に`drop table`/`drop function`する。移行中は**両方を残し**、`can_access_avatar_room_topic`・`can_message_user_channel`の判定にOR条件で両方を見る(過渡期の後方互換) |
| `can_access_avatar_room_topic()` | `profiles.account_id`判定(自分のルーム)はそのまま使える。`realtime_view_grants`判定を`account_members`判定に**追加**(削除はしない。6節参照)する | `exists(select 1 from realtime_view_grants ...) or exists(select 1 from account_members where user_id=auth.uid() and account_id=r.account_id)`をORで追加 |
| `can_message_user_channel(uuid)` | 送信者・宛先それぞれの「`mine`/相手」のUNION元に`account_members`を追加 | `realtime_view_grants`の`union`と並べて`account_members`も`union`する |
| `can_message_user_channel_topic()` | 変更不要(上位の`can_message_user_channel`を呼ぶだけ) | - |
| realtime.messagesの8ポリシー | 変更不要(関数を呼ぶだけ) | - |

**項目6の段階4以降の順番への影響**: 段階4(viewOnly側クライアントが`grant_realtime_view_access`を定期的に呼ぶ仕組み)は、新方式では「初回参加時に`join_account_by_invite_token`を1回呼ぶだけ」に置き換わり、**定期的なハートビート自体が不要になる**。段階5(方式Cのクライアントデプロイ)以降の「DMの通知のみチャンネル化」自体は、本設計(メンバー一覧表)とは独立した話のため、順番は変えなくてよい。段階7(全チャンネルの`private:true`化)の前提条件(`can_access_avatar_room_topic`等が正しく動くこと)に、本設計のテーブル・関数が含まれる点だけ追加で確認する。

---

## 6節 移行の段階分け

各段階は単独で本番に出せて、出す前・後のどちらの状態でも、すべての人(自分のルームの持ち主・移行前の古いゲスト・他人のルームを閲覧する持ち主〈viewOnly〉・新規に招待URLから来た人)が入れることを基本方針とする。

**「1人1ルーム」の判定は変更しない。** `supabase/consolidated_setup.sql:201-213`で、2026-11-18に`accounts.owner_user_id`へのUNIQUE制約が既に適用されている。

```sql
-- 1人の利用者が持ち主のアカウントは1件まで(2026-11-18追加)。
-- 同時に2回処理が走った場合の二重作成を防ぐ。
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.accounts'::regclass
      and conname = 'accounts_owner_user_id_key'
  ) then
    alter table public.accounts
      add constraint accounts_owner_user_id_key unique (owner_user_id);
  end if;
end $$;
```

「1人1ルーム」はこのDB制約で既に守られているため、`provisionAccountForUser`・`accounts: insert own`ポリシーの判定(`profiles.account_id is not null`)は変更不要(4-2・4-5参照)。新方式のメンバー(`account_members`にだけ行があり`profiles.account_id`は空)は、この判定のままで今のとおりルームを作成できる。逆に、この判定を先に`owner_user_id`基準へ緩めてしまうと、移行前の古いゲスト(`profiles.account_id`が招待元のまま)が`/plan`でルームを作成できるようになり、`provisionAccountForUser`が`profiles.account_id`を本人の新しいアカウントへ書き換えた瞬間に、招待元のルームへの(`profiles.account_id`経由の)アクセスを失ってしまう。そのため、前回案にあった「1人1ルームの判定の変更」段階は**削除した**。

| 段階 | 内容 | 確認方法 | 戻し方 |
|---|---|---|---|
| A | `account_members`テーブル・3-2の5関数・4-1の`*_as_member`関数10個・`get_own_or_member_room`関数を**すべて**DBに追加(新規追加のみ) | 既存動作に変化が無いこと(新しいテーブル・関数は誰からも呼ばれていない) | `drop table`/`drop function` |
| B | `can_access_avatar_room_topic`・`can_message_user_channel`に`account_members`判定をOR/UNIONで追加(5節)。**この時点で`realtime_view_grants`はそのまま残す** | 既存のviewOnly(`realtime_view_grants`)が従来どおり動くこと。`account_members`はまだ空なので新しい分岐は常にfalse | 追加したOR/UNION部分だけ戻す |
| C | **サーバー側(独立した段階)**: `app/api/livekit-token/route.ts`・`app/api/indigo-token/route.ts`・`app/api/chat/image-url/route.ts`を、「招待トークン」「`account_members`」の**両方**を受け付ける形に変更する(4-2のとおり、`get_own_or_member_room`等で先に確認し、無ければ旧トークン経路にフォールバック)。クライアントはまだ変更しない | 既存のクライアント(トークンを送る)が従来どおり動くこと。新しいクライアントが無いため`account_members`経路はまだ使われない | サーバーのコードを前の版に戻す(フォールバック元の旧経路は変えていないため安全) |
| D | **画面側(AvatarSpace、カード一覧への切り替えより前)**: `components/AvatarSpace.tsx`の82か所に、`account_members`に基づく経路(トークン不要)を**追加**実装する。既存の2経路のうち、**(i) 「通常(profiles.account_id)経路」は持ち主が自分のルームに入るための恒久的な経路であり、移行後もそのまま残り続ける**(4-3の「`isOwnRoom ? 通常のテーブル操作 : 4-1の新関数`」のとおり)。**(ii) 「viewOnly(招待トークン)経路」は、この移行でなくなる一時的な経路**で、段階Gで削除する。この2経路はいずれも残したまま、新しい経路を実装し終える(切り替えはまだしない)。**この段階では、カード一覧(E)がまだ無いため、新しい経路を試す入口が無い。そこで、「ルームIDを指定して、メンバーとして入る」入口(例: `/?room=ルームID`)を実装する。この時点ではまだ画面のどこからもリンクしない試験用の入口として置き、段階Eでカード一覧からのリンク先として正式に使う(入口のURLの形自体は段階Eでも変えない)。この入口は`get_own_or_member_room`で確認し、メンバーでも持ち主でもなければ入れない** | 既存の2経路(自分のルーム・viewOnly)が従来どおり動くこと。新しい経路は、試験用のメンバーの行を相談役が作るSQLをSQL Editorで実行して作り(本設計書にはテスト用SQLは書かない)、`/?room=ルームID`から実機で確認した後、作った行を消す | クライアントを前の版に戻す(`/?room=ルームID`の実装も含めて戻る) |
| E | **入室参加・入室画面の切り替え**: `lib/joinAccountViaInvite.ts`を4-2のとおり書き直し(`join_account_by_invite_token`を1回呼ぶだけにし、今のviewOnly分岐〈トークンで入る経路〉は使わなくなる)、`app/page.tsx`・`lib/authRouting.ts`をカード一覧画面(自分のアカウント+`account_members`)に切り替える。`app/plan/page.tsx:20`の`state.type==="guest"`リダイレクトも、`UserRouteState`の`"guest"`の廃止と**一緒に**この段階で外す(4-5参照)。Dで実装済みのため、この時点で新規参加者・viewOnly相当の人は全員、トークン無しで動く経路にそのまま乗る。**移行期間中(Fを実行するまで)に限り、カード一覧の取得処理に「`profiles.role='guest'`の人は、`profiles.account_id`が指すルームも(まだ`account_members`に無くても)1枚のカードとして追加で出す」特例を入れる(入室自体は今の通常ルート=`profiles.account_id`経由のまま)。この特例カードには「一覧から外す」のメニューを**出さない**(`account_members`に行が無く、`leave_account_membership`を呼んでも0行削除になり何も起きないため)。段階Fで移し替えた後は、通常のカード(`account_members`経由)として「一覧から外す」が使えるようになる** | 新規に招待URLを踏んだ人が、所属先を書き換えられずに`account_members`経由でカードに現れ、入室できること。**既存の(まだ移し替えていない)ゲストも、上の特例により自分の元のルームがカードに出て、入室できることを確認する。特例カードに「一覧から外す」メニューが出ないことも確認する。自分のルームを持つ人が他人の招待URLを開くと、`account_members`に載り、カード一覧に自分のルームとそのルームの両方が出て、どちらにも入室できることを確認する。** 段階Eより前にviewOnlyで他人のルームを見ていた人は、`account_members`に記録が無い(今のviewOnlyはそもそも記録を残さない仕組みのため)。**段階Eの後に、もう一度その招待URLを開けば一覧に載る**、という扱いにする(Fの移し替えの対象にはできない。今この状態にあるのはテスト用アカウントだけであることを確認する) | クライアント(`app/page.tsx`・`lib/authRouting.ts`・`lib/joinAccountViaInvite.ts`)を前の版に戻す(DBは両対応のままのため問題ない) |
| F | **既存ゲストの移し替え**: 既存の`profiles.role='guest'`な行を対象に、`account_members(user_id, account_id, joined_at, last_accessed_at)`を`(user_id, account_id, last_login_at, last_login_at)`で作成する一括SQLを実行し、**同じトランザクション(または直後)**で対象の`profiles.account_id`/`role`を`null`に戻す | Eの時点で「`profiles.role='guest'`の人向けの特例表示」が既にカード一覧に実装・本番適用済みのため、この移し替え(F)を**Eより後のどのタイミングで実行しても**、対象ユーザーは移し替えの前は特例表示経由、移し替えの後は`account_members`経由で、**途切れずに同じルームへ入室できる**ことを確認する | 作成した`account_members`行を削除し、`profiles.account_id`/`role`を元の値に戻す(移行前にバックアップを取る) |
| G | 古い仕組みを削除する: `*_by_invite_token`関数群のうち4-1で不要になった10個・`profiles.role='guest'`書き込み経路(既に使われていない)・`realtime_view_grants`/`grant_realtime_view_access`・`can_access_avatar_room_topic`/`can_message_user_channel`の`realtime_view_grants`分岐・サーバー側(C)のトークンフォールバック・**AvatarSpace(D)の「viewOnly(招待トークン)経路」(一時的な経路)のみ**・**`lib/joinAccountViaInvite.ts`の今のviewOnly分岐の名残(Eの時点で使われなくなった`isOwnAccount`/`viewOnly`等の戻り値・型)**・**`app/page.tsx`の`renderViewOnlyRoomJoin`など、トークンで入るviewOnly専用の入室処理**・**Eで入れた「`profiles.role='guest'`向けカード特例表示」**(Fの完了後は対象が0件になっているはずだが、コードごと削除する)。**「通常(profiles.account_id)経路」(持ち主が自分のルームに入る恒久的な経路)と、カードからルームIDで入る正式な入口(`/?room=ルームID`、段階Eで使うもの)は、削除しない。** | 削除前に、該当する古い関数・経路・特例表示・viewOnly専用処理への呼び出しが0件になっていることをログ/コードで確認する。**削除後、持ち主が自分のルームに(「通常経路」のまま)入れることを必ず確認する** | 削除したSQL・コードを戻す(段階ごとの戻しSQLを用意しておく) |

### 6-1. 各段階の前後で、4種類の人が入れるかの確認

| 段階 | 時点 | 持ち主 | 移行前の古いゲスト | viewOnly(他人のルームを閲覧する持ち主) | 新規に招待URLから来た人 |
|---|---|---|---|---|---|
| (移行前) | 現状 | ○ rooms RLS | ○ profiles.account_id経由 | ○ 招待トークン(`realtime_view_grants`含む) | ○ `joinAccountViaInvite`が`profiles`書き換え(1節の2問題あり) |
| A | 前/後 | ○ 変化なし | ○ 変化なし | ○ 変化なし | ○ 変化なし(DB追加のみ、誰も呼ばない) |
| B | 前/後 | ○ 変化なし | ○ 変化なし | ○ 変化なし(`realtime_view_grants`は無傷) | ○ 変化なし(`account_members`は空) |
| C | 前/後 | ○ 変化なし | ○ 変化なし | ○ 変化なし(トークンfallbackのまま) | ○ 変化なし(クライアント未変更) |
| D | 前/後 | ○ 変化なし | ○ 変化なし | ○ 変化なし | ○ 変化なし(新経路は隠し入口のみ、実利用者は旧経路) |
| E | 前 | ○(Dと同じ) | ○(Dと同じ) | ○(Dと同じ) | ○(Dと同じ) |
| E | 後 | ○ カード一覧に自分のルーム表示 | ○ 特例表示で`profiles.account_id`経由のカードが出て入室できる | **○ `join_account_by_invite_token`経由で`account_members`に載る形に変わる(4-2参照)。ただし段階Eより前からトークンだけで見ていた人(本番にはいない。テスト用アカウントのみ)は記録が無いため、Eの後に招待URLをもう一度開く必要がある** | ○ `join_account_by_invite_token`経由で`account_members`に載り、Dの新経路で入室 |
| F | 前 | ○(Eと同じ) | ○(Eと同じ、未移行なら特例表示) | ○(Eと同じ) | ○(Eと同じ) |
| F | 後 | ○ 変化なし | ○ `account_members`経由に切り替わるが、同じルームに途切れず入室できる | ○ 変化なし | ○ 変化なし |
| G | 前 | ○(Fと同じ) | ○(Fと同じ) | ○(Fと同じ) | ○(Fと同じ) |
| G | 後 | ○ 変化なし(通常経路は削除しないため) | ○ 変化なし(全員`account_members`経由、特例表示は0件で削除済み) | **○ Eの時点で既に`account_members`経由になっているため、`realtime_view_grants`を削除しても影響しない** | ○ 変化なし |

---

## 7節 まだ決まっていないこと・確認が必要なこと

- 「一覧から外す」操作の確認UI(確認ダイアログの文言等)
- ログアウト後のリダイレクト先を`/?invite=...`から`/`に統一できるかどうかの最終確認(4-3末尾)
- `profiles.role`列自体を将来的に削除するか、使わないまま残すか
- `account_members`・関数名(`account_members`・`join_account_by_invite_token`・`*_as_member`等)は案であり、実装時に変える可能性がある
- **運営者(is_master)の入り方**: 今は「/」を開くと`/master`に移り(`app/page.tsx:430`)、自分のルームには`/master`画面の「ルームへ」リンクから、自分自身の招待URL(`/?invite=トークン`)経由で入っている(`lib/joinAccountViaInvite.ts:9-14`のコメント参照)。カード一覧画面ができた後、運営者が「/」を開いた時にカード一覧を見せるのか、従来どおり`/master`優先のままにするのか、「ルームへ」の行き先をカード一覧に変えるのかは未決定

---

## 8節 テストの観点

### 8-1. なりすましテスト(SQL Editor)

- 他人の招待トークンで、自分を`account_members`に追加できない(トークン不一致)ことの確認
- 自分が持ち主のアカウントの招待URLを使っても`account_members`に行が増えないこと
- BAN中は`join_account_by_invite_token`がエラーになり、行が増えないこと
- `list_my_room_memberships()`がBAN中のアカウントを返さないこと、BAN解除後に再び返すこと(行を削除していないことの確認)
- `list_account_members(account_id)`が、持ち主以外(メンバー本人・無関係な人)からは呼べない、または空になることの確認
- `leave_account_membership`が自分の行しか消せないことの確認

### 8-2. アプリで確かめること

- 複数ルームのメンバーになった状態で、カード一覧の並び順(自分のルームが先頭、以後最終アクセス日時の新しい順)
- 招待URLの再発行後、新しい人はそのURLで入れない/既存メンバーは入り続けられることの実機確認
- 「一覧から外す」操作後、再入室には有効な招待URLが必要になることの確認。移行期間中(6節E〜F)は、`profiles.role='guest'`向けの特例カードには「一覧から外す」のメニューが出ないことも確認する
- 持ち主が管理者向けモーダルでメンバー一覧を見られ、BAN操作と連動することの確認
- 人数上限(入室中人数)が従来どおり働くこと(メンバー数では制限されないこと)
- チャット・DMがルームをまたいで表示されないこと(従来どおり)
