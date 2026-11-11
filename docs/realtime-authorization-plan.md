# Realtime Authorization 導入計画(設計のみ・未適用)

2026-11-09時点の調査・設計をまとめたもの。**この文書自体、ここに記載したSQL・コードはいずれも未適用。** 本番への反映は、各段階ごとにユーザーの明示的な承認を得てから行う([[feedback_git_deploy_workflow]]の標準ワークフローに従う)。

## 要約(詳細は本文参照)

- **未検証事項(9-2)**: ①「Allow public access」オフ時、既存接続中の古いタブが即座に切断されるか/②viewOnly許可証TTL(30分)の運用上の適切性。
- **既知の制約(9-3)**: 招待リンク再発行は既発行の許可証を即時失効させない/`can_message_user_channel`で任意user_idの同アカウント所属を探索できる/宛先のBAN状態は見ていない。
- **接続中BANの限界**: 権限評価はトークンの更新・失効時にも再判定されるため、改造クライアントが受信を続けられるのは最長でもJWTの有効期限まで(現在の有効期限は要確認)。
- **古いタブの検知手段が無い**: 段階9の前に、`private:true`未対応の古いタブが残っていないか確認する仕組みが現状無い(段階0として新設。6節参照)。

## 背景

施錠会議室の音声・映像・字幕の傍受調査の過程で、チャット・DM本文・presence(位置・実userId・施錠会議室の在室情報)・画面共有サムネイルが、**すべて公開(無認可)のSupabase Realtimeチャンネル`avatar-room-{roomId}`にそのまま流れている**ことが判明した(2026-11-09確認)。ログインしていない第三者でもroomIdが分かれば受信できる。

対応方針:
- **Realtime Authorization**(Supabase公式の`private`チャンネル + `realtime.messages`へのRLSポリシー)で、未ログインの第三者・無関係なアカウントのユーザーを遮断する。
- **方式C**(利用者ごとの専用受信チャンネル`user-{userId}` + 通知のみ + DBから本文取得)で、DM・グループDMの「誰が誰と話しているか」というメタデータ自体も、同室の無関係な第三者(＝そのルームのメンバーではあるが宛先ではない人)から守る。
- 字幕(`caption`)は対象外。本文書(Realtime Authorization)が守るのは「ルームの無関係な部外者からの保護」のみ。**2026-11-11訂正:** 当初この節で「字幕は受信側がゾーン判定せずに表示しているだけ」と記載していたが、これは本ブランチが`fix/caption-zone-filter`(`6267afb`/`d1dbd0e`、2026-11-10に`main`へマージ・本番確認済み)を含まない古いコードを見ていたための誤りだった。実際には受信側で`eligiblePeerIdsRef.current.includes(msg.senderId)`によるゾーン(近接・施錠ゾーンの隔離を含む)チェックが既に入っており、通常のクライアントでは同じルームの別会議室の字幕は表示されない(2026-11-10本番確認済み)。**残る既知のギャップ**は、このチェックがクライアント側JSのみで行われサーバー側の検証が無いこと(送信者が`meetingZoneId`を自己申告で偽れば回避できる、課題リストの既存項目と同じ)。

**これとは別の、送信側に起因する漏れ(2026-11-11確認):** 録画対象の判定(`sameConferenceRoomAsRecorder`、`components/AvatarSpace.tsx:9118-9158`)が「録画開始者と同じ特定の会議室か」ではなく「録画開始者か、どこかの会議室系ゾーンにいるか」という粗い判定であるため、**どこかの会議室で録画が始まると、施錠中の別会議室にいる人の発言も送信側で文字起こしされ、`caption`としてルーム全員に配信されてしまう。** 受信側の`eligiblePeerIds`チェックはブラウザのJS側の処理でしかないため、同じアカウントのメンバーが改造クライアント(このチェックを単に無視するもの)を使えば、**位置(`meetingZoneId`)を偽る必要すら無く**このcaptionを読むことができる。この送信側の粗い判定が無ければ、録画していない会議室の発言はそもそも配信されないため、これは「`meetingZoneId`の自己申告・サーバー側検証なし」という上記の問題の一部ではなく、**別の経路の漏れ**である。副次的に、関係ない会議室の参加者のPC上で不要な音声認識パイプラインが動く(CPU・バッテリーの無駄)という性能面の影響もある。

この根本対応は別途「第2段階(WSサーバー経由でゾーンをサーバー側判定)」にまとめて含める方針(詳細は[[project_globy_indigo_position_ws]])。

