/**
 * The one way FortMark applies schema migrations — Preview build, operator
 * run, every environment.
 *
 * Why this exists (defect found during the 2026-09-22 Production promotion):
 * the previous runner used `drizzle-orm/neon-http/migrator`. Neon's HTTP
 * driver has no session, so that migrator sent every statement as its own
 * request and inserted the bookkeeping rows afterwards. A failure part-way
 * left some objects created, no bookkeeping row, and a database that the next
 * run would trip over (`CREATE TYPE ... already exists`). It was not atomic.
 *
 * This runner uses Neon's WebSocket driver (`@neondatabase/serverless`
 * `Client`, one Postgres session) with `drizzle-orm/neon-serverless/migrator`.
 * That migrator runs every pending migration AND its bookkeeping insert inside
 * a single `BEGIN … COMMIT`, so a batch either lands completely or not at all.
 * Postgres DDL is transactional, which is what makes that guarantee real.
 *
 * Concurrency: two Preview builds of the same branch can start together. A
 * session-level advisory lock serialises them, so the second waits, then
 * finds nothing pending. Without it the loser would fail on "already exists"
 * — harmless now that it rolls back, but noisy.
 *
 * Constraint that follows from the transaction: a migration must not contain
 * statements Postgres refuses inside a transaction block (`CREATE INDEX
 * CONCURRENTLY`, `ALTER TYPE … ADD VALUE` used in the same batch, `VACUUM`).
 * `assertTransactionSafe` refuses those up front with a clear message.
 *
 * Plain JavaScript, no type stripping: the Vercel build imports this.
 * Never logs any part of the connection string.
 */
import { readFileSync } from "node:fs";
import { Client } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

/** Arbitrary, fixed advisory-lock key for "FortMark schema migrations". */
export const MIGRATION_LOCK_KEY = 7214050913;

export const DEFAULT_MIGRATIONS_FOLDER = "./lib/db/migrations";

/** Statements Postgres will not run inside a transaction block. */
const NON_TRANSACTIONAL = [
  /\bCREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i,
  /\bDROP\s+INDEX\s+CONCURRENTLY\b/i,
  /\bREINDEX\b[^;]*\bCONCURRENTLY\b/i,
  /\bALTER\s+TYPE\b[^;]*\bADD\s+VALUE\b/i,
  /\bVACUUM\b/i,
  /\bCREATE\s+DATABASE\b/i,
];

/**
 * Refuse, before connecting, any migration the atomic runner cannot apply.
 * `ALTER TYPE … ADD VALUE` is listed because a new enum value cannot be used
 * in the same transaction that adds it; such a change needs its own reviewed,
 * separately-run migration rather than silently weakening the guarantee.
 */
export function assertTransactionSafe(migrationsFolder = DEFAULT_MIGRATIONS_FOLDER) {
  const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, "utf8"));
  const offenders = [];
  for (const entry of journal.entries) {
    const sql = readFileSync(`${migrationsFolder}/${entry.tag}.sql`, "utf8");
    if (NON_TRANSACTIONAL.some((re) => re.test(sql))) offenders.push(entry.tag);
  }
  if (offenders.length > 0) {
    throw new Error(
      `migration(s) contain statements that cannot run inside a transaction: ${offenders.join(", ")}`
    );
  }
  return journal.entries.length;
}

/**
 * Apply every pending migration atomically. Resolves with the bookkeeping row
 * count before and after, so callers can report what happened without
 * reading any data.
 */
export async function runMigrations(
  connectionString,
  { migrationsFolder = DEFAULT_MIGRATIONS_FOLDER } = {}
) {
  assertTransactionSafe(migrationsFolder);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      const before = await appliedCount(client);
      await migrate(drizzle({ client }), { migrationsFolder });
      const after = await appliedCount(client);
      return { before, after };
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    }
  } finally {
    await client.end().catch(() => {});
  }
}

async function appliedCount(client) {
  const exists = await client.query("select to_regclass('drizzle.__drizzle_migrations') as t");
  if (!exists.rows[0]?.t) return 0;
  const r = await client.query("select count(*)::int as n from drizzle.__drizzle_migrations");
  return r.rows[0].n;
}
