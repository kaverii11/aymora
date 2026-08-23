import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
import { config, flags } from "../../config.js";

/**
 * Razorpay client, TEST MODE ONLY (per this project's payments decision — see
 * docs/backend-architecture-prompt.md section 7). RAZORPAY_KEY_ID/SECRET must
 * come from the Razorpay dashboard's Test Mode toggle. Nothing in this file
 * distinguishes test vs. live keys — that distinction lives entirely in which
 * keys you paste into .env. Never put live keys in this project without a
 * deliberate, separate decision about handling real money and KYC.
 */
export const razorpay = flags.paymentsEnabled
  ? new Razorpay({ key_id: config.RAZORPAY_KEY_ID, key_secret: config.RAZORPAY_KEY_SECRET })
  : null;

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  if (!config.RAZORPAY_WEBHOOK_SECRET) return false;

  const expected = createHmac("sha256", config.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}