---

## 1. チャンネル一覧(現状)

| チャンネル名 | 用途 | 現状の保護 |
|---|---|---|
| `avatar-room-{roomId}` | 位置同期・presence・チャット・DM・字幕・施錠・画面共有・強制退出 | なし(公開) |
| `user-session-{userId}` | 同一アカウントの多重ログイン検知・強制ログアウト通知 | なし(公開。ただしpayloadは不透明なトークンのみで低機密) |
| `user-{userId}`(方式C、新設) | DM・グループDM等の「通知のみ」配信 | 新設時から`private: true`で作る(後述) |

---

## 2. 方式Cの設計

### 2-1. 概要

- 各利用者はログイン中、自分専用チャンネル`user-{自分のuserId}`を1つだけ購読する(ルームの滞在に関係なく、ログイン中は常に1つ。会話相手が何人いても増えない)。
- DM送信時、送信者は**宛先ユーザーの**専用チャンネル(`user-{recipientUserId}`)に送る。グループDMはメンバーそれぞれの専用チャンネルに1件ずつ送る(fan-out)。
- リアクション・グループ作成・メンション通知も方式Cに含める(いずれも宛先が1人または少数に決まるため相性が良い)。
- **payloadには本文を乗せず、メッセージID・種類(type)・関連ID(groupId等)のみ**を乗せる。本文・送信者名・送信者IDは一切含めない。

```json
{ "type": "dm" | "group-dm" | "dm-edit" | "dm-delete" | "reaction" | "group-created" | "group-renamed" | "mention", "messageId": "...", "groupId": "..." }
```

**注:** ここでの`"reaction"`は方式C(新設の`user-channel`通知)における呼び名であり、avatar-room上の既存の`dm-reaction`/`group-reaction`という2つの別イベント自体の名前を変えるものではない(段階6で削除されるまでは両者とも既存のまま残る)。`groupId`の有無でDM/グループのどちらのリアクションかを区別する。

- 受信側は通知を受けたら`chat_messages`等をRLS経由でSELECTして本文を取得する。これにより、**payload上の送信者偽装は意味を持たなくなる**(表示に使うのはDBから取得した値のみ。DB側のINSERT時RLSで`sender_user_id = auth.uid()`が強制されているため、DBの値は偽装できない)。

### 2-2. 3方式の比較(A: 通知のみ+単一チャンネル、B: チャンネルをDM単位に分割、C: 利用者ごとに1本)

| 観点 | A | B | C(採用) |
|---|---|---|---|
| チャンネル数/人 | 1本(既存のまま) | 会話相手の数だけ増える | 常に1本 |
| 変更量 | 小 | 大(チャンネルの動的管理が必要) | 中 |
| 「誰が誰と話しているか」の秘匿 | 守れない | 守れる | 守れる |
| 遅延 | 通知受信後にDB取得の往復が1回増える | 本文を乗せるなら往復なし | Aと同じ(往復1回) |
| Freeプランのチャンネル数上限への影響 | 影響なし | 会話相手が多い利用者ほど、1接続100チャンネル上限に近づく | 影響ほぼなし(常に1本) |

### 2-3. avatar-room上の全16イベントの分類(2026-11-11調査・rebase後に再確認、`components/AvatarSpace.tsx:6258〜6723`)

