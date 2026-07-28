/**
 * Applies the committed Release 1 migrations.
 *
 * Why this runs during the Vercel build rather than from CI:
 *
 * The Neon integration created every database variable with Vercel's
 * `sensitive` type. Sensitive variables are write-only — `vercel env pull`
 * returns the literal placeholder `[SENSITIVE]`, never the value — so no CI
 * runner can obtain the connection string. The Vercel build is the only place
 * the real value is injected, so that is where the migration has to happen.
 *
 * Two modes:
 *
 *   (default)  Build guard. Runs ONLY when VERCEL_ENV=preview. Never fails the
 *              build — a database problem must not be able to take the
 *              dashboard down, and in Release 1 the allowlist, not the
 *              database, is the access authority.
 *   --force    Explicit run (`npm run db:migrate`). Ignores the guard and
 *              exits non-zero on failure.
 *
 * Plain JavaScript on purpose: the build must not depend on Node's type
 * stripping being available or on a particular flag spelling.
 *
 * Prefers the unpooled URL for DDL. Never prints any part of either value.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const RELEASE_1_TABLES = [
  "audit_events",
  "dashboard_users",
  "professional_profiles",
  "profile_images",
];

const force = process.argv.includes("--force");

/** Exit the way the caller expects: loud when forced, silent on a build. */
function bail(message) {
  console.log(`[migrate] ${message}`);
  process.exit(force ? 1 : 0);
}

if (!force && process.env.VERCEL_ENV !== "preview") {
  console.log(
    `[migrate] skipped — build guard allows preview only (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`
  );
  process.exit(0);
}

const unpooled = process.env.DATABASE_URL_UNPOOLED?.trim();
const pooled = process.env.DATABASE_URL?.trim();
const url = unpooled || pooled;

// A pulled-but-unreadable sensitive variable arrives as this exact literal.
// Catching it here turns a confusing driver crash into a clear message.
if (url === "[SENSITIVE]") {
  bail(
    "the connection string is Vercel's write-only placeholder — this context cannot read sensitive variables"
  );
}
if (!url) {
  bail("no database URL configured — nothing to migrate");
}

console.log(`[migrate] using ${unpooled ? "DATABASE_URL_UNPOOLED" : "DATABASE_URL"}`);

try {
  const sql = neon(url);
  await migrate(drizzle(sql), { migrationsFolder: "./lib/db/migrations" });
  console.log("[migrate] migrations applied");

  // Report the schema by name only. No row counts, no identifiers, no values.
  const rows = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name`;
  const present = rows.map((r) => r.table_name);
  console.log(`[migrate] public tables: ${present.join(", ") || "(none)"}`);

  const missing = RELEASE_1_TABLES.filter((t) => !present.includes(t));
  if (missing.length > 0) {
    bail(`MISSING Release 1 tables: ${missing.join(", ")}`);
  }
  console.log("[migrate] all four Release 1 tables present");
} catch (error) {
  // Deliberately narrow: a driver error can carry the host and user portion of
  // the connection string, so only the error's class name is ever printed.
  bail(`failed (${error?.constructor?.name ?? "Error"})`);
}
