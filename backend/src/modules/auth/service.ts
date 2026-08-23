import { config } from "../../config.js";
import { logger } from "../../lib/logger.js";
import { redis } from "../../lib/redis.js";
import { signAccessToken } from "../../lib/jwt.js";
import { generateOpaqueToken, generateOtpCode, hashToken } from "../../lib/tokens.js";
import { magicLinkEmailHtml, sendEmail } from "../../providers/email/index.js";
import { sendOtpSms } from "../../providers/otp/index.js";
import * as waitlistRepo from "../waitlist/repository.js";
import { qualifiesForLaunchPromo } from "../waitlist/service.js";
import * as subscriptionsRepo from "../subscriptions/repository.js";
import * as trustSafetyRepo from "../trustSafety/repository.js";
import * as repo from "./repository.js";
import type { User } from "./repository.js";

const MAGIC_LINK_TTL_MINUTES = 15;
const EXCHANGE_CODE_TTL_SECONDS = 60;
const REFRESH_TOKEN_TTL_DAYS = 30;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const CURRENT_POLICY_VERSION = "privacy-policy-v1";

export class ValidationError extends Error {}

export interface SignupInput {
  email: string;
  displayName: string;
  dateOfBirth: string;
  gender?: string;
  seeking?: string[];
  city?: string;
  ip?: string | null;
}

export async function signup(input: SignupInput): Promise<void> {
  const email = input.email.trim().toLowerCase();

  if (isUnder18(input.dateOfBirth)) {
    throw new ValidationError("must be 18 or older");
  }

  const existing = await repo.findUserByEmail(email);
  if (existing) {
    // Don't leak account existence; just send them a login link instead.
    await requestLogin(email);
    return;
  }

  const waitlistEntry = await waitlistRepo.findByEmail(email);
  const linkedWaitlistId =
    waitlistEntry?.status === "verified" ? waitlistEntry.id : null;

  const user = await repo.createUser({
    email,
    displayName: input.displayName.trim(),
    dateOfBirth: input.dateOfBirth,
    gender: input.gender,
    seeking: input.seeking,
    city: input.city,
    waitlistEntryId: linkedWaitlistId,
  });

  const ipHash = input.ip ? hashToken(input.ip) : null;
  await trustSafetyRepo.recordConsent(user.id, CURRENT_POLICY_VERSION, ipHash);

  if (waitlistEntry && qualifiesForLaunchPromo(waitlistEntry.rank)) {
    await subscriptionsRepo.grantWaitlistPromo(user.id);
    logger.info({ userId: user.id }, "granted waitlist launch promo (Aymora Plus)");
  }

  await sendMagicLink(user, "signup_verify");
}

export async function getUser(userId: string): Promise<User | null> {
  return repo.findUserById(userId);
}

export async function requestLogin(email: string): Promise<void> {
  const user = await repo.findUserByEmail(email.trim().toLowerCase());
  if (!user) return; // don't leak account existence
  await sendMagicLink(user, "login");
}

async function sendMagicLink(user: User, purpose: "login" | "signup_verify"): Promise<void> {
  const { raw, hash } = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60 * 1000);
  await repo.createEmailAuthToken(user.id, hash, purpose, expiresAt);

  const loginUrl = `${config.APP_BASE_URL}/api/auth/callback?token=${encodeURIComponent(raw)}`;
  await sendEmail({
    to: user.email,
    subject: "Your Aymora sign-in link",
    html: magicLinkEmailHtml(loginUrl),
  });
}

export type CallbackResult = { outcome: "invalid_or_expired" } | { outcome: "ok"; code: string };

/**
 * Consumes a magic-link token and mints a short-lived, single-use exchange
 * code in Redis rather than handing back real tokens over a GET request —
 * GET URLs end up in browser history / referrer headers / server logs, which
 * is a bad place for a long-lived refresh token to live. The frontend is
 * expected to redirect here, grab `code` from the query string, and
 * immediately POST it to /api/auth/exchange.
 */
export async function consumeMagicLink(rawToken: string): Promise<CallbackResult> {
  const tokenHash = hashToken(rawToken);
  const entry = await repo.findValidEmailAuthToken(tokenHash);
  if (!entry) return { outcome: "invalid_or_expired" };

  await repo.consumeEmailAuthToken(entry.id);

  const code = generateOpaqueToken().raw;
  await redis.set(`auth:exchange:${code}`, entry.user_id, "EX", EXCHANGE_CODE_TTL_SECONDS);

  return { outcome: "ok", code };
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export async function exchangeCode(code: string): Promise<TokenPair | null> {
  const key = `auth:exchange:${code}`;
  const userId = await redis.get(key);
  if (!userId) return null;
  await redis.del(key);

  const user = await repo.findUserById(userId);
  if (!user) return null;

  return issueTokenPair(user);
}

async function issueTokenPair(user: User): Promise<TokenPair> {
  const accessToken = signAccessToken({ sub: user.id, onboardingStatus: user.onboarding_status });

  const { raw: refreshRaw, hash: refreshHash } = generateOpaqueToken();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await repo.createRefreshToken(user.id, refreshHash, refreshExpiresAt);

  return { accessToken, refreshToken: refreshRaw, user };
}

export async function refresh(rawRefreshToken: string): Promise<TokenPair | null> {
  const tokenHash = hashToken(rawRefreshToken);
  const row = await repo.findValidRefreshToken(tokenHash);
  if (!row) return null;

  // Rotate: revoke the old refresh token, issue a fresh pair.
  await repo.revokeRefreshTokenByHash(tokenHash);

  const user = await repo.findUserById(row.user_id);
  if (!user) return null;

  return issueTokenPair(user);
}

export async function logout(rawRefreshToken: string): Promise<void> {
  await repo.revokeRefreshTokenByHash(hashToken(rawRefreshToken));
}

// --- Phone OTP (mock provider — see providers/otp) ---

export async function startPhoneVerification(userId: string, phone: string): Promise<void> {
  const { code, hash } = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  await repo.createOtpCode(userId, phone, hash, expiresAt);
  await sendOtpSms(phone, code);
}

export type OtpVerifyResult = "verified" | "invalid" | "expired" | "too_many_attempts";

export async function verifyPhoneOtp(userId: string, code: string): Promise<OtpVerifyResult> {
  const otp = await repo.findLatestOtpCode(userId);
  if (!otp) return "invalid";

  if (otp.attempts >= OTP_MAX_ATTEMPTS) return "too_many_attempts";
  if (new Date(otp.expires_at) < new Date()) return "expired";

  if (hashToken(code) !== otp.code_hash) {
    await repo.incrementOtpAttempts(otp.id);
    return "invalid";
  }

  await repo.consumeOtpCode(otp.id);
  await repo.setPhoneVerified(userId, otp.phone);
  return "verified";
}

function isUnder18(dateOfBirth: string): boolean {
  const dob = new Date(dateOfBirth);
  const eighteenYearsAgo = new Date();
  eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
  return dob > eighteenYearsAgo;
}
