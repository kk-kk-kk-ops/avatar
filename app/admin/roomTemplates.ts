// ルームテンプレート一覧。今はGrovina Office(既存のmap-background.webp)
// のみだが、後で追加しやすいよう配列にしてある。
// actions.ts("use server")からは非同期関数以外をエクスポートできない
// (Server Actionsファイルの制約)ため、クライアント側でも参照するこの定数は
// 別ファイルに分けている。
export const ROOM_TEMPLATES = [
  {
    id: "grovina-office",
    name: "Grovina Office",
    previewImage: "/map-background.webp",
  },
];
