import { query, queryOne } from "../../db/client.js";
import { toPgVector } from "../../lib/pgvector.js";
import type { PersonalityProfile } from "../../providers/ai/gemini.js";

export interface PersonalityProfileRow {
  user_id: string;
  profile: PersonalityProfile;
  /** Raw pgvector text representation, e.g. "[0.1,0.2,...]" — see lib/pgvector.ts. */
  embedding: string;
  model_version: string;
  source: "gemini" | "stub";
  generated_at: string;
}

export async function upsertProfile(
  userId: string,
  profile: PersonalityProfile,
  embedding: number[],
  modelVersion: string,
  source: "gemini" | "stub",
): Promise<void> {
  await query(
    `insert into personality_profiles (user_id, profile, embedding, model_version, source, generated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (user_id)
       do update set profile = excluded.profile,
                     embedding = excluded.embedding,
                     model_version = excluded.model_version,
                     source = excluded.source,
                     generated_at = now()`,
    [userId, JSON.stringify(profile), toPgVector(embedding), modelVersion, source],
  );
}

export async function getProfile(userId: string): Promise<PersonalityProfileRow | null> {
  return queryOne<PersonalityProfileRow>(
    "select * from personality_profiles where user_id = $1",
    [userId],
  );
}

export async function hasProfile(userId: string): Promise<boolean> {
  const row = await queryOne("select 1 from personality_profiles where user_id = $1", [userId]);
  return row !== null;
}
