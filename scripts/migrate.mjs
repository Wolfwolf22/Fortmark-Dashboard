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
import { createHash } from "node:crypto";
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

/**
 * A stable, non-reversible fingerprint of the database HOST — never the
 * credentials, never the connection string.
 *
 * This exists to make database isolation provable rather than assumed. Neon
 * encodes the compute endpoint id in the hostname, so a child branch and the
 * main branch fingerprint differently. Comparing the value printed by a Preview
 * build against the one printed by a Production build answers "are these the
 * same database?" objectively, without anyone handling a secret.
 *
 * Only the host is hashed, the digest is truncated, and the input is a
 * hostname rather than a credential — so the output cannot be reversed into
 * anything that grants access.
 */
function hostFingerprint(connectionString) {
  try {
    const { hostname } = new URL(connectionString);
    const digest = createHash("sha256").update(hostname).digest("hex").slice(0, 12);
    return digest;
  } catch {
    return "unparseable";
  }
}

/** Exit the way the caller expects: loud when forced, silent on a build. */
function bail(message) {
  console.log(`[migrate] ${message}`);
  process.exit(force ? 1 : 0);
}

const unpooled = process.env.DATABASE_URL_UNPOOLED?.trim();
const pooled = process.env.DATABASE_URL?.trim();
const url = unpooled || pooled;

// Reported on EVERY build, before the preview guard, so a Production build
// prints which database it is attached to without running a single statement
// of DDL. Isolation is a claim about two environments, so it cannot be proven
// from the Preview side alone — this is the other half of the comparison.
if (url && url !== "[SENSITIVE]") {
  console.log(
    `[migrate] database host fingerprint: ${hostFingerprint(url)} (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`
  );
}

// Migrations themselves remain preview-only. Reporting is safe everywhere;
// schema changes are not.
if (!force && process.env.VERCEL_ENV !== "preview") {
  console.log(
    `[migrate] migrations skipped — build guard allows preview only (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`
  );
  process.exit(0);
}

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
