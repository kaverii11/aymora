import { logger } from "../../lib/logger.js";
import { findUserById } from "../auth/repository.js";
import { getProfile } from "../profiling/repository.js";
import * as chatRepo from "../chat/repository.js";
import type { PersonalityProfile } from "../../providers/ai/gemini.js";
import * as repo from "./repository.js";
import type { CandidateRow } from "./repository.js";

const CANDIDATES_TO_PERSIST = 20;

/**
 * Stage 2: explainable re-ranking. Kept as plain, inspectable arithmetic
 * (not a second LLM call) so a bad match can be debugged — see
 * docs/backend-architecture-prompt.md section 6.
 *
 * Returns null if the candidate is hard-filtered out (a stated dealbreaker
 * of the user's shows up in the candidate's profile text) — dealbreakers are
 * a filter, not a score penalty.
 */
export function scoreCandidate(
  userProfile: PersonalityProfile,
  candidate: CandidateRow,
): number | null {
  const candidateText = [
    candidate.profile.summary,
    ...candidate.profile.coreValues,
    candidate.profile.communicationStyle,
    candidate.profile.attachmentTendency,
    candidate.profile.relationshipGoals,
  ]
    .join(" ")
    .toLowerCase();

  for (const dealbreaker of userProfile.dealbreakers) {
    const needle = dealbreaker.trim().toLowerCase();
    if (needle.length > 0 && candidateText.includes(needle)) {
      return null;
    }
  }

  const valuesOverlap = jaccardOverlap(userProfile.coreValues, candidate.profile.coreValues);
  const goalMatch =
    userProfile.relationshipGoals.trim().toLowerCase() ===
    candidate.profile.relationshipGoals.trim().toLowerCase()
      ? 1
      : 0;

  return candidate.similarity * 0.7 + valuesOverlap * 0.2 + goalMatch * 0.1;
}

function jaccardOverlap(a: string[], b: string[]): number {
  const setA = new Set(a.map((v) => v.toLowerCase()));
  const setB = new Set(b.map((v) => v.toLowerCase()));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const v of setA) if (setB.has(v)) intersection++;
  const union = setA.size + setB.size - intersection;

  return union === 0 ? 0 : intersection / union;
}

export async function generateAndPersistCandidates(userId: string): Promise<void> {
  const [user, profileRow] = await Promise.all([findUserById(userId), getProfile(userId)]);
  if (!user || !profileRow) {
    logger.warn({ userId }, "cannot generate match candidates: user or profile missing");
    return;
  }

  // Need the raw embedding back out to pass into the pool query. Postgres
  // returns pgvector columns as a string like "[0.1,0.2,...]" via node-pg.
  const embedding = parsePgVector(profileRow.embedding);

  const pool = await repo.generateCandidatePool(userId, embedding, user.gender, user.seeking);

  const scored = pool
    .map((c) => ({ candidateId: c.candidate_id, score: scoreCandidate(profileRow.profile, c) }))
    .filter((c): c is { candidateId: string; score: number } => c.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATES_TO_PERSIST);

  await repo.persistCandidates(userId, scored);
  logger.info({ userId, count: scored.length }, "match candidates generated");
}

function parsePgVector(raw: string): number[] {
  return raw
    .slice(1, -1)
    .split(",")
    .map(Number);
}

export interface NextMatchResult {
  matchCandidateId: string;
  candidateId: string;
  score: number;
  candidate: repo.CandidatePreview | null;
}

/** "One intentional introduction at a time" (landing page copy) — always at most one pending, unpresented candidate is surfaced. */
export async function getNextMatch(userId: string): Promise<NextMatchResult | null> {
  const next = await repo.getNextForUser(userId);
  if (!next) return null;

  if (!next.presented_at) {
    await repo.markPresented(next.id);
  }

  const candidate = await repo.getCandidatePreview(next.candidate_id);

  return {
    matchCandidateId: next.id,
    candidateId: next.candidate_id,
    score: Number(next.score),
    candidate,
  };
}

export type DecideOutcome = "recorded" | "not_found" | "mutual_match";

export async function decide(
  userId: string,
  candidateId: string,
  interested: boolean,
): Promise<DecideOutcome> {
  const pending = await repo.findPendingCandidate(userId, candidateId);
  if (!pending) return "not_found";

  await repo.decide(pending.id, interested ? "interested" : "passed");
  if (!interested) return "recorded";

  const reverseStatus = await repo.getDirectionalStatus(candidateId, userId);
  if (reverseStatus !== "interested") return "recorded";

  const match = await chatRepo.createMatch(userId, candidateId);
  if (match) {
    await chatRepo.createConversation(match.id);
    logger.info({ userId, candidateId, matchId: match.id }, "mutual match created");
  }
  return "mutual_match";
}
