import { enqueueProfileGeneration } from "../../jobs/queue.js";
import { updateOnboardingStatus, findUserById } from "../auth/repository.js";
import * as repo from "./repository.js";

export class NoActiveQuestionnaireError extends Error {}
export class NotStartedError extends Error {}

export async function getQuestionnaireForUser(userId: string) {
  const version = await repo.getActiveVersion();
  if (!version) throw new NoActiveQuestionnaireError();

  const response = await repo.getResponse(userId, version.id);
  return {
    version: version.version,
    schema: version.schema,
    answers: response?.answers ?? {},
    completed: response?.completed_at !== null && response?.completed_at !== undefined,
  };
}

export async function saveAnswers(
  userId: string,
  answers: Record<string, unknown>,
): Promise<void> {
  const version = await repo.getActiveVersion();
  if (!version) throw new NoActiveQuestionnaireError();

  await repo.upsertAnswers(userId, version.id, answers);

  const user = await findUserById(userId);
  if (user?.onboarding_status === "invited") {
    await updateOnboardingStatus(userId, "questionnaire_started");
  }
}

export async function completeQuestionnaire(userId: string): Promise<void> {
  const version = await repo.getActiveVersion();
  if (!version) throw new NoActiveQuestionnaireError();

  const response = await repo.getResponse(userId, version.id);
  if (!response || Object.keys(response.answers).length === 0) {
    throw new NotStartedError();
  }

  await repo.markCompleted(userId, version.id);
  await updateOnboardingStatus(userId, "questionnaire_complete");
  await enqueueProfileGeneration(userId);
}
