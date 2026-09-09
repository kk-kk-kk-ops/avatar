import Stripe from "stripe";
import type { PlanId } from "@/lib/types";

// Stripe SDKクライアントの遅延初期化。モジュール読み込み時ではなく
// 呼び出し時に初めて環境変数を読むことで、ビルド時にSTRIPE_SECRET_KEYが
// 無い環境でもimport自体は失敗しないようにする。
let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEYが設定されていません");
  _stripe = new Stripe(key);
  return _stripe;
}

// 有料3プランのみ対象(freeはStripeを一切経由しない)。
export type PaidPlanId = "light" | "standard" | "pro";

const PRICE_ENV_BY_PLAN: Record<PaidPlanId, string> = {
  light: "STRIPE_PRICE_ID_LIGHT",
  standard: "STRIPE_PRICE_ID_STANDARD",
  pro: "STRIPE_PRICE_ID_PRO",
};

export function priceIdForPlan(planId: PaidPlanId): string {
  const envName = PRICE_ENV_BY_PLAN[planId];
  const value = process.env[envName];
  if (!value) throw new Error(`${envName}が設定されていません`);
  return value;
}

// Webhookで受け取ったStripeのprice.idからplanIdへ逆引きする。
export function planIdForPriceId(priceId: string): PlanId | null {
  for (const planId of Object.keys(PRICE_ENV_BY_PLAN) as PaidPlanId[]) {
    if (process.env[PRICE_ENV_BY_PLAN[planId]] === priceId) return planId;
  }
  return null;
}

export function isPaidPlanId(planId: string): planId is PaidPlanId {
  return planId === "light" || planId === "standard" || planId === "pro";
}