| イベント | 内容 | 方針 | 備考 |
|---|---|---|---|
| move | 座標・見た目 | avatar-roomに残す(段階7で保護) | `POSITION_TRANSPORT!=="indigo"`の時のみ使うフォールバック経路。indigoへの完全移行後の廃止は本書の対象外 |
| layout-update | 障害物・会議ゾーン・ワープ地点 | avatar-roomに残す(段階7で保護) | 個人情報なし |
| screen-preview | 画面共有サムネイル(dataUrl)+送信者id | avatar-roomに残す(段階7で保護) | **zoneId判定が一切無く、room全体に届く**(screen-share-claimと異なる)。captionには`fix/caption-zone-filter`で受信側のゾーンチェックが入ったが、screen-previewには同種のチェックが無い。部外者保護は段階7で足りるが、同室・別会議室間の漏れは未対応(課題リストに追記、下記参照) |
| screen-share-claim | peerId・zoneId・claimedAt | avatar-roomに残す(段階7で保護) | 受信側でzoneId一致を確認済み |
| conference-lock-change | peerId・zoneId(施錠先行通知) | avatar-roomに残す(段階7で保護) | 正式な状態はpresence側 |
| dm | DM本文 | 方式Cへ移行 | 段階5→6 |
| group-dm | グループDM本文 | 方式Cへ移行 | 段階5→6 |
| dm-edit | DM編集後本文 | 方式Cへ移行 | 段階5→6 |
| dm-delete | DM削除通知(本文なし、送信者・宛先id) | 方式Cへ移行 | 段階5→6 |
| dm-reaction | reactor・宛先id | 方式Cへ移行 | 段階5→6。新notificationでは`type:"reaction"`に統合(2-1節注記参照、コード上のイベント名は変えない) |
| group-reaction | reactor・groupId | 方式Cへ移行 | 同上 |
| group-created | メンバーuserId一覧 | 方式Cへ移行 | 段階5→6 |
| group-renamed | groupId・新名称 | 方式Cへ移行 | group-createdと同じ理由で方式Cが必要 |
| mention | 対象userId一覧 | 方式Cへ移行 | 段階5→6 |
| caption | 字幕本文 | 対象外 | 第2段階でまとめて対応(背景参照) |
| force-leave | targetId・reason | avatar-roomに残す(段階7で保護) | 退出した事実はpresenceで元々room内に見えるため、方式C化の実益は乏しい |

---

## 3. viewOnly許可証の設計

viewOnly(既に自分のアカウントを持つ人が他人の招待URLを一時閲覧する機能)は`profiles.account_id`を書き換えない設計のため、通常の「アカウントメンバーか」という判定だけでは引っかからない。**招待トークンの検証に成功した時だけ、短期間(30分)の「閲覧許可証」を発行するテーブル+RPCを新設する。**

```sql
create table if not exists public.realtime_view_grants (
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  expires_at timestamptz not null,
  primary key (user_id, account_id)
);
alter table public.realtime_view_grants enable row level security;
create policy "realtime_view_grants: select own"
  on public.realtime_view_grants for select
  using (user_id = auth.uid());

create or replace function public.grant_realtime_view_access(token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  select a.id into v_account_id
  from public.accounts a
  where a.invite_token = token;
  if v_account_id is null then
    raise exception '無効な招待リンクです';
  end if;

  -- BANされている場合は許可証を発行しない。
  if public.is_banned_for_account(v_account_id) then
    raise exception 'このルームへのアクセスが制限されています';
  end if;

  insert into public.realtime_view_grants (user_id, account_id, expires_at)
  values (auth.uid(), v_account_id, now() + interval '30 minutes')
  on conflict (user_id, account_id) do update set expires_at = excluded.expires_at;
end;
$$;

revoke all on function public.grant_realtime_view_access(text) from public;
revoke all on function public.grant_realtime_view_access(text) from anon;
grant execute on function public.grant_realtime_view_access(text) to authenticated;
```

クライアント側は、viewOnly開始時+一定間隔(例: 20分おき)でこのRPCを呼び直す(ハートビート)。

**viewOnlyのDMへの対応(方式Cとの統合):** viewOnlyの人も`send_chat_message_by_invite_token`/`list_chat_messages_by_invite_token`経由でDMを使う。`user-channel`への送信許可は「送信者・宛先のいずれも、通常メンバー(`profiles.account_id`)または有効な許可証(`realtime_view_grants`)を通じて、同じアカウントに関わっているか」で判定する(4-3参照)。

---

## 4. 全ポリシー・ヘルパー関数のSQL(最終版、修正反映済み)

### 4-1. ヘルパー関数

```sql
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
```

### 4-2. avatar-room(presence・broadcast)

```sql
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
```

### 4-3. user-session(多重ログイン検知)

```sql
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
```

### 4-4. user-channel(方式C)

**2026-11-09修正: トピックの正規表現を正式なUUID形式(8-4-4-4-12桁の16進数)に厳密化した。** ハイフンのみの文字列等が誤って一致しないようにする。

```sql
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
```

### 4-5. 全ポリシーのextension・トピック絞り込み一覧(確認済み)

