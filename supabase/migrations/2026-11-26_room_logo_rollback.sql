-- ②-2(2026-11-26_room_logo.sql)を元に戻すSQL。
--
-- room-logosバケットのポリシー2つ・roomsのトリガー・専用の関数3つ
-- (prevent_room_logo_self_write・is_room_owner・get_room_logo_info)・
-- rooms.logo_image_url列を削除する(ポリシー → 関数 → トリガー → 関数
-- → 列の順。バケットは下の理由で消さない)。
--
-- 注意: ロゴのコード(画面側)を本番に出した後にこのSQLを実行すると、
-- その時点でまだ存在しない列・関数を読み書きしようとして会議室と
-- ロビーの読み込みが失敗する。このSQLを実行する前に、必ず画面側の
-- コードを先に元に戻しておくこと。
--
-- バケット room-logos は、Supabase が SQL での直接の削除を止める
-- (storage.protect_delete)ため、このSQLでは消さない。消す必要がある
-- 時は、相談したうえで、Supabase の Storage の画面から中身を空にして
-- から消すこと。ポリシーは上で削除するため、ポリシーが無ければログイン
-- した人からの読み書きはできない(公開バケットのため、URL を知って
-- いれば読める)。
--
-- 適用方法: Supabase の SQL Editor から、このファイルの内容をそのまま
-- 直接実行する。
--
-- ほかのファイルとの関係:
-- - 元に戻す対象の本体は、同じフォルダの
--   2026-11-26_room_logo.sql。

begin;

drop policy if exists "room-logos: owner insert raw" on storage.objects;
drop policy if exists "room-logos: public read" on storage.objects;

drop function if exists public.get_room_logo_info(uuid);
drop function if exists public.is_room_owner(uuid);

drop trigger if exists rooms_prevent_logo_self_write on public.rooms;
drop function if exists public.prevent_room_logo_self_write();

alter table public.rooms
  drop column if exists logo_image_url;

commit;
