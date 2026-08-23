import { config, flags } from "./config.js";
import { logger } from "./lib/logger.js";
import { pool } from "./db/client.js";
import { redis } from "./lib/redis.js";
import { buildServer } from "./server.js";
import { startProfileWorker } from "./jobs/profileWorker.js";
import { startMatchWorker } from "./jobs/matchWorker.js";

async function main(): Promise<void> {
  logger.info(
    { emailEnabled: flags.emailEnabled, aiEnabled: flags.aiEnabled, paymentsEnabled: flags.paymentsEnabled },
    "starting Aymora backend",
  );

  const app = await buildServer();
  const profileWorker = startProfileWorker();
  const matchWorker = startMatchWorker();

  await app.listen({ port: config.PORT, host: "0.0.0.0" });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    await Promise.all([app.close(), profileWorker.close(), matchWorker.close()]);
    await pool.end();
    redis.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