| ポリシー | extension | トピックの絞り込み | リスク |
|---|---|---|---|
| avatar-room: presence access | presence | 文字列比較(キャストなし) | 安全 |
| avatar-room: presence send | presence | 同上 | 安全 |
| avatar-room: broadcast access | broadcast | 同上 | 安全 |
| avatar-room: broadcast send | broadcast | 同上 | 安全 |
| user-session: select own | broadcast | 文字列比較 | 安全 |
| user-session: insert own | broadcast | 文字列比較 | 安全 |
| user-channel: select own | broadcast | 文字列比較 | 安全 |
| user-channel: insert same account | broadcast | CASE式でUUID形式を確認後にキャスト | 修正済み・安全 |

---

## 5. 運営者(is_master)の権限

- **presence SELECTのみ許可**(在室人数等の閲覧)。`avatar-room: presence access`にOR条件として追加。
- **presence INSERT・broadcast SELECT・broadcast INSERTのいずれにも含めない**(運営者はチャット・字幕・位置等を一切閲覧・送信できない)。
- `can_access_avatar_room_topic()`自体にはis_masterを含めていない(含めるとbroadcast send等、共有している他のポリシーにも意図せず波及するため)。
- `app/admin/OnlineCount.tsx`・`app/master/MasterOnlineStats.tsx`はいずれも`channel.track()`を呼ばない観測専用のため、presence INSERT権限は不要(確認済み)。

---

## 6. 本番反映の手順(段階1〜10)

| 段階 | 内容 | 確認項目 | 切り戻し方法 |
|---|---|---|---|
| 0 | 新しい版のデプロイを検知し、古い(未リロードの)タブを自動的に再読み込みさせる仕組みを導入する(概要のみ。実装は別途) | 既存ユーザーの操作を妨げない形で動作すること | 導入したコードを戻す(他段階と独立) |
| 1 | 項目5のSQL(BANチェック)適用 **(適用済み・2026-11-10本番確認済み。[[project_globy_task_list]]参照)** | BANされた人がチャットに触れなくなること。Realtimeには無関係 | 項目5の戻しSQL |
| 2 | `realtime_view_grants`テーブル・`grant_realtime_view_access`関数を追加 | 新規追加のみ、既存機能に影響なし | `drop table`/`drop function`(新規追加のみのため安全) |
| 3 | 4節の全ポリシー・ヘルパー関数をDBへ追加(**user-channel用ポリシーもここに含める**。方式Cのクライアントデプロイ〈段階5〉より前に必要) | まだクライアントは`private:true`を送っておらず、「Allow public access」もONのままなので無影響であること | ポリシー・ヘルパー関数をdrop |
| 4 | viewOnly側のクライアントコードで、viewOnly開始時+一定間隔で`grant_realtime_view_access`を呼ぶように変更・デプロイ | 新しい関数呼び出しが追加されるだけで既存動作に変化がないこと | コードを前の版に戻す |
| 5 | 方式Cのクライアントコード(`user-{userId}`チャンネルの購読・通知payloadの縮小・DB取得)をデプロイ。**この間、方式Cへ移行する9イベント(`dm`/`group-dm`/`dm-edit`/`dm-delete`/`dm-reaction`/`group-reaction`/`group-created`/`group-renamed`/`mention`)はすべて残し、新方式と両方送る(dual-write)。新コードの受信側はid基準で重複除去する(現状未実装のため、このタイミングで追加実装する)** | 新旧クライアント混在でも二重表示・二重カウントが起きないこと | コードを前の版に戻す(方式Cの通知だけ届いて本文が出ない状態に戻るため、問題があれば段階5全体を戻す) |
| 6 | 旧来のbroadcast送信のうち、**方式Cへ移行した9イベント**(`dm`/`group-dm`/`dm-edit`/`dm-delete`/`dm-reaction`/`group-reaction`/`group-created`/`group-renamed`/`mention`)をすべて削除する(**`caption`は対象外。第2段階まで現行のまま**) | 新コードのみで本文がDB経由で正しく表示されること | コードを前の版(段階5相当)に戻す |
| 7 | **avatar-room・user-sessionの全チャンネルを一斉に`private:true`化**(対象ファイルは7節参照)。メンテナンスモードで全員退出させてから実施 | 7節のチェックリスト参照 | クライアントを前の版に戻す(「Allow public access」はまだONのため即座に旧挙動へ復帰) |
| 8 | viewOnlyの動作確認 | 8節の手順で、メンテナンスモードを一旦OFFに戻して確認用アカウント・ゲスト・viewOnlyで実機確認 | 問題があればメンテナンスモード再ON→段階7の切り戻し |
| 9 | 「Allow public access」をオフにする(独立した手順) | 全クライアントが`private:true`済みであること。古いタブ(未リロード)が残っていないか | 「Allow public access」を再度ONに戻す(即座に旧挙動へ復帰) |
| 10 | 最終動作確認(通常メンバー・ゲスト・viewOnly・マスター画面それぞれ) | 位置同期・チャット・DM・presence・マスター画面の閲覧専用動作。**未ログイン(anonキー)での購読が拒否されることも確認** | 段階9の切り戻し |

