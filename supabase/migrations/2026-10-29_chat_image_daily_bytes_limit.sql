-- ============================================================
-- チャット画像:1日あたりの合計サイズ上限 対応マイグレーション
-- ============================================================
-- 目的: 既存の「1日30枚まで」という枚数上限に加え、圧縮後の合計サイズ
-- (本文画像+サムネイル)でもプランごとの上限を設ける。Supabaseの通信量・
-- 保存容量の予測を立てやすくするため。
--
-- 新しいテーブルは作らず、既存のdaily_usageテーブル(screen_share/
-- video_call/voice_call/image_uploadの日次カウントに使っている、
-- user_id+day_key+kindキーの汎用テーブル)に新しいkind='image_bytes'を
-- 追加するだけの、軽量な追加専用の変更。既存データは一切書き換えない。
--
-- 「1日」の区切りは、既存の全ての日次上限(画面共有・通話の分数、画像
-- 30枚/日)と揃えて日本時間4:00とする。
--
-- [レビュー指摘による設計変更]
-- 加算関数(increment_daily_image_bytes)は、加算量(p_bytes)を呼び出し側が
-- 自由に指定できる。もしこれをauthenticatedから直接RPCで呼べる状態に
-- すると、ユーザーが自分のセッションから直接
-- supabase.rpc('increment_daily_image_bytes', {p_bytes: -999999999, ...})
-- のように負の値を渡すことで使用量を実質無限に減らし、上限チェックを
-- すり抜けられてしまう(枚数用のincrement_daily_image_upload_countは
-- 常に+1固定・分数用のincrement_daily_usage_secondsはgreatest(0,least(...,60))
-- でクランプしているため、この抜け道はバイト数版に固有)。
-- そのためこの関数はservice_role専用とし、authenticated/anon/publicの
-- 実行権限を外す。呼び出し元はapp/api/chat/compress-image/route.tsのみとし、
-- ユーザーIDはSECURITY DEFINER内のauth.uid()ではなく、サーバー側で
-- セッション検証済みのユーザーID(p_user_id)を明示的に渡す形にする
-- (service_roleでの呼び出しはauth.uid()がnullになるため、そもそも
-- auth.uid()には頼れない)。p_bytes<=0は関数内でも例外にし、万一
-- compress-image側にバグがあっても0以下の値では絶対に加算されないようにする。
--
-- 全体をトランザクションで囲み、途中のどこかで失敗したら全て
-- ロールバックされるようにする。
-- ============================================================

begin;


-- 1. daily_usageに合計バイト数の列を追加。
alter table public.daily_usage add column if not exists used_bytes bigint not null default 0;


-- 2. kindの許可リストに'image_bytes'を追加。
alter table public.daily_usage drop constraint if exists daily_usage_kind_check;
alter table public.daily_usage add constraint daily_usage_kind_check
  check (kind in ('screen_share', 'video_call', 'voice_call', 'image_upload', 'image_bytes'));


-- 3. 合計バイト数の加算+上限チェック(アトミック)。service_role専用。
--
-- 既存のincrement_daily_image_upload_count(枚数用)は
-- 「on conflict ... do update ... where used_count < p_limit」という
-- 書き方だが、これは「その日1件目」を無条件に通してしまう(枚数+1なら
-- 問題ないが、バイト数だと「1件目の圧縮サイズだけで上限を超える」
-- ケースを見逃してしまう)。そのためこの関数は、行が無ければ0件で
-- INSERTしてからselect ... for updateで行ロックし、「現在値+追加分が
-- 上限を超えないか」を明示的に判定してからUPDATEする、より厳密な書き方
-- にしている(行ロックにより同時リクエストでも正しく判定できる)。
drop function if exists public.increment_daily_image_bytes(bigint, bigint);
drop function if exists public.increment_daily_image_bytes(uuid, bigint, bigint);

create function public.increment_daily_image_bytes(
  p_user_id uuid,
  p_bytes bigint,
  p_limit bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day_key date;
  v_current bigint;
  v_total bigint;
begin
  if p_user_id is null then
    raise exception 'p_user_idが必要です';
  end if;
  if p_bytes <= 0 then
    raise exception 'p_bytesは正の値である必要があります';
  end if;
  v_day_key := (timezone('Asia/Tokyo', now()) - interval '4 hours')::date;

  insert into public.daily_usage (user_id, day_key, kind, used_bytes)
  values (p_user_id, v_day_key, 'image_bytes', 0)
  on conflict (user_id, day_key, kind) do nothing;

  select used_bytes into v_current
  from public.daily_usage
  where user_id = p_user_id and day_key = v_day_key and kind = 'image_bytes'
  for update;

  if p_limit is not null and v_current + p_bytes > p_limit then
    -- 上限を超えるため加算しない。呼び出し元はこれを「今回の送信は拒否」
    -- として扱う。
    return null;
  end if;

  update public.daily_usage
  set used_bytes = used_bytes + p_bytes, updated_at = now()
  where user_id = p_user_id and day_key = v_day_key and kind = 'image_bytes'
  returning used_bytes into v_total;

  return v_total;
end;
$$;

revoke all on function public.increment_daily_image_bytes(uuid, bigint, bigint) from public;
revoke all on function public.increment_daily_image_bytes(uuid, bigint, bigint) from anon;
revoke all on function public.increment_daily_image_bytes(uuid, bigint, bigint) from authenticated;
grant execute on function public.increment_daily_image_bytes(uuid, bigint, bigint) to service_role;


-- 4. 本日の使用済みバイト数を取得する「読み取り専用」関数。
--    こちらはauth.uid()ベースのまま、authenticatedに公開してよい
--    (自分自身の使用量を読むだけで、何かを書き換えたり上限判定を
--    左右したりはできないため、increment関数とは性質が異なる)。
--    クライアント側の送信前チェック(UX向上目的)・compress-imageの
--    早期チェックの両方から使う。
drop function if exists public.get_daily_image_bytes_used();

create function public.get_daily_image_bytes_used()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day_key date;
  v_total bigint;
begin
  if auth.uid() is null then
    return 0;
  end if;
  v_day_key := (timezone('Asia/Tokyo', now()) - interval '4 hours')::date;
  select used_bytes into v_total
  from public.daily_usage
  where user_id = auth.uid() and day_key = v_day_key and kind = 'image_bytes';
  return coalesce(v_total, 0);
end;
$$;

revoke all on function public.get_daily_image_bytes_used() from public;
revoke all on function public.get_daily_image_bytes_used() from anon;
grant execute on function public.get_daily_image_bytes_used() to authenticated;


commit;
