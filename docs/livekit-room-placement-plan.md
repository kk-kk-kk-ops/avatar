# LiveKitサーバーの振り分け(②-b)設計書(設計のみ・未適用)

2026-11-27時点の設計。**この文書のコード・SQLはいずれも案であり、ファイルは作成していない(この文書自体以外)。** 本番への反映は、各段階ごとにユーザーの明示的な承認を得てから行う。`docs/room-membership-plan.md`と同じ書き方(表・コードブロック・太字で要点)に合わせている。

---

## 1節 目的と決めたこと

### 1-1. 今の問題(前回調査の要点)

今は契約(`accounts`)ごとに、契約した時点で物理LiveKitサーバーを1台、ラウンドロビンで固定で割り当てている(`lib/accountProvisioning.ts:55-70`、`accounts.livekit_server_id`)。これは「単一送信元からの同時接続50人規模でWebARENA Indigo側が通信を遮断する」という過去の障害(`lib/livekitServers.ts:4-8`のコメント)を避けるための設計だが、**台を増やした後、どの契約がどれだけ大きなルームを持つかを一切見ずに割り振る**ため、たまたま大きなルームを持つ契約が同じ台に偏る可能性がある。

### 1-2. 決めたこと(2026-11-27、ユーザー指示)

- 振り分けの単位は**ルーム**(契約ではない)。
- ルームを開く時(そのルームがどの台でも開いていない時)に、**予約**(その台で今開いているルームの、プランの最大人数の合計)が一番少ない台を選ぶ。予約が同じ時は、実際の在室者数が少ない台、それも同じなら台の並び順(`lib/livekitServers.ts`の`LIVEKIT_SERVERS`配列の順)。
- **1台あたりの人数の上限は置かない**(入れない人を出さない)。予約または実際の在室者数が目安(例:300人)を超えた台は、マスター画面で警告する。目安はまずコードの定数にする。
- 「ルームがどの台で開いているか」は、データベースに長く記録せず、**その都度LiveKitの各台に聞いて確かめる**(`listRooms`など)。消し忘れを防ぐため。2人がほぼ同時に最初に入る時だけ、データベースに短い時間(1〜2分)だけ有効な目印を置いて、同じ台に揃える。
- ③(会議室ごとに別の台)と④(Jitsi)は、今は作らない。

---

## 2節 LiveKitに聞く方法の確かめ

使っているSDKは`livekit-server-sdk@^2.17.0`(`package.json:21`)。

### 2-1. `RoomServiceClient.listRooms`の使い方

`node_modules/livekit-server-sdk/dist/RoomServiceClient.d.ts:102-108`(型定義全文):

```ts
/**
 * List active rooms
 * @param names - when undefined or empty, list all rooms.
 *                otherwise returns rooms with matching names
 * @returns
 */
listRooms(names?: string[]): Promise<Room[]>;
```

- **1つだけ聞く使い方**: `roomService.listRooms([roomName])`。該当ルームが開いていれば配列に1件、開いていなければ空配列が返る。
- **全部を聞く使い方**: `roomService.listRooms()`(引数なし、または空配列)。その台で現在開いている全ルームが返る。

返ってくる`Room`の項目(`node_modules/@livekit/protocol/dist/index.d.ts:5377-5441`、一部抜粋):

| フィールド | 型 | 内容 |
|---|---|---|
| `name` | string | ルーム名(Globyでは`avatar-room-${roomId}`) |
| `numParticipants` | number | 現在の参加者数 |
| `numPublishers` | number | 送信中(映像・音声等を送っている)参加者数 |
| `emptyTimeout` | number | 誰も参加していない状態で開き続ける秒数 |
| `departureTimeout` | number | 最後の1人が退出してから開き続ける秒数 |
| `maxParticipants` | number | 作成時に指定した上限(Globyは指定していないため常に0=無制限) |
| `activeRecording` | boolean | LiveKit自体のEgress機能での録画中かどうか(Globyの録画はクライアント側でトラックを直接タップする自前方式のため、ここは関係しない。5-3節参照) |

**「このルームがどの台にあるか」という項目は無い**。これは、`listRooms`はそもだそも「特定の1台のLiveKitサーバーのエンドポイント(URL)」に対して呼ぶAPIであり、呼んだ結果に含まれていること自体が「その台にある」ことを意味するため、項目として持つ必要が無い(1台ずつ別々のURL・APIキーを持つ今のGlobyの設計〈`lib/livekitServers.ts`〉と自然に合う)。

### 2-2. ルームが閉じるまでの時間(`empty_timeout`・`departure_timeout`)

