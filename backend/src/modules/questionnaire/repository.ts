import { query, queryOne } from "../../db/client.js";

export interface QuestionnaireVersion {
  id: string;
  version: number;
  schema: unknown[];
  is_active: boolean;
}

export interface QuestionnaireResponse {
  id: string;
  user_id: string;
  version_id: string;
  answers: Record<string, unknown>;
  completed_at: string | null;
}

export async function getActiveVersion(): Promise<QuestionnaireVersion | null> {
  return queryOne<QuestionnaireVersion>(
    "select * from questionnaire_versions where is_active = true limit 1",
  );
}

export async function getResponse(
  userId: string,
  versionId: string,
): Promise<QuestionnaireResponse | null> {
  return queryOne<QuestionnaireResponse>(
    "select * from questionnaire_responses where user_id = $1 and version_id = $2",
    [userId, versionId],
  );
}

export async function upsertAnswers(
  userId: string,
  versionId: string,
  answers: Record<string, unknown>,
): Promise<void> {
  await query(
    `insert into questionnaire_responses (user_id, version_id, answers)
     values ($1, $2, $3)
     on conflict (user_id, version_id)
       do update set answers = questionnaire_responses.answers || excluded.answers,
                     updated_at = now()`,
    [userId, versionId, JSON.stringify(answers)],
  );
}

export async function getLatestCompletedResponse(
  userId: string,
): Promise<QuestionnaireResponse | null> {
  return queryOne<QuestionnaireResponse>(
    `select * from questionnaire_responses
      where user_id = $1 and completed_at is not null
      order by completed_at desc
      limit 1`,
    [userId],
  );
}

export async function markCompleted(userId: string, versionId: string): Promise<void> {
  await query(
    `update questionnaire_responses
        set completed_at = now(), updated_at = now()
      where user_id = $1 and version_id = $2`,
    [userId, versionId],
  );
}
