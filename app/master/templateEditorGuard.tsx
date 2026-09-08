"use client";

import { createContext, useContext } from "react";

// テンプレート編集画面(TemplateEditor)で保存していないレイアウト変更が
// ある状態のまま、MasterDashboardのサイドバー(他のタブ・「管理画面へ」・
// 「ルームへ」)経由で画面遷移しようとした際に、確認ポップアップを挟む
// ための橋渡し。TemplateEditorはマウント中だけ自分自身をこのcontext経由で
// 登録し、MasterDashboard側のナビゲーション処理がそれを見て判断する
// (親子が離れているため、propsのバケツリレーではなくcontextを使う)。
export type TemplateEditorGuard = {
  isDirty: () => boolean;
  // 保存を実行する。falseを返した場合は保存失敗のため遷移させない。
  save: () => Promise<boolean>;
};

export const TemplateEditorGuardContext = createContext<{
  setGuard: (guard: TemplateEditorGuard | null) => void;
} | null>(null);

export function useTemplateEditorGuard() {
  return useContext(TemplateEditorGuardContext);
}
