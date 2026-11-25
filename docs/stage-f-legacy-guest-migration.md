# 段階F:移行前の古いゲストの移し替え 手順書

対象: 入室の仕組みの作り替え(docs/room-membership-plan.md)段階F。
移行前の古いゲスト(`profiles.role = 'guest'` かつ `profiles.account_id`
がある人)を `account_members` に移し、`profiles.account_id` / `role` を
空(null)にする。持ち主(`role = 'admin'`)・運営者(`is_master`)には
一切触れない。

関連ファイル:
- `supabase/migrations/2026-11-25_stage_f_legacy_guest_migration.sql`(本体)
- `supabase/migrations/2026-11-25_stage_f_legacy_guest_migration_rollback.sql`(元に戻す)
- `supabase/migrations/2026-11-25_stage_f_test_plus_test2.sql`(+test2だけの確認用。本番データは変わらない)

**この手順書のSQLはすべて案であり、本番DBに適用する前に承認が必要。**

---

## 1. 適用前の確認(人数の数え方)

Supabase の SQL Editor で、以下を**読み取りのみ**で実行して人数を確かめる。

```sql
-- 対象になる「古いゲスト」の人数
select count(*) as legacy_guest_count
from public.profiles
where role = 'guest' and account_id is not null;
```

```sql
-- このうち、所属ルームでBANされている人数(参考。対象から除外しない)
select count(*) as banned_legacy_guest_count
from public.profiles p
where p.role = 'guest' and p.account_id is not null
  and public.is_banned_for_account(p.account_id);
```

```sql
-- このうち、既にaccount_membersに(自分の所属ルームの)行がある人数
-- (招待URLを自分で再度開いたことがある等。段階Fでは何もしない=
-- on conflict do nothing の対象)
select count(*) as already_member_count
from public.profiles p
where p.role = 'guest' and p.account_id is not null
  and exists (
    select 1 from public.account_members m
    where m.user_id = p.user_id and m.account_id = p.account_id
  );
```

```sql
-- account_members の現在の総行数(適用後との比較用)
select count(*) as account_members_total_before from public.account_members;
```

これらの数値を記録しておく(適用後の確認で使う)。

---

## 2. 適用

1. `2026-11-25_stage_f_legacy_guest_migration.sql` の内容を確認する。
2. 承認を得たうえで、SQL Editor からファイルの内容をそのまま直接実行する
   (begin〜commitで1つのトランザクション。途中で件数が一致しない場合は
   自動的に取り消される)。
3. 実行結果(Supabaseの「Messages」に出る`raise notice`の行)で、移した
   人数を確認する。

---

## 3. 適用後の確認

```sql
-- 空にできたことの確認。0件になるはず。
select count(*) as remaining_legacy_guest_count
from public.profiles
where role = 'guest' and account_id is not null;
```

```sql
-- 控えの件数(1の人数確認と一致するはず)
select count(*) as backup_count from public.stage_f_legacy_guest_backup;
```

```sql
-- account_membersの総行数(1で記録したaccount_members_total_beforeとの
-- 差が、「1で記録したlegacy_guest_count − already_member_count」と
-- 一致するはず)
select count(*) as account_members_total_after from public.account_members;
```

```sql
-- 持ち主・運営者に影響していないことの確認。0件になるはず。
select count(*) as admin_or_master_touched
from public.profiles
where (role = 'admin' or is_master = true)
  and user_id in (select user_id from public.stage_f_legacy_guest_backup);
```

---

## 4. 画面での確認

- 移行済みの元・古いゲストでログインし、「/」のカード一覧に自分の所属
  ルームが(「あなたのルーム」ではなく)**メンバーのカード**として出ること。
- そのカードから入室できること(アバター・名前・音声・チャットの送受信)。
- チャットの送受信が引き続きできること(送信は`send_chat_message_as_member`
  経由になる。既存の表示・既読・リアクションも確認)。
- 管理者(持ち主)が、移行済みの元・古いゲストを強制退出・BANできること
  (管理画面の「在室者」「メンバー」タブ)。
- 入室前の左サイドバーの見出しが「あなたのルーム」ではなく
  「{管理者名}のルーム」になること(段階E-5-1bの表示ロジックより)。
- 右のカード一覧の「…」メニューから「一覧から外す」ができること
  (`leave_account_membership`)。
- 所属ルームでBANされている元・古いゲストが`/?room=`を直接開いた場合、
  以前の「入室できません」画面(BannedNotice)ではなく、カードが一覧に
  出ない・無効な招待と同じ画面になること(下記「決めてほしいこと」参照、
  想定どおりの変化であることを確認するだけで、直す対象ではない)。
