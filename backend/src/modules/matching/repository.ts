import { query, queryOne } from "../../db/client.js";
import { toPgVector } from "../../lib/pgvector.js";
import type { PersonalityProfile } from "../../providers/ai/gemini.js";

export interface CandidateRow {
  candidate_id: string;
  similarity: number;
  profile: PersonalityProfile;
}

const CANDIDATE_POOL_SIZE = 50;

/**
 * Stage 1: candidate generation. pgvector cosine-similarity search
 * pre-filtered by hard constraints (mutual gender/seeking compatibility, not
 * already blocked, not already a candidate pair). See
 * docs/backend-architecture-prompt.md section 6 — re-ranking with an
 * explainable score happens in the service layer, not here.
 */
export async function generateCandidatePool(
  userId: string,
  embedding: number[],
  myGender: string | null,
  mySeeking: string[],
): Promise<CandidateRow[]> {
  return query<CandidateRow>(
    `select u.id as candidate_id,
            1 - (pp.embedding <=> $2) as similarity,
            pp.profile
       from users u
       join personality_profiles pp on pp.user_id = u.id
      where u.id <> $1
        and u.onboarding_status in ('profile_generated', 'active')
        and not exists (
          select 1 from match_candidates mc where mc.user_id = $1 and mc.candidate_id = u.id
        )
        and not exists (
          select 1 from blocks b
           where (b.blocker_id = $1 and b.blocked_id = u.id)
              or (b.blocker_id = u.id and b.blocked_id = $1)
        )
        and (cardinality($3::text[]) = 0 or u.gender = any($3::text[]))
        and (cardinality(u.seeking) = 0 or $4::text = any(u.seeking))
      order by pp.embedding <=> $2
      limit ${CANDIDATE_POOL_SIZE}`,
    [userId, toPgVector(embedding), mySeeking, myGender],
  );
}

export interface ScoredCandidate {
  candidateId: string;
  score: number;
}

export async function persistCandidates(
  userId: string,
  candidates: ScoredCandidate[],
): Promise<void> {
  if (candidates.length === 0) return;

  const values: string[] = [];
  const params: unknown[] = [userId];
  candidates.forEach((c, i) => {
    values.push(`($1, $${i * 2 + 2}, $${i * 2 + 3})`);
    params.push(c.candidateId, c.score);
  });

  await query(
    `insert into match_candidates (user_id, candidate_id, score)
     values ${values.join(", ")}
     on conflict (user_id, candidate_id) do nothing`,
    params,
  );
}

export async function getNextForUser(userId: string) {
  return queryOne<{ id: string; candidate_id: string; score: number; presented_at: string | null }>(
    `select id, candidate_id, score, presented_at
       from match_candidates
      where user_id = $1 and status = 'pending'
      order by (presented_at is not null) desc, score desc
      limit 1`,
    [userId],
  );
}

export interface CandidatePreview {
  display_name: string | null;
  city: string | null;
  summary: string;
  core_values: string[];
  communication_style: string;
  relationship_goals: string;
}

/**
 * Deliberately narrow: no email, no phone, no dealbreakers (those are a
 * matching-time filter, not something to show a candidate about themselves).
 * This is the only view another user ever gets of a candidate before a
 * mutual match — matches src/providers/ai/gemini.ts's PersonalityProfile
 * shape minus the fields we don't want exposed pre-match.
 */
export async function getCandidatePreview(candidateId: string): Promise<CandidatePreview | null> {
  return queryOne<CandidatePreview>(
    `select u.display_name,
            u.city,
            pp.profile->>'summary' as summary,
            coalesce(pp.profile->'coreValues', '[]'::jsonb) as core_values,
            pp.profile->>'communicationStyle' as communication_style,
            pp.profile->>'relationshipGoals' as relationship_goals
       from users u
       join personality_profiles pp on pp.user_id = u.id
      where u.id = $1`,
    [candidateId],
  );
}

export async function markPresented(id: string): Promise<void> {
  await query(
    "update match_candidates set presented_at = now() where id = $1 and presented_at is null",
    [id],
  );
}

export interface MatchCandidate {
  id: string;
  user_id: string;
  candidate_id: string;
  status: "pending" | "interested" | "passed" | "expired";
}

export async function findPendingCandidate(
  userId: string,
  candidateId: string,
): Promise<MatchCandidate | null> {
  return queryOne<MatchCandidate>(
    `select * from match_candidates where user_id = $1 and candidate_id = $2 and status = 'pending'`,
    [userId, candidateId],
  );
}

export async function decide(
  id: string,
  status: "interested" | "passed",
): Promise<void> {
  await query(
    "update match_candidates set status = $2, decided_at = now() where id = $1",
    [id, status],
  );
}

export async function getDirectionalStatus(
  userId: string,
  candidateId: string,
): Promise<string | null> {
  const row = await queryOne<{ status: string }>(
    "select status from match_candidates where user_id = $1 and candidate_id = $2",
    [userId, candidateId],
  );
  return row?.status ?? null;
}