### 6-1. 段階5の並行送信(dual-write)中の整合性(2026-11-11確認、rebase後の送信側コードで再確認)

**前提確認:** 送信側コード(`components/AvatarSpace.tsx:3029〜3731`付近、dm/group-dm/group-created/group-renamed/group-reaction等)を確認した結果、旧方式のbroadcast payloadの`id`は、直前に行われるDB INSERTの結果(`data.id`、DBの主キー)そのものである。したがって新方式(DB取得)との重複除去は同じid値の比較で成立する(追加のマッピング不要)。

**方式Cの通知送信タイミング:** 確認した全ての送信箇所で「DB保存成功 → その結果を使ってbroadcast送信」の順序が徹底されている。方式Cの新しい通知も同じ順序(**DBへの保存が成功した後にのみ送信する**)を踏襲すること。先に通知が届くと、受信側が本文をまだ取得できない空振りになる。

| イベント | 旧方式の受信側の処理 | 旧・新が両方届いた場合 | 対策の要否 |
|---|---|---|---|
| dm | payloadの内容をそのままスレッドへ追加 | **id基準の重複除去が無いと、同じメッセージが2回表示される** | 必要(段階5に記載済み、このタイミングで実装) |
| group-dm | 同上 | 同上 | 必要(段階5に記載済み) |
| dm-edit | 対象メッセージをidで特定しmessage/editedAtを上書き | 同じ値を2回上書きするだけ(idempotent) | 不要 |
| dm-delete | 対象メッセージをidで除去 | 既に無いものを除去するだけ(idempotent) | 不要 |
| dm-reaction | reactorの既存リアクションを除去→現在のemojiを追加(emoji=nullなら除去のみ)という絶対値への置き換え | 同じ最終状態に収束する(idempotent) | **設計上の注意**: 新方式側の実装も「現在の状態に置き換え」であることが前提。相対的な+1カウントのような実装にすると二重カウントの危険がある |
| group-reaction | 同上 | 同上 | 同上 |
| group-created | `myGroupIdsRef`へid追加+一覧再取得トリガー | Setへの追加・再取得トリガーはいずれもidempotent | 不要(余分な再取得が起きるだけ) |
| group-renamed | 対象グループのthreadNameを上書き、またはトリガーのみ | 同じ値への上書き・再取得はidempotent | 不要 |
| mention | 一覧再取得トリガーのみ | 再取得トリガーはidempotent | 不要 |

「付け外しが2回起きて元に戻る」ような問題が起きないのは、現在の`dm-reaction`/`group-reaction`がトグルではなく「reactorの現在の状態をemoji値で明示する」設計だからである。方式C側の新しい通知ハンドラを実装する際も、この「絶対値による置き換え」の性質を保つこと。

---

## 7. 段階7で`private:true`に切り替える対象ファイル一覧

行番号は2026-11-11時点のもの。本ブランチを`origin/main`へrebase(2026-11-11、`fix/caption-zone-filter`等14コミットを取り込み)した上で再確認済み。

| ファイル:行 | 対象チャンネル | クライアント種別 | 変更内容 |
|---|---|---|---|
| `components/AvatarSpace.tsx:6097` | avatar-room(メイン入室後) | セッションクライアント | `config: { private: true, presence: {...} }` |
| `components/AvatarSpace.tsx:10746` | avatar-room(入室前ロビー人数プレビュー) | セッションクライアント | 同上 |
| `app/admin/OnlineCount.tsx:50` | avatar-room(管理画面在室人数) | セッションクライアント | 同上 |
| `app/master/MasterOnlineStats.tsx:54` | avatar-room(マスター画面在室人数) | セッションクライアント | 同上 |
| `app/admin/actions.ts:104`(force-leave等) | avatar-room | セッションクライアント(管理者自身) | 同上 |
| `app/admin/actions.ts:266`(kickParticipant) | avatar-room | セッションクライアント(管理者自身) | 同上 |
| `lib/broadcastForceLeave.ts:23` | avatar-room | **service_roleクライアント** | 同上。9-1節で検証済み(service_roleはRLSをバイパスするため追加対応不要) |
| `lib/useSessionGuard.ts:88` | user-session | セッションクライアント | `config: { private: true }` |
| `components/auth/LogoutButton.tsx:35` | user-session | セッションクライアント | 同上 |
| `deploy/livekit/monitor/check-load-score.mjs:82` | avatar-room(負荷監視cron) | secretキー(service_role相当) | `config: { presence: {...}, private: true }` |

