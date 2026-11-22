// /adminと/admin/loginへの遷移中(Server Componentのデータ取得待ち)に
// 表示される(/admin/login配下に専用のloading.tsxが無いため、Next.jsの
// ファイル規約でこのファイルが両方に効く)。画面が切り替わるまで数秒
// かかり、何も表示されないと固まったように見えていたため追加した。
export default function AdminLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        Loading...
      </div>
    </div>
  );
}
