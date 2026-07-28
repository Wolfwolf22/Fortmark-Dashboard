import "server-only";

/**
 * Server-only Neon connection.
 *
 * Two rules shape this module:
 *
 * 1. A missing or broken database must never remove access the user already
 *    has. In Release 1 the allowlist is still the access authority, so every
 *    caller here treats "no database" as "no profile data", not "no entry".
 *    `getDb()` therefore returns null rather than throwing.
 *
 * 2. Nothing here logs a connection string or any part of one.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.ts";

export type Db = ReturnType<typeof create>;

function create(url: string) {
  // neon-http is the right driver for Vercel's serverless runtime: each query
  // is a stateless fetch, so there is no pool to exhaust across invocations.
  return drizzle(neon(url), { schema });
}

/** Cached across invocations within a warm lambda. */
let cached: Db | null = null;
let cachedFor: string | null = null;

function connectionString(): string | undefined {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : undefined;
}

/** True when a connection string is configured. Reveals nothing about it. */
export function isDatabaseConfigured(): boolean {
  return connectionString() !== undefined;
}

/**
 * The database handle, or null when unconfigured.
 *
 * Callers must handle null. Returning null (instead of throwing) is what keeps
 * a database outage from cascading into an access failure while
 * `DATABASE_ACCESS_CONTROL_ENABLED` is false.
 */
export function getDb(): Db | null {
  const url = connectionString();
  if (!url) return null;
  if (cached && cachedFor === url) return cached;
  cached = create(url);
  cachedFor = url;
  return cached;
}

/** Coarse, content-free health result. Safe to log and to surface to an admin. */
export type DbHealth =
  | { ok: true; latencyMs: number }
  | { ok: false; reason: "not_configured" | "unreachable" };

export async function checkDatabase(): Promise<DbHealth> {
  const db = getDb();
  if (!db) return { ok: false, reason: "not_configured" };
  const started = Date.now();
  try {
    // Cheapest possible round trip; asserts credentials and reachability.
    await db.execute("select 1");
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    // Deliberately swallow the driver error — it can contain the host and
    // sometimes the user portion of the connection string.
    return { ok: false, reason: "unreachable" };
  }
}

export { schema };
