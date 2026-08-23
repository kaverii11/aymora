import { config } from "../../config.js";
import { isDisposableEmail } from "../../lib/disposableEmail.js";
import { logger } from "../../lib/logger.js";
import { redis } from "../../lib/redis.js";
import { generateOpaqueToken, hashToken } from "../../lib/tokens.js";
import { sendEmail, verificationEmailHtml } from "../../providers/email/index.js";
import * as repo from "./repository.js";

const TOKEN_TTL_HOURS = 24;
const COUNT_CACHE_KEY = "waitlist:verified_count";
const COUNT_CACHE_TTL_SECONDS = 30;

export class DisposableEmailError extends Error {}

export interface SignupInput {
  email: string;
  utmSource?: string | null;
  utmCampaign?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Always resolves (never throws for "already signed up") so the API layer
 * can return a uniform 202 regardless of whether the email already exists —
 * see docs/backend-architecture-prompt.md section 3.2: don't leak which
 * emails are already registered.
 */
export async function signup(input: SignupInput): Promise<void> {
  const email = input.email.trim().toLowerCase();

  if (isDisposableEmail(email)) {
    throw new DisposableEmailError("disposable email domains are not allowed");
  }

  const existing = await repo.findByEmail(email);
  const { raw, hash } = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);
  const ipHash = input.ip ? hashToken(input.ip) : null;

  if (!existing) {
    await repo.createEntry({
      email,
      tokenHash: hash,
      tokenExpiresAt: expiresAt,
      utmSource: input.utmSource,
      utmCampaign: input.utmCampaign,
      ipHash,
      userAgent: input.userAgent,
    });
    await sendVerificationEmail(email, raw);
    return;
  }

  if (existing.status === "verified") {
    // Already on the list — silently no-op rather than revealing that fact
    // to the caller via a different response shape.
    return;
  }

  if (existing.status === "pending_verification") {
    await repo.rotateVerificationToken(existing.id, hash, expiresAt);
    await sendVerificationEmail(email, raw);
    return;
  }
  // status === 'removed': deliberately do nothing.
}

async function sendVerificationEmail(email: string, rawToken: string): Promise<void> {
  const verifyUrl = `${config.APP_BASE_URL}/api/waitlist/verify?token=${encodeURIComponent(rawToken)}`;
  await sendEmail({
    to: email,
    subject: "Confirm your spot on the Aymora waitlist",
    html: verificationEmailHtml(verifyUrl),
  });
}

export type VerifyResult =
  | { outcome: "verified"; rank: number }
  | { outcome: "invalid_or_expired" };

export async function verify(rawToken: string): Promise<VerifyResult> {
  const tokenHash = hashToken(rawToken);
  const entry = await repo.findPendingByTokenHash(tokenHash);

  if (!entry) return { outcome: "invalid_or_expired" };

  if (!entry.token_expires_at || new Date(entry.token_expires_at) < new Date()) {
    return { outcome: "invalid_or_expired" };
  }

  const verified = await repo.verifyAndAssignRank(entry.id);
  await redis.del(COUNT_CACHE_KEY);

  logger.info({ email: verified.email, rank: verified.rank }, "waitlist entry verified");

  return { outcome: "verified", rank: verified.rank! };
}

export async function getVerifiedCount(): Promise<number> {
  const cached = await redis.get(COUNT_CACHE_KEY);
  if (cached !== null) return Number(cached);

  const count = await repo.countVerified();
  await redis.set(COUNT_CACHE_KEY, count, "EX", COUNT_CACHE_TTL_SECONDS);
  return count;
}

// Re-exported for the future signup->account flow (Phase 2): given a
// verified waitlist row, was this signup within the first 1,000 verified
// (the "Free Aymora Plus" promo threshold from the landing page copy)?
export function qualifiesForLaunchPromo(rank: number | null): boolean {
  return rank !== null && rank <= 1000;
}
