import { Pool } from "pg";
import { config } from "../config.js";
import { logger } from "../logger.js";

let pool: Pool | null = null;

export function getPool(): Pool | null {
  if (!config.dbEnabled) return null;
  if (pool) return pool;
  try {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on("error", (err: unknown) => {
      logger.error({ err: String(err) }, "pg pool error");
    });
    return pool;
  } catch (err) {
    logger.error({ err: String(err) }, "pg pool creation failed");
    pool = null;
    return null;
  }
}

export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<{ rows: T[] } | null> {
  const p = getPool();
  if (!p) return null;
  try {
    return (await p.query(text, params)) as any;
  } catch (err) {
    logger.error({ err: String(err) }, "pg query failed");
    return null;
  }
}

export async function migrate(): Promise<void> {
  if (!config.dbEnabled) {
    logger.info({}, "db disabled — skipping migrate");
    return;
  }
  try {
    await query(`CREATE TABLE IF NOT EXISTS profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE,
      name text,
      phone text,
      prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )`);

    await query(`CREATE TABLE IF NOT EXISTS visitors (
      id text PRIMARY KEY,
      profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
      user_agent text,
      meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      first_seen timestamptz NOT NULL DEFAULT now(),
      last_seen timestamptz NOT NULL DEFAULT now()
    )`);

    await query(`CREATE TABLE IF NOT EXISTS messages (
      id bigserial PRIMARY KEY,
      visitor_id text REFERENCES visitors(id) ON DELETE CASCADE,
      profile_id uuid,
      role text NOT NULL,
      content text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);

    await query(`CREATE TABLE IF NOT EXISTS product_interests (
      id bigserial PRIMARY KEY,
      visitor_id text,
      profile_id uuid,
      product_title text NOT NULL,
      product_id text,
      source text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);

    await query(
      `CREATE INDEX IF NOT EXISTS idx_messages_visitor ON messages(visitor_id, created_at)`
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_pi_visitor ON product_interests(visitor_id, created_at)`
    );

    logger.info({}, "db migrated");
  } catch (err) {
    logger.error({ err: String(err) }, "db migrate failed");
  }
}