- `/plan`を開いても、以前のような強制的な「/」への振り分けが起きず、
  「ルームを作成する」の画面が出せるようになること(下記の段階Fの後の
  コード変更で、この画面を実際に出してよいかどうかを判断する)。

---

## 5. 元に戻す手順

1. `2026-11-25_stage_f_legacy_guest_migration_rollback.sql` の内容を確認する。
2. 承認を得たうえで、SQL Editor からファイルの内容をそのまま直接実行する。
3. 「3. 適用後の確認」の最初のクエリ(`remaining_legacy_guest_count`)を
   もう一度実行し、適用前の人数に戻っていることを確認する。
4. ロールバックSQLの最後で`stage_f_legacy_guest_backup`テーブル自体を
   削除する(ファイル冒頭の注意書き参照。残したい場合は実行前に該当行を
   取り除く)。

---

## 6. 段階Fの後に行うコードの変更(案)

段階F自体(今回のSQL)はデータの移行だけで、アプリのコードは変更しない。
調査の結果、入室・チャット・Realtime等は既存の`account_members`経路
(段階A〜E・Bで作成済み)がそのまま使われるため、**ほとんどの場所は
コード変更が不要**と確認できた(詳細は調査報告の表を参照)。残るのは、
「`profiles.role === 'guest'`という状態がもう発生しない」ことを前提に、
古い分岐を片付けるという意味でのコード変更。

### 段階F直後に行う(古いゲスト固有の分岐の撤去)

- `app/plan/page.tsx`の`if (state.type === "guest") redirect("/");`を
  削除する(型のうえでは残しても到達しなくなるが、死んだ分岐を残さない)。
- `lib/roomListEntries.ts`の`getRoomListEntries`から、`legacyGuestCard`
  (移行期間中だけの特例カード)の組み立て(`routeState.type === "guest"`
  の分岐、`get_own_account_guest_info`呼び出し)を削除する。
  `RoomListResult.legacyGuestCard`・`RoomListCardKind`の`"legacyGuest"`も
  削除できるが、`components/RoomListSidebar.tsx`・
  `components/RoomListScreen.tsx`側の表示分岐も合わせて消す必要がある。
- `app/page.tsx`の`renderRoomJoin`・`renderMemberRoomJoin`の`!entry`
  ブロックのうち、「`routeState.type === "guest"`に対する
  `fetchAccountRoomCard(..., "legacyGuest")`」の分岐(持ち主〈admin〉の
  分岐は引き続き必要)。
- `fetchAccountRoomCard`の`kind: "legacyGuest"`呼び出し元。

### 段階Gで行う(古い仕組み自体の削除。影響範囲がより広いため分ける)

- `renderViewOnlyRoomJoin`(今回のE-4でも`showMasterPanelLink`を渡さない
  判断をした、段階Gまで残す古い経路)自体の削除。
- `app/page.tsx`の`Home()`の招待URL処理(`joinAccountViaInvite`)のうち、
  「自分自身の招待URL」を特別扱いする分岐(段階Fの後も運営者・持ち主には
  引き続き必要なため、段階Gでの要否を別途判断する)。
- `realtime_view_grants`関連(`can_access_avatar_room_topic`・
  `can_message_user_channel`のコメントに「段階Gで削除予定」と既に
  明記されている)。
- `livekit-token`・`indigo-token`・`chat/image-url`・`chat/compress-image`
  の各APIにある「通常ルート(RLS経由)→メンバーの一覧表」の2段階判定の
  うち、1段階目(直接のRLS判定、コメントに「段階Gで招待トークンの経路を
  削除予定」とあるもの)。
- `get_own_account_guest_info`・`list_chat_threads`・`create_chat_group`
  など、`profiles.account_id`に依存する「通常ルート」専用のSQL関数
  (管理者・持ち主はこの後も使うため、削除するのではなく、ゲストの経路
  としては使われなくなるだけ、という整理になる見込み)。

### 分け方の考え方(案)

段階Fの直後に行う変更は「もう発生しない状態(`role = 'guest'`)に対する
分岐を消す」だけで、挙動そのものは変わらない(到達しない分岐の削除)。
段階Gは「`viewOnly`・招待URL経由の個人閲覧・`realtime_view_grants`と
いう、段階Fとは別の古い仕組み自体」を消す、より広い変更になるため、
段階Fの確認(本番でのユーザー影響確認)が済んだ後、別の作業として分ける。
