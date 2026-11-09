# Realtime Authorization 導入計画(設計のみ・未適用)

2026-11-09時点の調査・設計をまとめたもの。**この文書自体、ここに記載したSQL・コードはいずれも未適用。** 本番への反映は、各段階ごとにユーザーの明示的な承認を得てから行う([[feedback_git_deploy_workflow]]の標準ワークフローに従う)。

## 背景

施錠会議室の音声・映像・字幕の傍受調査の過程で、チャット・DM本文・presence(位置・実userId・施錠会議室の在室情報)・画面共有サムネイルが、**すべて公開(無認可)のSupabase Realtimeチャンネル`avatar-room-{roomId}`にそのまま流れている**ことが判明した(2026-11-09確認)。ログインしていない第三者でもroomIdが分かれば受信できる。

対応方針:
- **Realtime Authorization**(Supabase公式の`private`チャンネル + `realtime.messages`へのRLSポリシー)で、未ログインの第三者・無関係なアカウントのユーザーを遮断する。
- **方式C**(利用者ごとの専用受信チャンネル`user-{userId}` + 通知のみ + DBから本文取得)で、DM・グループDMの「誰が誰と話しているか」というメタデータ自体も、同室の無関係な第三者(＝そのルームのメンバーではあるが宛先ではない人)から守る。
- 字幕(`caption`)は対象外。字幕の根本対応は別途「第2段階(WSサーバー経由でゾーンをサーバー側判定)」にまとめて含める方針(詳細は[[project_globy_indigo_position_ws]])。

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
{ "type": "dm" | "group-dm" | "dm-edit" | "dm-delete" | "reaction" | "group-created" | "mention", "messageId": "...", "groupId": "..." }
```

- 受信側は通知を受けたら`chat_messages`等をRLS経由でSELECTして本文を取得する。これにより、**payload上の送信者偽装は意味を持たなくなる**(表示に使うのはDBから取得した値のみ。DB側のINSERT時RLSで`sender_user_id = auth.uid()`が強制されているため、DBの値は偽装できない)。

### 2-2. 3方式の比較(A: 通知のみ+単一チャンネル、B: チャンネルをDM単位に分割、C: 利用者ごとに1本)

| 観点 | A | B | C(採用) |
|---|---|---|---|
| チャンネル数/人 | 1本(既存のまま) | 会話相手の数だけ増える | 常に1本 |
| 変更量 | 小 | 大(チャンネルの動的管理が必要) | 中 |
| 「誰が誰と話しているか」の秘匿 | 守れない | 守れる | 守れる |
| 遅延 | 通知受信後にDB取得の往復が1回増える | 本文を乗せるなら往復なし | Aと同じ(往復1回) |
| Freeプランのチャンネル数上限への影響 | 影響なし | 会話相手が多い利用者ほど、1接続100チャンネル上限に近づく | 影響ほぼなし(常に1本) |

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
create or replace function public.can_access_avatar_room_topic()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.rooms r
    where 'avatar-room-' || r.id::text = realtime.topic()
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
  );
$$;

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
-- presence SELECT: メンバー/viewOnly または 運営者(is_master)
drop policy if exists "avatar-room: presence access" on realtime.messages;
create policy "avatar-room: presence access"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'presence'
    and (
      public.can_access_avatar_room_topic()
      or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_master)
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
| 1 | 項目5のSQL(BANチェック)適用 | BANされた人がチャットに触れなくなること。Realtimeには無関係 | 項目5の戻しSQL |
| 2 | `realtime_view_grants`テーブル・`grant_realtime_view_access`関数を追加 | 新規追加のみ、既存機能に影響なし | `drop table`/`drop function`(新規追加のみのため安全) |
| 3 | 4節の全ポリシー・ヘルパー関数をDBへ追加(**user-channel用ポリシーもここに含める**。方式Cのクライアントデプロイ〈段階5〉より前に必要) | まだクライアントは`private:true`を送っておらず、「Allow public access」もONのままなので無影響であること | ポリシー・ヘルパー関数をdrop |
| 4 | viewOnly側のクライアントコードで、viewOnly開始時+一定間隔で`grant_realtime_view_access`を呼ぶように変更・デプロイ | 新しい関数呼び出しが追加されるだけで既存動作に変化がないこと | コードを前の版に戻す |
| 5 | 方式Cのクライアントコード(`user-{userId}`チャンネルの購読・通知payloadの縮小・DB取得)をデプロイ。**この間、旧来の本文つきbroadcast送信(dm/group-dm/dm-edit)は残し、両方を送る(dual-write)。新コードの受信側はid基準で重複除去する(現状未実装のため、このタイミングで追加実装する)** | 新旧クライアント混在でも二重表示が起きないこと | コードを前の版に戻す(方式Cの通知だけ届いて本文が出ない状態に戻るため、問題があれば段階5全体を戻す) |
| 6 | 旧来のbroadcast送信のうち**本文を含む`dm`・`group-dm`・`dm-edit`の3イベント**を削除する(**`caption`は対象外。第2段階まで現行のまま**) | 新コードのみで本文がDB経由で正しく表示されること | コードを前の版(段階5相当)に戻す |
| 7 | **avatar-room・user-sessionの全チャンネルを一斉に`private:true`化**(対象ファイルは7節参照)。メンテナンスモードで全員退出させてから実施 | 7節のチェックリスト参照 | クライアントを前の版に戻す(「Allow public access」はまだONのため即座に旧挙動へ復帰) |
| 8 | viewOnlyの動作確認 | 6-4(旧回答)の手順で、メンテナンスモードを一旦OFFに戻して確認用アカウント・ゲスト・viewOnlyで実機確認 | 問題があればメンテナンスモード再ON→段階7の切り戻し |
| 9 | 「Allow public access」をオフにする(独立した手順) | 全クライアントが`private:true`済みであること。古いタブ(未リロード)が残っていないか | 「Allow public access」を再度ONに戻す(即座に旧挙動へ復帰) |
| 10 | 最終動作確認(通常メンバー・ゲスト・viewOnly・マスター画面それぞれ) | 位置同期・チャット・DM・presence・マスター画面の閲覧専用動作 | 段階9の切り戻し |

---

## 7. 段階7で`private:true`に切り替える対象ファイル一覧

| ファイル:行 | 対象チャンネル | クライアント種別 | 変更内容 |
|---|---|---|---|
| `components/AvatarSpace.tsx:6097` | avatar-room(メイン入室後) | セッションクライアント | `config: { private: true, presence: {...} }` |
| `components/AvatarSpace.tsx:10733` | avatar-room(入室前ロビー人数プレビュー) | セッションクライアント | 同上 |
| `app/admin/OnlineCount.tsx:50` | avatar-room(管理画面在室人数) | セッションクライアント | 同上 |
| `app/master/MasterOnlineStats.tsx:54` | avatar-room(マスター画面在室人数) | セッションクライアント | 同上 |
| `app/admin/actions.ts:103`(force-leave等) | avatar-room | セッションクライアント(管理者自身) | 同上 |
| `app/admin/actions.ts:221`(kickParticipant) | avatar-room | セッションクライアント(管理者自身) | 同上 |
| `lib/broadcastForceLeave.ts:23` | avatar-room | **service_roleクライアント** | 同上。8節「未検証事項」参照 |
| `lib/useSessionGuard.ts:88` | user-session | セッションクライアント | `config: { private: true }` |
| `components/auth/LogoutButton.tsx:35` | user-session | セッションクライアント | 同上 |

これらは**全部同じデプロイで一斉に切り替える**(1つでも古いまま残ると、そのチャンネルだけ新しいprivateチャンネルと分断される。Realtime公式ドキュメントで「privateチャンネルとpublicチャンネルは同じトピック名でも別物として扱われ、互いにメッセージを交換しない」ことを確認済み)。

---

## 8. メンテナンスモードの使い方(段階7)

`app_settings.maintenance_enabled`がONの間、`components/AvatarSpace.tsx:10836`の`maintenanceBlocking = isMaintenanceActive(maintenance) && !isMaster`により、**運営者(is_master)だけが入室でき、通常アカウント・ゲスト・viewOnlyはすべてブロックされる**(確認済み)。

したがって、段階7直後に通常アカウント・ゲスト・viewOnlyで確認するには、メンテナンスモードをONのままにはできない。以下の順で行う。

1. メンテナンスモードON → 全員退出を確認 → `private:true`のクライアントをデプロイ(段階7本体)。
2. メンテナンスモードを一旦OFFに戻す(通常アカウント・ゲスト・viewOnlyが入室できる状態に戻す)。
3. 低トラフィックな時間帯であることを前提に、確認用の通常アカウント・ゲスト招待リンク・viewOnly招待リンクで実際に入室し、位置同期・チャット・presenceの動作を確認する。
4. 問題があれば即座にメンテナンスモードを再度ONにしてからクライアントを前の版へ戻す。
5. 問題が無ければメンテナンスモードをOFFのまま運用を継続する。

---

## 9. 未検証事項の一覧

1. **`lib/broadcastForceLeave.ts`(service_roleクライアント)が、privateチャンネルかつRealtime Authorization有効下でも送信できるか。**
   - 公式ドキュメント(Realtime Authorization、Broadcast、GitHub Discussion #22484)を調べたが、「service_roleキーがRLSベースのRealtime Authorizationを無条件にバイパスする」という明確な記載は見つからなかった。非公式な記事に「RealtimeサーバーはRLSに縛られない高権限の内部ロールでDBに接続する」という記述があったが、これは二次情報であり裏付けが取れていない。
   - **段階7直後に、実際の決済を伴わず検証する方法(提案):**
     - (a) 最も簡単な方法: `broadcastForceLeaveForAccount`をStripe Webhookの外から直接呼ぶ簡易スクリプト/一時的な管理操作を用意し、テスト用アカウント・テスト用ルームに対してservice_role経由のforce-leave送信が実際に届くかだけを単体で確認する(Stripeを一切介さない)。
     - (b) Stripeのテストモードを使う方法: Stripeテストモードでテスト用の価格・サブスクリプションを用意し、Stripeのテストカード(`4242 4242 4242 4242`等、実際の課金は発生しない)で一度だけCheckoutを通し、テスト用accountにstripe_customer_id/stripe_subscription_idを持たせる。その後、Stripe CLIの`stripe trigger customer.subscription.updated`(テストモード用の合成イベントを生成)または、一度本物のテストイベントを発生させた後に`stripe events resend evt_... --webhook-endpoint=we_...`(直近30日以内のイベントを再送)で、Webhookの処理(`applyPlanChange`→`broadcastForceLeaveForAccount`)を再実行させる。どちらもテストモードでは実際の金銭は一切動かない。
   - Sources: [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization), [Realtime Broadcast and Presence Authorization #22484](https://github.com/orgs/supabase/discussions/22484), [Stripe CLI: events resend](https://docs.stripe.com/cli/events/resend), [Stripe CLI: Webhook commands](https://docs.stripe.com/cli/intro_webhooks.md)
2. **接続中の古いタブ(`private:true`を送らない旧コード)が、「Allow public access」をオフにした瞬間に即座に切断されるか、それとも次の再接続まで持続するか。** Realtime Authorizationの権限評価は「チャンネル参加(join)時に行われ、接続中はキャッシュされる」ことは確認済みだが、「Allow public access」という project-level設定自体の変更が既存の確立済み接続にどう効くかは、公式ドキュメントに明記が見当たらなかった。段階9を低トラフィック時間帯に行い、実機で確認する。
3. **接続中にBANした場合、改造クライアントがJWTの有効期限まで受信を続けられる可能性がある。** force-leaveブロードキャスト(クライアント協力頼み)の併用が必要(課題リストに記録済み)。
4. **viewOnly許可証(`realtime_view_grants`)のTTL(30分)が実運用に適切か。** 長時間のviewOnly閲覧でハートビートが途切れた場合の挙動は未検証。

---

## 10. 課題リストとの対応関係

本文書の対象範囲外、または別途対応が必要な既知の項目は[[project_globy_task_list]]の「高」「中」ティアに記録済み(チャット・DM・presence・画面共有サムネイルの公開チャンネル露出、viewOnlyの非対応、接続中BANの限界等)。
