import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db/client.js";
import { logger } from "../lib/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations");

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    create table if not exists _migrations (
      id         serial primary key,
      filename   text not null unique,
      applied_at timestamptz not null default now()
    );
  `);
}

async function main(): Promise<void> {
  await ensureMigrationsTable();

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const { rows: applied } = await pool.query<{ filename: string }>(
    "select filename from _migrations",
  );
  const appliedSet = new Set(applied.map((r) => r.filename));

  for (const file of files) {
    if (appliedSet.has(file)) {
      logger.info({ file }, "migration already applied, skipping");
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("insert into _migrations (filename) values ($1)", [file]);
      await client.query("COMMIT");
      logger.info({ file }, "migration applied");
    } catch (err) {
      await client.query("ROLLBACK");
      logger.error({ file, err }, "migration failed");
      throw err;
    } finally {
      client.release();
    }
  }

  logger.info("all migrations up to date");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