これらは**全部同じデプロイで一斉に切り替える**(1つでも古いまま残ると、そのチャンネルだけ新しいprivateチャンネルと分断される。Realtime公式ドキュメントで「privateチャンネルとpublicチャンネルは同じトピック名でも別物として扱われ、互いにメッセージを交換しない」ことを確認済み)。

**`check-load-score.mjs`は上記の「同じデプロイで一斉に切り替える」対象外の例外である。** このスクリプトはVercel(mainへのマージ)では配信されない。**VPS上での実行実態(配置先・定期実行の有無)は確認中。**

**いつ反映するか:** 9-1節で検証済みなのは、**service_role相当のキーによる送信(REST経由のbroadcast、`lib/broadcastForceLeave.ts`と同じ方式)がRLSをバイパスすること**のみ。このスクリプトは在室状況(presence)の**購読**(WebSocket経由)であり、`private:true`化後にservice_role相当のキーで購読が通るかは**別途未検証**。そのため、反映時は以下を徹底する。
1. `private:true`化を反映した後、**1回手動実行し、通常時と同様の人数(負荷スコア)が取得できることを確認する**。
2. 確認が取れるまでは古い(`private:true`を送らない)コードのまま保留してもよい(段階9より前に確認・反映できていれば問題ない)。

遅くとも段階9(Allow public accessオフ)より前に完了していればよい(未対応のままAllow public accessがオフになると、このスクリプトは動かなくなる)。

**反映手順の概要(WSサーバーと同じ方式に統一、git pullは使わない。ローカルはGit Bash・GNU tarを想定):**
1. VPS上の既存ディレクトリを日付付きで**コピー**してバックアップ(`mv`ではなく`cp -r`。`.env`を含むディレクトリ全体を複製するだけで、元の場所には何も残さない`mv`だと新しいフォルダに`.env`が無くなり動かなくなるため): `cp -r ~/<配置先>/monitor ~/<配置先>/monitor.bak.$(date +%Y%m%d%H%M%S)`(配置先は質問1で確認)
2. ローカル(Git Bash、GNU tar)で更新後のコードをtar化。**`--exclude`はまとめる対象より前に書く**(後ろに書くと無視される場合があるため確実な方で統一する): `tar --exclude='monitor/node_modules' --exclude='monitor/.env' -czf monitor-update.tar.gz -C deploy/livekit monitor`
3. **転送前に、アーカイブの中身を一覧表示して`.env`・`node_modules`が含まれていないことを確認する**(含まれていたら転送しない): `tar -tzf monitor-update.tar.gz`
4. `scp monitor-update.tar.gz ubuntu@<VPS>:~/`で転送
5. VPS上で**既存フォルダへ上書き展開**(`.env`・`node_modules`は除外されているため、既存のものがそのまま残る): `tar -xzf ~/monitor-update.tar.gz -C ~/<配置先>/`
6. **展開後、`.env`が残っていることを確認(中身は表示しない)**: `ls -la ~/<配置先>/monitor/.env`
7. 転送した`monitor-update.tar.gz`をVPS・ローカルの両方から削除
8. 上記「いつ反映するか」の手動実行確認を行う。再起動は不要(cron起動のたびに新しいプロセスが立つスクリプトのため)

---

## 8. メンテナンスモードの使い方(段階7)

`app_settings.maintenance_enabled`がONの間、`components/AvatarSpace.tsx:10849`の`maintenanceBlocking = isMaintenanceActive(maintenance) && !isMaster`により、**運営者(is_master)だけが入室でき、通常アカウント・ゲスト・viewOnlyはすべてブロックされる**(確認済み)。

したがって、段階7直後に通常アカウント・ゲスト・viewOnlyで確認するには、メンテナンスモードをONのままにはできない。以下の順で行う。

