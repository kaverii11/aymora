import { Worker } from "bullmq";
import { redis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import { generateAndPersistCandidates } from "../modules/matching/service.js";
import type { MatchGenerationJob } from "./queue.js";

export function startMatchWorker(): Worker<MatchGenerationJob> {
  const worker = new Worker<MatchGenerationJob>(
    "match-generation",
    async (job) => {
      await generateAndPersistCandidates(job.data.userId);
    },
    { connection: redis, concurrency: 2 },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "match generation job failed");
  });

  return worker;
}
