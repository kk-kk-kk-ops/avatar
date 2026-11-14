// 段階0(docs/realtime-authorization-plan.md 6-2節)の「必須更新」判定に
// 使う世代番号。通常のデプロイでは変更しない。段階7のような強制切替を
// 行う回だけ、この値を1つ増やし、同じデプロイでapp_settings.
// min_build_generationも同じ値へ上げる。
//
// .mjs(プレーンJS)にしているのは、ビルド時にpublic/version.jsonを書き出す
// scripts/write-version-file.mjsがNode単体で(TypeScriptのコンパイルを
// 経由せず)この値を読む必要があるため。アプリ側のTSコードからも
// (allowJs/moduleResolution: bundlerの設定により)そのままimportできる。
export const BUILD_GENERATION = 1;