1. メンテナンスモードON → 全員退出を確認 → `private:true`のクライアントをデプロイ(段階7本体)。
2. メンテナンスモードを一旦OFFに戻す(通常アカウント・ゲスト・viewOnlyが入室できる状態に戻す)。
3. 低トラフィックな時間帯であることを前提に、確認用の通常アカウント・ゲスト招待リンク・viewOnly招待リンクで実際に入室し、位置同期・チャット・presenceの動作を確認する。
4. 問題があれば即座にメンテナンスモードを再度ONにしてからクライアントを前の版へ戻す。
5. 問題が無ければメンテナンスモードをOFFのまま運用を継続する。

---

## 9. 検証結果

### 9-1. 検証済み(2026-11-09〜10、設計書の初版作成後)

1. **`private: true`指定のチャンネルは、プロジェクト設定「Allow public access」がONの状態でも、RLS(Realtime Authorizationのポリシー)が働く。** テスト用の一時ポリシー("test-private-check: authenticated only")を作成し、本番でanonキーによる**送信(publish)**が実際に`Unauthorized`で拒否されることを確認した。**受信(subscribe)側が同様に拒否されるかは未確認。** すなわち、段階7(各チャンネルを`private:true`化)は「Allow public access」のON/OFFとは独立して効力を持つ(送信拒否の限りで)。検証日は本文書の初版コミット(2026-11-09 22:14、この時点ではservice_roleの件が「未検証」だった)より後と推定する(正確な時刻は記録されていない)。検証用ポリシー・検証用一時スクリプト(`tmp-realtime-test-a.js`/`b.js`)はいずれも削除済み(`pg_policy`で残っていないことを確認済み)。
2. **`service_role`はRLSをバイパスし、privateチャンネルにも送信できる。** `lib/broadcastForceLeave.ts`と同じ作り方・送信方法で実機確認済み。Postgres側`service_role`ロールの`rolbypassrls = true`とも整合する。したがって以前の未検証事項(下記旧1番)は解消し、段階7時点で`lib/broadcastForceLeave.ts`を`private:true`化しても追加の検証・切り戻し手順は不要と判断する。
3. スクリプトC(テスト用アカウントでのログイン確認)は、A・Bの結果で十分と判断し、認証情報をファイルに置くリスクを避けるため、ユーザーの判断で省略した。

### 9-2. 未検証事項の一覧

1. **接続中の古いタブ(`private:true`を送らない旧コード)が、「Allow public access」をオフにした瞬間に即座に切断されるか、それとも次の再接続まで持続するか。** Realtime Authorizationの権限評価は「チャンネル参加(join)時に行われ、接続中はキャッシュされる」ことは確認済みだが、「Allow public access」という project-level設定自体の変更が既存の確立済み接続にどう効くかは、公式ドキュメントに明記が見当たらなかった。段階9を低トラフィック時間帯に行い、実機で確認する。
2. **接続中にBANした場合、改造クライアントが受信を続けられる期間。** Realtime Authorizationの権限評価はチャンネル参加時だけでなく、JWTの更新・失効時にも再評価されるため、改造クライアントが受信を続けられるのは最長でも**JWTの有効期限まで**(現在の有効期限は要確認)。force-leaveブロードキャスト(クライアント協力頼み)の併用が必要(課題リストに記録済み)。
3. **viewOnly許可証(`realtime_view_grants`)のTTL(30分)が実運用に適切か。** 長時間のviewOnly閲覧でハートビートが途切れた場合の挙動は未検証。

### 9-3. 既知の制約

1. **招待リンクの再発行(`invite_token`の更新)は、既に発行済みの`realtime_view_grants`を即時失効させない。** 再発行後も、既存の許可証は`expires_at`(発行から30分)まで有効なまま残る。
2. **`can_message_user_channel`は、任意の`user_id`を渡せば「そのuser_idが自分と同じアカウントに属するか」を探索できてしまう。** 戻り値が真偽値のみのため本文等は漏れないが、総当たりすれば同じアカウントに属するuserIdの有無を推測する材料になりうる。
3. **`can_message_user_channel`は送信者側(`mine.account_id`)のBAN状態しか見ていない。** 宛先(`p_recipient_user_id`)側がBANされていても、送信者がBANされていなければ送信は許可される。

---

## 10. 課題リストとの対応関係

本文書の対象範囲外、または別途対応が必要な既知の項目は[[project_globy_task_list]]の「高」「中」ティアに記録済み(チャット・DM・presence・画面共有サムネイルの公開チャンネル露出、viewOnlyの非対応、接続中BANの限界等)。
