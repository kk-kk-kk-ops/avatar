# Avatar Space (① MetaLife参考の2Dリアルタイムアバター空間)

Next.js(App Router) + Supabase Realtime(Presence/Broadcast) + Tailwind CSS で作る
MetaLife風の2Dバーチャルオフィスの土台です。

## できること(①の範囲)

- 矢印キー / WASD でアバターを2Dマップ上で移動
- Supabase Realtimeで複数人の位置をリアルタイム同期(サーバー保存なし・ステートレス)
- 入室者一覧の表示(Presence)
- 簡易チャット(吹き出し表示、Broadcastで配信・DB保存なし)

## セットアップ(VSCode)

```bash
# 1. 依存関係インストール
npm install

# 2. 環境変数を設定
cp .env.local.example .env.local
# .env.local を開き、SupabaseのURLとanon keyを入力

# 3. 開発サーバー起動
npm run dev
```

http://localhost:3000 を2つのタブ(またはシークレットウィンドウ)で開くと、
お互いのアバターがリアルタイムに動くのが確認できます。

## Vercelへのデプロイ

1. GitHubにpush
2. Vercelで「Import Project」→ このリポジトリを選択
3. Environment Variables に `NEXT_PUBLIC_SUPABASE_URL` と
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` を設定
4. Deploy

## ディレクトリ構成

```
avatar-space/
├── app/
│   ├── layout.tsx
│   ├── page.tsx          # AvatarSpaceをssr:falseで読み込み
│   └── globals.css
├── components/
│   ├── AvatarSpace.tsx   # 本体(移動ループ・Realtime同期・チャット)
│   └── Avatar.tsx        # 1体分の描画
├── lib/
│   ├── supabase.ts       # Supabaseクライアント
│   └── types.ts          # PlayerState型・定数
├── supabase/
│   └── README.md         # Supabase設定・今後の拡張用スキーマ
├── .env.local.example
└── package.json
```

## 実装のポイント

- **Presence**: 誰が入室/退室したかの管理に使用(`channel.track()`)
- **Broadcast**: 移動とチャットの配信に使用。動いた時だけ送信して通信量を抑制
- **requestAnimationFrame**: キー入力をポーリングして滑らかに移動、フレームごとに
  自分の位置をローカル反映 → 動いた時のみ他ユーザーへ配信
- テーブル未使用のステートレス構成なので、まずはこれで「動く」ことを確認できます

## 次のステップ(②以降の候補)

- ログイン(Supabase Auth)してアバターの見た目・名前を保存
- マップに机・椅子などのオブジェクトを配置し、当たり判定を追加
- 近くにいる人だけで会話できるProximity Chat(現状はマップ全体にブロードキャスト)
- 画像アバター(Figmaで作成したスプライト)への差し替え
- ルーム分け(会議室・執務スペースなど複数チャンネル化)
