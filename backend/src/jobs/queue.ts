import { Queue } from "bullmq";
import { redis } from "../lib/redis.js";

export interface ProfileGenerationJob {
  userId: string;
}

export interface MatchGenerationJob {
  userId: string;
}

export const profileGenerationQueue = new Queue<ProfileGenerationJob>("profile-generation", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export const matchGenerationQueue = new Queue<MatchGenerationJob>("match-generation", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export async function enqueueProfileGeneration(userId: string): Promise<void> {
  await profileGenerationQueue.add("generate", { userId });
}

export async function enqueueMatchGeneration(userId: string): Promise<void> {
  await matchGenerationQueue.add("generate", { userId });
}
