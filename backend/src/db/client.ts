import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  // Supabase (and most managed Postgres) requires TLS and presents a cert
  // chain Node doesn't have pinned; rejectUnauthorized:false is Supabase's
  // own documented approach for node-postgres. Local Docker Postgres has no
  // TLS listener at all, so this must stay off outside production.
  ssl: config.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
});

pool.on("error", (err) => {
  // Idle client errors (e.g. connection dropped) should not crash the process.
  console.error("Unexpected Postgres pool error", err);
});

export type QueryParams = ReadonlyArray<unknown>;

export async function query<T = Record<string, unknown>>(
  text: string,
  params: QueryParams = [],
): Promise<T[]> {
  const result = await pool.query(text, params as unknown[]);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: QueryParams = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Runs `fn` inside a transaction on a dedicated client, committing on success
 * and rolling back on any thrown error.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
