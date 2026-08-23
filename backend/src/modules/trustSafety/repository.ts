import { query, queryOne } from "../../db/client.js";

// --- Consent (DPDP Act 2023) ---

export async function recordConsent(
  userId: string,
  policyVersion: string,
  ipHash: string | null,
): Promise<void> {
  await query(
    `insert into consent_records (user_id, policy_version, ip_hash) values ($1, $2, $3)`,
    [userId, policyVersion, ipHash],
  );
}

// --- Blocks ---

export async function createBlock(blockerId: string, blockedId: string): Promise<void> {
  await query(
    `insert into blocks (blocker_id, blocked_id) values ($1, $2)
     on conflict (blocker_id, blocked_id) do nothing`,
    [blockerId, blockedId],
  );
  // A block should immediately kill any pending match candidates between the
  // two, in both directions, per docs/backend-architecture-prompt.md section 8.
  await query(
    `update match_candidates set status = 'expired', decided_at = now()
      where status = 'pending'
        and ((user_id = $1 and candidate_id = $2) or (user_id = $2 and candidate_id = $1))`,
    [blockerId, blockedId],
  );
}

export async function removeBlock(blockerId: string, blockedId: string): Promise<void> {
  await query("delete from blocks where blocker_id = $1 and blocked_id = $2", [
    blockerId,
    blockedId,
  ]);
}

export async function isBlocked(userIdA: string, userIdB: string): Promise<boolean> {
  const row = await queryOne(
    `select 1 from blocks
      where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1)
      limit 1`,
    [userIdA, userIdB],
  );
  return row !== null;
}

export async function listBlockedIds(userId: string): Promise<string[]> {
  const rows = await query<{ blocked_id: string }>(
    "select blocked_id from blocks where blocker_id = $1",
    [userId],
  );
  return rows.map((r) => r.blocked_id);
}

// --- Reports ---

export interface CreateReportInput {
  reporterId: string;
  reportedId: string;
  reason: string;
  details?: string | null;
}

export async function createReport(input: CreateReportInput): Promise<void> {
  await query(
    `insert into reports (reporter_id, reported_id, reason, details) values ($1, $2, $3, $4)`,
    [input.reporterId, input.reportedId, input.reason, input.details ?? null],
  );
}

export async function listOpenReports(): Promise<Record<string, unknown>[]> {
  return query(
    `select id, reporter_id, reported_id, reason, details, status, created_at
       from reports
      where status = 'open'
      order by created_at asc`,
  );
}

export async function resolveReport(id: string, status: "resolved" | "dismissed"): Promise<void> {
  await query("update reports set status = $2, resolved_at = now() where id = $1", [id, status]);
}

// --- Data subject requests (export / deletion) ---

export async function createDataSubjectRequest(
  userId: string,
  type: "export" | "deletion",
): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `insert into data_subject_requests (user_id, type) values ($1, $2) returning id`,
    [userId, type],
  );
  if (!row) throw new Error("failed to create data subject request");
  return row.id;
}

export async function completeDataSubjectRequest(id: string): Promise<void> {
  await query(
    "update data_subject_requests set status = 'completed', completed_at = now() where id = $1",
    [id],
  );
}
