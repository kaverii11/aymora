import { Worker } from "bullmq";
import { redis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import { updateOnboardingStatus } from "../modules/auth/repository.js";
import { getLatestCompletedResponse } from "../modules/questionnaire/repository.js";
import { upsertProfile } from "../modules/profiling/repository.js";
import { generatePersonalityProfile } from "../providers/ai/gemini.js";
import { enqueueMatchGeneration } from "./queue.js";
import type { ProfileGenerationJob } from "./queue.js";

export function startProfileWorker(): Worker<ProfileGenerationJob> {
  const worker = new Worker<ProfileGenerationJob>(
    "profile-generation",
    async (job) => {
      const { userId } = job.data;

      const response = await getLatestCompletedResponse(userId);
      if (!response) {
        logger.warn({ userId }, "profile generation job with no completed questionnaire, skipping");
        return;
      }

      const result = await generatePersonalityProfile(response.answers);
      await upsertProfile(
        userId,
        result.profile,
        result.embedding,
        result.modelVersion,
        result.source,
      );
      await updateOnboardingStatus(userId, "profile_generated");

      logger.info({ userId, source: result.source }, "personality profile generated");

      await enqueueMatchGeneration(userId);
    },
    { connection: redis, concurrency: 2 },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "profile generation job failed");
  });

  return worker;
}
