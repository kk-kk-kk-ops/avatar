// 管理画面モーダル化 M-4(2026-11)。決済・請求ポータルを開いた画面
// ("room"=会議室内のモーダル、"admin"=/adminの請求タブ)を示す印。
// URLそのものを受け渡さず、この2値だけに丸めることで、Stripeの
// success_url/cancel_url/return_url経由で戻ってきた先(app/billing/return)
// が任意のアドレスへ転送されてしまう(オープンリダイレクト)ことを防ぐ。
export type BillingReturnTarget = "room" | "admin";

export function resolveBillingReturnTarget(
  value: string | string[] | undefined,
): BillingReturnTarget {
  return value === "room" ? "room" : "admin";
}