- **既定値**: LiveKit公式ドキュメントの「Room service API」ページ(CreateRoomパラメータ表)に、`empty_timeout | uint32 | | Number of seconds to keep the room open if no one joins. Default is 300 seconds.`・`departure_timeout | uint32 | | Number of seconds the room remains open after the last participant leaves. Default is 20 seconds.`と明記されている([出典](https://docs.livekit.io/reference/other/roomservice-api.md))。
- **ただしこれは`RoomServiceClient.createRoom`を明示的に呼んだ場合のパラメータの既定値であり**、Globyのように`createRoom`を一度も呼ばず「最初の参加者が入った時に自動的にルームが作られる」運用(`docs/room-membership-plan.md`等で確認済み、`app/api/livekit-token/route.ts`のどこにも`createRoom`呼び出しは無い)で、**自動作成されたルームにも同じ300秒・20秒の既定値が適用されるのかどうかは、公式ドキュメントのどのページにも明記が無く、確かめられない**。
- 「Managing rooms」ページには"Once the last participant leaves a room, it closes after a short delay."とあるだけで、具体的な秒数の記載は無い([出典](https://docs.livekit.io/realtime/server/managing-rooms/))。
- `deploy/livekit/livekit-node/livekit.yaml`(全文、1-21行目)には`empty_timeout`・`departure_timeout`に相当するサーバー全体の既定値設定は無い(そもそもこの2つはサーバー起動時の設定項目ではなく、ルーム作成時にルームごとに渡すパラメータのため、`livekit.yaml`に書く場所自体が無い)。
- **実務上の結論**: 「ルームが空になってから閉じるまでの数十秒〜数分の間、LiveKitはまだそのルームを`listRooms`の結果に残し続ける可能性がある」という前提で設計する(3節(a)参照)。この間に新しい参加者が同じルームへ入ろうとした場合、そのまま同じ台の同じルームに入れるので問題は無い。

### 2-3. 1つの台が応答しない時の扱い

これはLiveKit自体の仕組みではなく、**Globy側が複数の台へ`listRooms`を問い合わせる処理自体をどう作るか**という設計の話。既存の`lib/disconnectLivekitParticipant.ts:46-52`・`lib/resolveLivekitParticipantUserId.ts:27-33`が、`Promise.race`で3000msのタイムアウトを設け、タイムアウトを失敗として扱う(かつ本来の処理〈強制退去・本人確認〉自体は失敗してもブロッキングしない)という同じパターンを既に2か所で使っている。②-bでも同じ3000msのタイムアウトパターンを踏襲し、**応答しなかった台は「今は選べない(予約0とはみなさない。逆に、健全性が確認できないため新しいルームの割り先としては避ける)」として比較から外す**案とする(3-4節参照)。

---

## 3節 入室の時の流れ(`app/api/livekit-token/route.ts`)

今の該当箇所(`app/api/livekit-token/route.ts:91-116`、全文抜粋):

```ts
// このルームが属するアカウントに固定で割り当てられたLiveKitサーバーを使う
// (単一送信元からの同時接続50人規模でWebARENA Indigo側の遮断が発生する
// ことが判明したため、契約時点でサーバーを固定する方式にした。
// lib/livekitServers.ts参照)。
const { data: account } = await createServiceRoleClient()
  .from("accounts")
  .select("livekit_server_id")
  .eq("id", accountId)
  .maybeSingle();

const { url, apiKey, apiSecret } = resolveLivekitServerCredentials(
  account?.livekit_server_id ?? null,
);
...
const roomName = `avatar-room-${roomId}`;
```

この「`accounts.livekit_server_id`を読むだけ」の部分を、次の(0)→(a)→(b)→(c)の順に差し替える案。

### (0) 固定(pin)が指定されていれば、その台を使う

このルームのアカウントに`accounts.livekit_server_pin`(4-4節)が設定されていれば、予約の計算も(a)(b)(c)も行わず、その台をそのまま使う。運営者が特定の契約を強制的に1台へ固定したい時のための優先指定(4-4節参照)。

### (a) 各台に、このルームだけが開いているかを聞く

`roomName`(`avatar-room-${roomId}`)を使い、`LIVEKIT_SERVERS`の全台に対して**並行**(`Promise.all`)で、**このルームだけを名前指定した`listRooms([roomName])`**(2-1節)を呼び、結果の中に行があるかをアプリ側で確認する。**全ルームの一覧を取る`listRooms()`はここでは使わない**(そちらは(c)に進んだ時だけ使う。下記参照)。

- **開いている台が1つだけ見つかった場合**: その台を使う。これが最も多いケース(2人目以降の入室、または1人目でも空になってからの再入室でまだLiveKit側がルームを残している間)。**全ルームの一覧を取らずに済むため、2人目以降の入室はこの(a)だけで完了する**。
- **2台以上で見つかった場合(通常は起こらないはずの異常ケース)**: 本来1つのルーム名は1台にしか存在しないはずだが、万一(手動のサーバー入れ替え作業中の一時的な重複等)見つかった場合は、`LIVEKIT_SERVERS`の並び順で先頭の台を使い、ログに警告を出す(どちらを選んでも、同じ部屋にいる人が2つの台に分断されている状態自体が既に異常なので、これ以上の自動修復はしない)。
- **どの台でも見つからなかった場合**: (b)に進む。この時、2-3節のとおり**応答しなかった台があれば、どの台が応答しなかったかを覚えておく**(下の(b)ケースBで使う)。

### (b) どこにも無ければ、`livekit_room_claims`の記録を確かめる

`livekit_room_claims`テーブル(4-1節。このルームが最後に〈(0)のpin経由を含め〉実際に使った台`server_id`と、その時刻`last_used_at`を持つ)を`room_id`で1行だけ検索する。**2つの別の目的で、2つの別の新しさのしきい値を見る**。

- **ケースA(`last_used_at`が直近1〜2分以内)**: このルームを今まさに別の参加者がほぼ同時に開こうとしていて、(c)の計算にたった今進んだところである可能性が高い(同時に(c)に到達した場合の決着は4-2節の関数が行うが、その直後のごく短い間に自分も(c)に進んでしまうと無駄な計算になる)。この`server_id`をそのまま使う。
- **ケースB(1〜2分より古いが12時間以内、かつその`server_id`が(a)で応答しなかった台だった場合)**: (a)でその台に聞けなかったため「本当にそこに無いのか」を確認できていない。**別の台に新しく開いてしまうと、既にそこにいるかもしれない参加者と新しい参加者が2つの台に分かれてしまう**ため、つながらない可能性があっても、記録されている台をそのまま使う(2台に分かれるよりはよいという判断)。
- **上記いずれにも当たらない場合(記録が無い/12時間より古い/記録された台は(a)で応答していて単に無かった)**: (c)に進む。**特に「記録された台が実際に応答していて、そこにこのルームが無かった」場合は、以前のセッションが本当に終わって閉じたと判断してよいので、迷わず(c)に進む**。

### (c) `livekit_room_claims`の記録も使えなければ、予約を計算して台を選ぶ

ここで初めて、各台に**全部を聞く`listRooms()`**(2-1節)を並行で呼ぶ(2-3節のとおり、応答しなかった台は比較から外す)。

1. 各台の`listRooms()`の結果に含まれる各ルーム名`avatar-room-{roomId}`から`roomId`を取り出す(文字列の前方一致`avatar-room-`を外すだけ)。
2. 集まった`roomId`の一覧を1回のSQL(`rooms.account_id`→`accounts.plan`のJOIN、`in (...)`で一括)で引き、`lib/types.ts`の`PLANS[plan].maxPeoplePerRoom`(free: 5・light: 10・standard: 20・pro: 50、`lib/types.ts:427,443,459,475`)を足し合わせて、台ごとの予約合計を作る。**`livekit_server_pin`(4-4節)で固定されているルームも、ほかのルームと同じにこの合計に数える**(10節参照。固定されているからといって除外すると、その台の実際の混み具合を見誤り、ほかのルームがさらに集まってしまう)。
3. 予約合計が最小の台を選ぶ。同じなら、その台の`numParticipants`(listRoomsの結果に既に含まれている、2-1節参照)の合計が少ない方。それも同じなら`LIVEKIT_SERVERS`の並び順。
4. 選んだ台を4-2節の`claim_livekit_room_server`関数で`livekit_room_claims`に書き込む(同時に2人が(c)に到達した場合、先に書き込めた方の`server_id`に両方が揃う)。

### 台を決めた後(共通)・4-2節のどちらの関数を呼ぶか

(0)・(a)・(b)のいずれかで台が決まった場合は、4-2節の`touch_livekit_room_claim`関数を呼び、`livekit_room_claims`の`server_id`/`last_used_at`を**トークンを発行するたびに毎回**更新する(2人目以降の入室も含む)。これにより、実際に使われ続けているルームの記録は常に新しくなり、(b)ケースBの「12時間以内」の判定が常に最新の実績を反映する。(c)で台を決めた場合は、`claim_livekit_room_server`自体が書き込みを兼ねるため、重ねて`touch_livekit_room_claim`は呼ばない。

### 3-4. 問い合わせの回数・時間を減らす工夫と、入室が遅くなるかの見積もり

- **2人目以降の入室は(a)の「このルームだけ」を聞く軽い問い合わせだけで完了し、全ルームの一覧を取る(c)の重い問い合わせは発生しない**。(c)が発生するのは、そのルームを最初に開く時(かつ(b)の記録も使えない時)だけに限られる。
- (a)・(c)いずれも台の数だけ並行(`Promise.all`)で呼ぶため、**かかる時間は最も遅い1台の応答時間**で決まる(直列に呼ぶより速い)。既存のなりすまし対策(`app/api/livekit-token/route.ts:130-159`)も同じAPI(Twirp RPC経由のHTTPS)で`listParticipants`を1回呼んでおり、これが今の入室処理に既に含まれているレイテンシの目安になる。台が増えても増分は「もう1台分の並行呼び出し」だけなので、**台数が増えても大きくは遅くならない**と見積もる(実測していないため、2台構成を用意した後に実際の応答時間を確認する必要がある。7節参照)。
- サーバーレス(VercelのNext.js API Route)は呼び出しごとに実行環境が新しくなることがあるため、「直前の呼び出し結果をメモリ上に数秒だけ使い回す」最適化(モジュール変数へのキャッシュ)は、**同じ実行環境が再利用された時だけ効く「できれば使う」程度の最適化であり、正しさはこれに依存させない**(キャッシュが無くても(a)の並行呼び出しだけで動く設計にする)。
- 1つの台が応答しない場合、2-3節のとおりタイムアウト(3000ms)で打ち切り、その台を比較から外して進める。**全台が応答しない場合**は、入室そのものを止めず、今の既定サーバー(`DEFAULT_LIVEKIT_SERVER_ID`、`lib/livekitServers.ts:41`)にフォールバックする案とする(どの台が空いているか分からない時に入室自体をブロックしないため)。

---

## 4節 データベースの変更の案(文面だけ)

### 4-1. 記録の表(案: `livekit_room_claims`)

このルームが**今どの台で開いているか**を長く記録する表ではない(1節の決定どおり、そちらはLiveKit本体への都度の問い合わせに任せる)。代わりに、次の2つの目的のためだけに使う記録。

1. 2人以上がほぼ同時に3節(c)の計算に到達した時に、同じ台へ揃えるための記録(3節(b)ケースA)。
2. 3節(a)で問い合わせた台の中に応答しない台があり、かつこのルームがどの台にも見つからなかった時、「このルームが最後に使われていたのはどの台か」を直近12時間分だけ覚えておき、2台に分かれることを避けるための記録(3節(b)ケースB)。

どちらの目的も同じ1行(`room_id`ごとに1行)の`server_id`・`last_used_at`だけで表せるため、表は1つにまとめる。目的によって読み取る時に使う「新しさ」のしきい値(1〜2分/12時間)を変えるだけで、書き込み側は共通の2つの関数(4-2節)で済む。

```sql
create table if not exists public.livekit_room_claims (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  server_id text not null,
  last_used_at timestamptz not null default now()
);
alter table public.livekit_room_claims enable row level security;

-- 通常の利用者(authenticated/anon)向けの読み書きポリシーは意図的に
-- 一切作らない。service_roleはRLSの対象外のため、下のSECURITY DEFINER
-- 関数経由、またはAPI Route側のservice_roleクライアントからのみ
-- 読み書きする(docs/room-membership-plan.md 3-1節のaccount_membersや、
-- 既存のrealtime_view_grants〈viewOnly専用の期限付き許可証〉と同じ
-- 「通常ロールからは直接触れない」考え方)。
```

### 4-2. 書き込みの関数の案(2つ)

**(1) `claim_livekit_room_server`(3節(c)専用。同時に書こうとした時に1つに揃える)**

```sql
-- 3節(c)で、このルームについてまだ記録が無い(または使えない)と判断
-- した時に呼ぶ。2人以上がほぼ同時にここへ到達した場合、先に書き込めた
-- 方のserver_idに両方を揃える(on conflict do nothingで、ごく短い
-- race_window_seconds以内の既存の記録は上書きしない)。それより古い
-- 記録(前回の割り当て試行が何らかの理由で完了しなかった場合等)は
-- 上書きする(自己修復)。
create or replace function public.claim_livekit_room_server(
  p_room_id uuid,
  p_server_id text,
  p_race_window_seconds int default 90
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id text;
begin
  insert into public.livekit_room_claims (room_id, server_id, last_used_at)
  values (p_room_id, p_server_id, now())
  on conflict (room_id) do update
    set server_id = excluded.server_id, last_used_at = excluded.last_used_at
    where public.livekit_room_claims.last_used_at
      < now() - (p_race_window_seconds || ' seconds')::interval;

  select server_id into v_server_id
  from public.livekit_room_claims
  where room_id = p_room_id;

  return v_server_id;
end;
$$;

revoke all on function public.claim_livekit_room_server(uuid, text, int) from public;
revoke all on function public.claim_livekit_room_server(uuid, text, int) from anon;
grant execute on function public.claim_livekit_room_server(uuid, text, int) to service_role;
```

**(2) `touch_livekit_room_claim`(3節(0)(a)(b)で台が決まった後。トークンを発行するたびに毎回呼ぶ)**

```sql
-- (0)(a)(b)のいずれかで既に決まった台を、そのままlivekit_room_claimsに
-- 反映するだけの、無条件の上書き。この時点では台はもう決まっているため、
-- claim_livekit_room_serverのような競合の決着(on conflict do nothing)
-- は不要で、常に最新の値で上書きしてよい。
create or replace function public.touch_livekit_room_claim(
  p_room_id uuid,
  p_server_id text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.livekit_room_claims (room_id, server_id, last_used_at)
  values (p_room_id, p_server_id, now())
  on conflict (room_id) do update
    set server_id = excluded.server_id, last_used_at = excluded.last_used_at;
$$;

revoke all on function public.touch_livekit_room_claim(uuid, text) from public;
revoke all on function public.touch_livekit_room_claim(uuid, text) from anon;
grant execute on function public.touch_livekit_room_claim(uuid, text) to service_role;
```

呼び出し側は、3節(0)(a)(b)で台が決まった場合は`touch_livekit_room_claim`を、3節(c)で初めて台を選ぶ場合は`claim_livekit_room_server`を呼ぶ(`claim_livekit_room_server`は呼んだ時点でもう書き込み済みのため、その後に重ねて`touch`は呼ばない)。どちらも`authenticated`には`grant`しない(API Route〈service_role〉からだけ呼ぶため)。

### 4-3. 古い記録の掃除

3節(b)・4-2の関数はいずれも「古い記録は目的ごとに決めた新しさのしきい値(1〜2分/12時間/90秒)で判定する」という**読み取り・書き込み時のその場の判定**で対応しているため、定期的な掃除処理が無くても正しく動く(`touch_livekit_room_claim`が毎回のトークン発行で`last_used_at`を更新し続けるため、実際に使われ続けているルームの記録は古くならない。使われなくなったルームの記録だけが自然に古くなっていく)。ただし行が溜まり続けること自体を避けるため、既存の`vercel.json`の日次cron(`app/api/cron/expire-trials/route.ts`と同じ、`CRON_SECRET`によるBearer認証+service_roleクライアントのパターン)に、`last_used_at`が例えば2日(3節(b)ケースBの12時間より十分長い余裕を持たせる)より古い行を削除するだけの新しいcronを1つ追加する案(保険的な掃除であり、3節(b)・4-2の正しさ自体はこれに依存しない)。

### 4-4. `accounts.livekit_server_id`・新しい`accounts.livekit_server_pin`・`count_accounts_by_livekit_server`・`updateAccountLivekitServer`をどうするか

**【重要な訂正】前回案の誤り**: 前回のこの節で「`accounts.livekit_server_id`を『優先ヒント』に変える」と書いたが、これは誤り。`accounts.livekit_server_id`は`lib/accountProvisioning.ts:55-70`により**契約を作った時点で必ず値が入る**(ラウンドロビンで割り当てられ、未割り当て=nullの状態は無い)。この列をそのまま優先指定に使うと、**既存の全アカウントが最初から「優先指定あり」の状態になってしまい、3節(c)の予約計算が一度も行われなくなる**(すべてのルームが(0)で解決してしまうため)。

**直し方**: 手で台を固定する指定は、新しい列`accounts.livekit_server_pin`(text、null可、既存行は全部null)に分ける。

```sql
alter table public.accounts
  add column if not exists livekit_server_pin text;
```

| 対象 | 案 | 理由 |
|---|---|---|
| 新規`accounts.livekit_server_pin`列 | **これが3節(0)で読む「固定指定」の列。** 既定はnull(指定なし)。nullのルームだけが3節(a)(b)(c)の振り分け計算の対象になる | 既存の`livekit_server_id`と役割を完全に分けることで、「全アカウントに値が入っている」問題を避ける |
| `accounts.livekit_server_id`列 | **振り分けには使わない(しばらく残し、後で整理する)。** `lib/accountProvisioning.ts`の新規契約時の割り当て処理(55-70行目)も**そのままでよい(直す必要はない。単に、書き込まれた値がもう振り分けに使われないだけ)** | 今すぐ消す/直すと、他にこの列を読んでいる箇所(5節参照)との整合を同時に取る必要が出て作業が大きくなる。②-bが本番で安定した後にまとめて整理する方が安全 |
| `count_accounts_by_livekit_server`関数 | `lib/accountProvisioning.ts`の割り当てをそのまま残すなら、この関数も変更不要 | 同上。この関数が数えている「アカウント数」は②-b導入後は振り分けに使われない値になるが、動作自体に支障は無い |
| `updateAccountLivekitServer`(`app/master/actions.ts:415-429`) | **書き込み先を`accounts.livekit_server_id`から`accounts.livekit_server_pin`に変更する。** `serverId`に`null`を渡せば指定を外せる(今の実装のnull許容の形のまま使える) | マスター画面の「特定の契約を1台へ固定したい」という手動の運用ニーズに応えるのは、今後は`livekit_server_pin`の役目になる |

**予約計算との関係**: 3節(c)の予約計算では、`livekit_server_pin`で固定されているルームも、固定されていないルームと同じように各台の予約合計に数える(3節(c)の2参照)。固定されているからといって集計から除外すると、その台の実際の混み具合を見誤り、ほかのルームがさらに集まってしまう。

---

## 5節 ほかの処理の直し方

### 5-1. 強制退去・在室者の確かめ

| 呼び出し元 | 今の処理 | 直し方 |
|---|---|---|
| `app/admin/actions.ts:502-507`(`livekitAccount`取得) | `accounts.livekit_server_id`を1回読む | 3節の「このルームが今開いている台」を調べる処理(3-(a)の`listRooms([roomName])`を各台に。対象は1ルームだけなので全件取得〈3節(c)〉までは不要)に差し替える |
| `app/admin/actions.ts:530-534`(`resolveLivekitParticipantUserId`呼び出し) | `livekitAccount?.livekit_server_id`を渡す | 上で求めた「開いている台」の`server_id`を渡す |
| `app/admin/actions.ts:604-608`(`disconnectLivekitParticipant`呼び出し) | 同上 | 同上 |
| `lib/disconnectLivekitParticipant.ts`・`lib/resolveLivekitParticipantUserId.ts`自体(79行・49行) | `livekitServerId`を引数で受け取るだけ | **関数自体は変更不要**(呼び出し元が渡す値の求め方だけが変わる) |

**在室者が実際にその台にいない(開いている台が見つからない)場合の扱い**: 今の管理画面の警告キー(`admin.livekitDisconnectFailedWarning`等、`app/admin/actions.ts`)と同じ考え方で、「開いている台が見つからなかった」場合も既存の`notConfigured`相当の警告として表示する案(新しい警告文言が1つ増える)。

### 5-2. マスター画面の警告表示

- `lib/serverMetricsConfig.ts`(37行、`SERVER_ROWS`)は見た目(CPU・RAM等)の表示専用で、予約・在室者数とは無関係のため変更不要。
- 新規に、台ごとの「予約合計」「実際の在室者数(listRoomsの`numParticipants`の合計)」を取得するAPI(例:`/api/master/livekit-placement`、既存の`/api/master/server-metrics/route.ts`と同じ構成)を1つ追加し、`app/master/ServerResourceTable.tsx`(現209行)に列を追加するか、専用の小さいコンポーネントを1つ`MasterDashboard.tsx:347`付近に並べる。
- しきい値(例:300人)を超えた台がある場合、既存の`ServerResourceTable.tsx:178-182`の「前回取得時点の値です」と同じ場所に、赤字の警告文(例:「予約が目安(300人)を超えています」)を出す案。しきい値はまず`lib/serverMetricsConfig.ts`と同じ「コードの定数が唯一の情報源」方式の新ファイル(例:`lib/livekitCapacityConfig.ts`)に置く。

### 5-3. 録画・文字起こし・ノイズ抑制への影響

コード全体を`EgressClient`・`recording`等で検索した結果、**Globyの録画・文字起こしはLiveKitサーバー側のEgress機能を使っていない**(該当する呼び出しが見つからなかった)。既存メモ`project_globy_2026_10_recording_transcription`の「自前セグメント方式」の記載と合わせて判断すると、**ブラウザ側で自分のマイク・画面のトラックを直接タップ(MediaRecorder等)する方式**と考えられる。これはどの物理LiveKitサーバーに繋がっているかに関係なく、ブラウザが持っている自分のトラックに対して行う処理のため、**②-bの振り分けとは無関係(影響なし)**。ノイズ抑制(`deepfilternet3-noise-filter`、マイク取得時のクライアント側処理)も同様に無関係。

---

## 6節 Redisについて

②-bは「各台は1台ずつ別々に動く(クラスターを組まない)」という前提のため、**Redisは不要**。

- 今の`deploy/livekit/livekit-node/livekit.yaml:8-10`には`redis: address: ${REDIS_ADDRESS}`の設定がそのまま残っている。
- `lib/serverMetricsConfig.ts:14-19`のコメントに「target-pro自体のlivekit.yamlはRedis未設定(単一ノード構成のため実運用上Redisに依存していない)上、Redis側ファイアウォールがtarget-proの新IPをまだ許可しておらず疎通できない」と明記されている。
- **今、何か問題が起きているかの確認**: この文書の調査はコード・設定ファイルの読み取りのみで、target-pro実機のLiveKitサーバーの起動ログ等は見ていないため、「Redis未接続によって現在起動時エラーや再接続ログが出続けているかどうか」自体は**確かめられない**。`lib/serverMetricsConfig.ts`のコメント(「誤解を招く『停止中』表示を避けるべくSERVER_ROWSから行自体を削除している」)から、少なくとも運用上の実害(サービス停止等)は出ていないと推測されるが、ログのエラーレベルでの出力有無は未確認。
- **残すか消すかの案**: ②-bを採用する前提なら、`redis.address`の設定自体は**消してよい**(LiveKit自体がRedis未設定でも単体で正常に動作することは、現在target-proが実際にその状態で動いていることで確認済み)。ただし将来③(会議室ごとに別ルーム)やLiveKit本体のクラスター機能(②-a)を検討する可能性がゼロではないため、設定を消すこと自体は**本設計の範囲外の決定**として提案だけに留め、ユーザーの判断を待つ。Redisサーバー(`grovina-livekit-redis`)自体を解約するかどうかも同様。
- **決める時期**: Redisの設定とRedisのサーバー自体を消すかどうかは、2台目を実際に用意するタイミングで判断する(消せばRedisサーバーの維持費用が減る。②-bのままなら2台目以降もRedisは不要なため、消す方向で問題は無いはずだが、最終判断はその時点で改めて行う)。

---

## 7節 試し方

### 7-1. 今の1台だけで試す案と、その限界

`lib/livekitServers.ts`の`LIVEKIT_SERVERS`配列に、**同じ1台を別の名前**(例:`node-1`と`node-1b`、どちらも同じ`urlEnv`/`apiKeyEnv`/`apiSecretEnv`を指す)で2回登録する案。ただし、**この方法には3節(a)との相性の問題がある**: 同じ物理サーバーを2つの名前で登録すると、実際に開いているルームは物理的には1つなのに、`listRooms([roomName])`で両方の名前に聞くと**両方から「見つかった」という応答が返る**。これは3節(a)の「2台以上で見つかった場合(通常は起こらないはずの異常ケース)」の分岐に、**正常な2人目以降の入室のたびに毎回入ってしまう**ことを意味する(本来は起こらないはずの異常ケース用の分岐を、この試し方では常用することになる)。

**この方法で確かめられること**:
- 3節(c)の予約の計算自体(台ごとの予約合計の計算、最小の台の選び方)。
- 4節の`livekit_room_claims`への書き込み・`claim_livekit_room_server`/`touch_livekit_room_claim`の動き(ただし3節(a)が常に「2台で見つかった」扱いになるため、これらが呼ばれるのは実質的に(c)に到達する最初の1回だけになる可能性が高い)。

**この方法で確かめられないこと(本当の確かめは2台目を用意してから行う)**:
- 3節(a)の「開いている台が1つだけ見つかった」という**正常経路**の動作(上記のとおり常に異常経路に入ってしまうため)。
- 同じルームの参加者が2台に分かれないこと(物理的に1台しかないため、分かれる状況自体が起こらない)。
- 1つの台が本当に応答しない時の扱い(2-3節・3節(b)ケースB)。片方の名前だけを一時的に止める、という試し方もできない(どちらの名前も同じ物理サーバーを指しているため、片方を止めれば両方が止まる)。

したがって、この1台2名前の試し方は**予約の計算と書き込みの動き限定の下調べ**であり、7-2節の確認は必ず2台目の物理サーバーを用意した後に行う。

### 7-2. 2台目を用意した後にユーザーがブラウザで確かめること

- **誰で**: 運営者(マスター)権限を持つ利用者。
- **どの画面で**: (1)複数の契約(アカウント)それぞれでルームを開き、5-2節で追加するマスター画面の新しい表示(台ごとの予約・在室者数)を見る。(2)それぞれのルームで実際に音声・映像・画面共有が使えることを、該当する契約の利用者(複数のブラウザ/デバイス)で確認する。
- **何を見るか**: (a)予約の少ない方の台に新しいルームが割り振られていること、(b)同じルームの参加者全員が必ず同じ台に繋がっていること(片方だけ別の台に繋がって音声が分断されないこと)、(c)全員が退出してルームが空になった後、しばらく経ってから(2節の`empty_timeout`/`departure_timeout`の既定値〈300秒/20秒〉を踏まえ、数分程度待って)もう一度開くと、再度その時点で予約の少ない台が選ばれ直すこと(前回と同じ台に固定され続けないこと)。

---

## 8節 負荷試験の案

今の設定(カメラ320×240・15fps・250kbps・VP8・1層、画面共有VP9・1080p・10fps・2Mbps・1層、近くの人だけ受け取る)に近い構成で、1ルーム最大50人(Proプラン)、台全体で何人まで大丈夫かを測る。

- **構成**: 1つのLiveKitルームに参加者を50人まで段階的に増やし(例:10→20→30→40→50人)、その中の複数人(例:全体の2〜3割)がカメラON、1人が画面共有を行う、**全員が送信かつ全員が受信する多対多**の構成(過去の`LOAD_TEST_PLAN.md`のTest7〜16は「1人送信・複数人受信」の構成が中心で、この多対多の構成での記録は見当たらなかった、前回調査結果より)。
- **見る指標**: パケットロス率、target-pro側のCPU・メモリ・帯域(`app/api/master/server-metrics/route.ts`が既に取得している指標がそのまま使える)、画面共有・カメラの`qualityLimitationReason`(帯域起因かどうか、`ScreenShareStatsPanel.tsx`・`CameraStatsPanel.tsx`で既に見られる)。
- **段階的に増やし、ルームを複数同時に開いて台全体の負荷も見る**: 1ルームだけでなく、同時に複数ルーム(例:Proプラン4組=200人相当)を1台に集めた状態も試し、5-2節で置く目安(例:300人)が妥当かどうかの根拠データとする。
- **今のVPS(6vCPU・8GB)で足りない場合の目安**: 前回調査のとおり、過去の試験ではCPU使用率よりネットワーク帯域の方が先に制約になっていた可能性が高い(確かめられない。再試験が必要)。カメラ・画面共有ともに前回のビットレート変更で合計帯域が増えているため、今の設定での再試験が無いと、目安(300人)の数字自体の根拠が薄い。

---

## 9節 進め方の段階と作業量

`docs/room-membership-plan.md`6節と同じ考え方で、各段階は単独で本番に出せて、出す前・後のどちらの状態でも既存の入室・強制退去・マスター画面が動くことを基本方針とする。

| 段階 | 内容 | 直すファイル(おおよその行数) | 本番への影響 | 元に戻す方法 |
|---|---|---|---|---|
| ① データベース | 4節の`livekit_room_claims`テーブル・`claim_livekit_room_server`関数を**追加のみ** | `supabase/consolidated_setup.sql`(+40行程度) | 無し(誰も呼ばない新規追加) | `drop table`/`drop function` |
| ② 入室時の台の選び方 | `app/api/livekit-token/route.ts`の該当箇所(3節、+60〜80行)を差し替え。`lib/livekitServers.ts`に全台をまとめて`listRooms`する小さいヘルパー関数を追加(新規、+30行程度) | `app/api/livekit-token/route.ts`、新規`lib/resolveRoomLivekitServer.ts`(+30〜40行) | **大(入室の経路そのものに触れる)**。1台構成のままでも、常に同じ答え(1台)になるだけなので動作は変わらないはずだが、入室が遅くなる・失敗するリグレッションの可能性があるため、1台構成のまま本番適用し、挙動が変わらないことを数日確認してから次へ進む | 差し替え前のコード(`accounts.livekit_server_id`を読むだけの版)に戻す |
| ③ 強制退去・在室者確認の直し | `app/admin/actions.ts`の3か所(5-1節、+10〜20行) | 小 | 無し(②の後なら自然につながる) | 戻す |
| ④ マスター画面の警告 | 新規API(+40行)・`ServerResourceTable.tsx`または新規コンポーネント(+40〜60行)・`lib/livekitCapacityConfig.ts`(新規、+10行) | 小(表示のみの追加) | 無し | 戻す |
| ⑤ 2台目のサーバーを用意する | コード変更なし(VPS作業・`lib/livekitServers.ts`に1行追加) | - | **ここで初めて実際に分散が始まる**。②〜④が先に本番で安定していることが前提 | `LIVEKIT_SERVERS`から行を削除 |
| ⑥ 負荷試験 | コード変更なし(8節の試験を実施、目安〈300人等〉の数字を調整) | - | 無し(本番とは別に試験環境、または深夜帯等に実施) | - |

---

## 10節 気づいた危険や、もっと良いやり方

- **②-aの限界と同じ限界が②-bにもある**: 前回調査(1〜5節)で、LiveKit本体のクラスター機能(node_selector)は「ルーム作成時の一度きりの判断」であり、後から育つルームには対応しないと分かった。②-bも同様に、**ルームを開く瞬間の予約計算だけで決まり、その後そのルームの人数が増えても台を移し替えることはしない**。これは1節の決定(「振り分けの単位はルーム」「ルームを開く時に選ぶ」)どおりの仕様であり、欠陥ではないが、**「開いた時はガラガラだったが、後から別の大きな会議が同じルームで始まり、たまたま既に混んでいた台に重なる」というケースには対応できない**ことを、ユーザー自身の認識として明確にしておく価値がある。
- **`livekit_room_claims`の`room_id`とルームの実体のずれ**: `rooms`テーブルの行自体が削除された場合(ルームが削除される運用があるかどうかは本調査の範囲外)、`on delete cascade`で目印も一緒に消えるため問題は無い。
- **3節(a)で「開いている」と判定された台が、実は`departure_timeout`経過待ちの空ルームだった場合**: 全員退出した直後の数十秒(2節で確認した既定20秒、または確かめられない実際の値)は、LiveKit側ではまだルームが存在し続ける。この間に同じルームへ新しい1人目が入ってきた場合、(a)でそのまま「開いている」と判定されてその台を使うことになり、**これは望ましい動作**(せっかく同じ台にまだルームが残っているのに、予約計算をやり直して別の台に新しく作ってしまうと、むしろ無駄に分散してしまう)。
- **マスターの手動固定(`accounts.livekit_server_pin`、4-4節)と予約計算の優先順位**: `livekit_server_pin`で固定されたルームも、予約合計の計算(3節(c)の2)に正しく数え上げられるようにしないと、固定されたルームが載っている台の予約が過小評価され、他のルームがさらにそこへ集まってしまう。3節(c)で既にこの注意を明記した(実装時も同じ注意が必要)。
- **より良いやり方の可能性(本設計の範囲外)**: 4-4節の訂正により、`accounts.livekit_server_id`は振り分けに使われなくなり、`lib/accountProvisioning.ts`の新規契約時のラウンドロビン割り当て(`count_accounts_by_livekit_server`、`lib/accountProvisioning.ts:55-70`)は②-b導入後は実質的に使われない値を書き込むだけの処理になる。将来、この割り当て処理自体を削除する(または`livekit_server_pin`の初期値として書き込む形に作り替える)方が、②-bの自動分散の意図とより素直に噛み合う可能性がある(本設計の範囲外として提案のみ)。

---

以上。
