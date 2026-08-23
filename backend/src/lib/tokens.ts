import { createHash, randomBytes, randomInt } from "node:crypto";

/** A random URL-safe token for email verification / magic links, plus its hash for storage. */
export function generateOpaqueToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** A 6-digit numeric code for the mock OTP provider. */
export function generateOtpCode(): { code: string; hash: string } {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  return { code, hash: hashToken(code) };
}
