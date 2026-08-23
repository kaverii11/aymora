import { query, queryOne } from "../../db/client.js";
import * as repo from "./repository.js";

export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) throw new Error("cannot block yourself");
  await repo.createBlock(blockerId, blockedId);
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  await repo.removeBlock(blockerId, blockedId);
}

export async function reportUser(input: {
  reporterId: string;
  reportedId: string;
  reason: string;
  details?: string;
}): Promise<void> {
  if (input.reporterId === input.reportedId) throw new Error("cannot report yourself");
  await repo.createReport(input);
}

export async function listOpenReportsForAdmin() {
  return repo.listOpenReports();
}

export async function resolveReportAsAdmin(
  id: string,
  status: "resolved" | "dismissed",
): Promise<void> {
  await repo.resolveReport(id, status);
}

/**
 * DPDP Act 2023 data-portability request: a synchronous self-service export
 * of everything the platform holds tied to this user. Small data volume at
 * MVP scale makes synchronous fulfillment reasonable; a production version
 * at scale would queue this and email a download link instead.
 */
export async function exportUserData(userId: string): Promise<Record<string, unknown>> {
  const requestId = await repo.createDataSubjectRequest(userId, "export");

  const [user, questionnaire, profile, subscriptions, matches, consents] = await Promise.all([
    queryOne("select id, email, phone, date_of_birth, gender, seeking, city, created_at from users where id = $1", [userId]),
    query("select version_id, answers, completed_at from questionnaire_responses where user_id = $1", [userId]),
    query("select profile, generated_at from personality_profiles where user_id = $1", [userId]),
    query("select plan, status, source, created_at from subscriptions where user_id = $1", [userId]),
    query("select id, matched_at from matches where user_a_id = $1 or user_b_id = $1", [userId]),
    query("select policy_version, consented_at from consent_records where user_id = $1", [userId]),
  ]);

  await repo.completeDataSubjectRequest(requestId);

  return { user, questionnaire, profile, subscriptions, matches, consents };
}

/**
 * DPDP Act 2023 right to erasure. Deletes the user row; all dependent rows
 * (questionnaire responses, profile, messages, subscriptions, etc.) cascade
 * via foreign keys declared `on delete cascade` in the migrations. Reports
 * where this user was reporter/reported also cascade — a real compliance
 * review should weigh retention needs for active safety investigations
 * against the erasure right before this ships to real users.
 */
export async function deleteUserData(userId: string): Promise<void> {
  const requestId = await repo.createDataSubjectRequest(userId, "deletion");
  await query("delete from users where id = $1", [userId]);
  await repo.completeDataSubjectRequest(requestId);
}
