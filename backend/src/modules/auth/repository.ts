import { query, queryOne } from "../../db/client.js";

export interface User {
  id: string;
  waitlist_entry_id: string | null;
  email: string;
  phone: string | null;
  phone_verified_at: string | null;
  date_of_birth: string;
  gender: string | null;
  seeking: string[];
  city: string | null;
  onboarding_status: string;
  created_at: string;
}

export interface CreateUserInput {
  email: string;
  dateOfBirth: string; // YYYY-MM-DD
  gender?: string | null;
  seeking?: string[];
  city?: string | null;
  waitlistEntryId?: string | null;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  return queryOne<User>("select * from users where email = $1", [email]);
}

export async function findUserById(id: string): Promise<User | null> {
  return queryOne<User>("select * from users where id = $1", [id]);
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const row = await queryOne<User>(
    `insert into users (email, date_of_birth, gender, seeking, city, waitlist_entry_id)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [
      input.email,
      input.dateOfBirth,
      input.gender ?? null,
      input.seeking ?? [],
      input.city ?? null,
      input.waitlistEntryId ?? null,
    ],
  );
  if (!row) throw new Error("failed to create user");
  return row;
}

export async function updateOnboardingStatus(userId: string, status: string): Promise<void> {
  await query("update users set onboarding_status = $2, updated_at = now() where id = $1", [
    userId,
    status,
  ]);
}

// --- Email auth tokens (magic link) ---

export interface EmailAuthToken {
  id: string;
  user_id: string;
  token_hash: string;
  purpose: "login" | "signup_verify";
  expires_at: string;
  consumed_at: string | null;
}

export async function createEmailAuthToken(
  userId: string,
  tokenHash: string,
  purpose: "login" | "signup_verify",
  expiresAt: Date,
): Promise<void> {
  await query(
    `insert into email_auth_tokens (user_id, token_hash, purpose, expires_at)
     values ($1, $2, $3, $4)`,
    [userId, tokenHash, purpose, expiresAt.toISOString()],
  );
}

export async function findValidEmailAuthToken(tokenHash: string): Promise<EmailAuthToken | null> {
  return queryOne<EmailAuthToken>(
    `select * from email_auth_tokens
      where token_hash = $1 and consumed_at is null and expires_at > now()`,
    [tokenHash],
  );
}

export async function consumeEmailAuthToken(id: string): Promise<void> {
  await query("update email_auth_tokens set consumed_at = now() where id = $1", [id]);
}

// --- Refresh tokens ---

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
}

export async function createRefreshToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await query(
    `insert into refresh_tokens (user_id, token_hash, expires_at) values ($1, $2, $3)`,
    [userId, tokenHash, expiresAt.toISOString()],
  );
}

export async function findValidRefreshToken(tokenHash: string): Promise<RefreshTokenRow | null> {
  return queryOne<RefreshTokenRow>(
    `select * from refresh_tokens
      where token_hash = $1 and revoked_at is null and expires_at > now()`,
    [tokenHash],
  );
}

export async function revokeRefreshTokenByHash(tokenHash: string): Promise<void> {
  await query("update refresh_tokens set revoked_at = now() where token_hash = $1", [tokenHash]);
}

// --- Phone OTP (mock provider, see providers/otp) ---

export async function createOtpCode(
  userId: string,
  phone: string,
  codeHash: string,
  expiresAt: Date,
): Promise<void> {
  await query(
    `insert into phone_otp_codes (user_id, phone, code_hash, expires_at)
     values ($1, $2, $3, $4)`,
    [userId, phone, codeHash, expiresAt.toISOString()],
  );
}

export interface OtpCodeRow {
  id: string;
  user_id: string;
  phone: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  consumed_at: string | null;
}

export async function findLatestOtpCode(userId: string): Promise<OtpCodeRow | null> {
  return queryOne<OtpCodeRow>(
    `select * from phone_otp_codes
      where user_id = $1 and consumed_at is null
      order by created_at desc
      limit 1`,
    [userId],
  );
}

export async function incrementOtpAttempts(id: string): Promise<void> {
  await query("update phone_otp_codes set attempts = attempts + 1 where id = $1", [id]);
}

export async function consumeOtpCode(id: string): Promise<void> {
  await query("update phone_otp_codes set consumed_at = now() where id = $1", [id]);
}

export async function setPhoneVerified(userId: string, phone: string): Promise<void> {
  await query(
    "update users set phone = $2, phone_verified_at = now(), updated_at = now() where id = $1",
    [userId, phone],
  );
}
