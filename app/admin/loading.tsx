// /adminへの遷移中(Server Componentのデータ取得待ち)に表示される。
// 「管理画面へ」を押してから画面が切り替わるまで数秒かかり、何も表示
// されないと固まったように見えていたため追加した。
export default function AdminLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        読み込み中...
      </div>
    </div>
  );
}
