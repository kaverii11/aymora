import { logger } from "../../lib/logger.js";

/**
 * Mock phone-OTP provider (deliberate product decision, see
 * docs/backend-architecture-prompt.md section 6 / the "Phone OTP" question
 * this session was asked: real SMS costs money at any real volume, so this
 * project does not send SMS). The code is logged instead of sent.
 *
 * Swapping in a real provider later (MSG91, Twilio Verify) means implementing
 * this same `sendOtpSms` interface and changing one import — the DB schema
 * (phone_otp_codes) and the verify/consume flow are already provider-agnostic.
 */
export async function sendOtpSms(phone: string, code: string): Promise<void> {
  logger.info({ phone, code }, "[mock SMS provider] OTP code (not actually sent)");
}
