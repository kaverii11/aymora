import { createHmac, timingSafeEqual } from "node:crypto";
import { config, flags } from "../../config.js";
import { logger } from "../../lib/logger.js";
import { razorpay } from "../../providers/payments/razorpay.js";
import * as repo from "./repository.js";

// Aymora Plus price, paise (INR). Test Mode only — see providers/payments/razorpay.ts.
export const PLUS_PRICE_PAISE = 49_900; // INR 499
const SUBSCRIPTION_PERIOD_DAYS = 30;

export class PaymentsNotConfiguredError extends Error {}
export class InvalidSignatureError extends Error {}

export async function getStatus(userId: string) {
  const active = await repo.findActiveSubscription(userId);
  return { active: active !== null, plan: active?.plan ?? null, source: active?.source ?? null };
}

export async function createCheckoutOrder(userId: string) {
  if (!flags.paymentsEnabled || !razorpay) throw new PaymentsNotConfiguredError();

  const order = await razorpay.orders.create({
    amount: PLUS_PRICE_PAISE,
    currency: "INR",
    receipt: `plus_${userId}_${Date.now()}`,
    notes: { userId, plan: "plus" },
  });

  await repo.createPendingRazorpayOrder(userId, order.id);

  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: config.RAZORPAY_KEY_ID,
  };
}

export interface VerifyPaymentInput {
  orderId: string;
  paymentId: string;
  signature: string;
}

/**
 * Verifies the signature Razorpay Checkout.js hands back on the client after
 * payment. This confirms the payment for the immediate UX (unlock Plus right
 * away); the webhook (webhook.ts) is the durable source of truth in case the
 * browser closes before this call happens.
 */
export async function verifyAndActivate(userId: string, input: VerifyPaymentInput): Promise<void> {
  if (!config.RAZORPAY_KEY_SECRET) throw new PaymentsNotConfiguredError();

  const expected = createHmac("sha256", config.RAZORPAY_KEY_SECRET)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(input.signature, "hex");
  const valid =
    expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);

  if (!valid) throw new InvalidSignatureError();

  await repo.activateByOrderId(input.orderId, input.paymentId, periodEndFromNow());
  logger.info({ userId, orderId: input.orderId }, "Aymora Plus activated via Razorpay checkout");
}

/** Idempotent: safe to call again from the webhook after client-side verifyAndActivate already ran. */
export async function activateFromWebhook(orderId: string, paymentId: string): Promise<void> {
  await repo.activateByOrderId(orderId, paymentId, periodEndFromNow());
}

function periodEndFromNow(): Date {
  return new Date(Date.now() + SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60 * 1000);
}
