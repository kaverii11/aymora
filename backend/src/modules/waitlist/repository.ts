import type { PoolClient } from "pg";
import { query, queryOne, withTransaction } from "../../db/client.js";

export interface WaitlistEntry {
  id: string;
  email: string;
  status: "pending_verification" | "verified" | "removed";
  verification_token_hash: string | null;
  token_expires_at: string | null;
  verified_at: string | null;
  rank: number | null;
  created_at: string;
}

export interface CreateWaitlistEntryInput {
  email: string;
  tokenHash: string;
  tokenExpiresAt: Date;
  utmSource?: string | null;
  utmCampaign?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
}

export async function findByEmail(email: string): Promise<WaitlistEntry | null> {
  return queryOne<WaitlistEntry>("select * from waitlist_entries where email = $1", [email]);
}

export async function createEntry(input: CreateWaitlistEntryInput): Promise<WaitlistEntry> {
  const row = await queryOne<WaitlistEntry>(
    `insert into waitlist_entries
       (email, verification_token_hash, token_expires_at, utm_source, utm_campaign, ip_hash, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [
      input.email,
      input.tokenHash,
      input.tokenExpiresAt.toISOString(),
      input.utmSource ?? null,
      input.utmCampaign ?? null,
      input.ipHash ?? null,
      input.userAgent ?? null,
    ],
  );
  if (!row) throw new Error("failed to create waitlist entry");
  return row;
}

export async function rotateVerificationToken(
  entryId: string,
  tokenHash: string,
  tokenExpiresAt: Date,
): Promise<void> {
  await query(
    `update waitlist_entries
       set verification_token_hash = $2, token_expires_at = $3
     where id = $1`,
    [entryId, tokenHash, tokenExpiresAt.toISOString()],
  );
}

export async function findPendingByTokenHash(tokenHash: string): Promise<WaitlistEntry | null> {
  return queryOne<WaitlistEntry>(
    `select * from waitlist_entries
      where verification_token_hash = $1
        and status = 'pending_verification'`,
    [tokenHash],
  );
}

/**
 * Verifies an entry and assigns it the next sequential rank, atomically.
 * Uses `select ... for update` on a single counter row so concurrent
 * verifications can't race into the same rank (see migrations/001, and
 * docs/backend-architecture-prompt.md section 3.1 on why rank is assigned
 * here rather than via a plain sequence).
 */
export async function verifyAndAssignRank(entryId: string): Promise<WaitlistEntry> {
  return withTransaction(async (client: PoolClient) => {
    const counter = await client.query<{ next_rank: number }>(
      "select next_rank from waitlist_rank_counter where id = true for update",
    );
    const nextRank = counter.rows[0]?.next_rank;
    if (nextRank === undefined) throw new Error("waitlist_rank_counter row missing");

    await client.query("update waitlist_rank_counter set next_rank = $1 where id = true", [
      nextRank + 1,
    ]);

    const result = await client.query<WaitlistEntry>(
      `update waitlist_entries
         set status = 'verified', verified_at = now(), rank = $2
       where id = $1
       returning *`,
      [entryId, nextRank],
    );
    const row = result.rows[0];
    if (!row) throw new Error("waitlist entry disappeared during verification");
    return row;
  });
}

export async function countVerified(): Promise<number> {
  const row = await queryOne<{ count: string }>(
    "select count(*)::text as count from waitlist_entries where status = 'verified'",
  );
  return Number(row?.count ?? 0);
}
