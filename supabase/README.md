# Supabase セットアップ手順

このMVP(①ステップ)は **テーブル不要** です。Supabase Realtimeの
Presence(誰が入室しているか) と Broadcast(移動・チャットの配信) だけで動きます。

## 必要な設定

1. Supabaseプロジェクトを作成
2. `Project Settings > API` から `Project URL` と `anon public key` を取得し
   `.env.local` に設定
3. `Project Settings > Realtime` で Realtime が有効になっていることを確認
   (デフォルトで有効です)

## 今後の拡張(②以降で追加予定)

MetaLifeのように「入室履歴」「アバターの見た目カスタマイズ」「マップの障害物・当たり判定」
「ルームごとのDB管理」まで作り込む場合は、以下のテーブルを追加していきます。

```sql
-- 将来的な拡張用サンプル: プロフィール(ログイン連携する場合)
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  avatar_color text not null default '#3B82F6',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are viewable by everyone"
  on public.profiles for select
  using (true);

create policy "users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);
```

このスキーマは今回のコードではまだ使っていません。ログイン機能や
アバター保存機能を作る段階(②)で接続します。
