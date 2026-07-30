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

/**
 * Release 1.1 presence columns on professional_profiles.
 *
 * Checked explicitly because verifying tables alone is not enough: Drizzle
 * generates SELECTs naming every column in the schema, so a migration that
 * created the tables but not these columns produces a runtime
 * "column does not exist" on the first profile read — which the service
 * swallows, making the whole feature silently degrade rather than fail loudly.
 */
const RELEASE_1_1_PROFILE_COLUMNS = [
  "professional_title",
  "location_display",
  "linkedin_url",
  "instagram_url",
  "facebook_url",
  "personal_website_url",
  "professional_website_url",
  "whatsapp_phone_e164",
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
    return createHash("sha256").update(hostname).digest("hex").slice(0, 12);
  } catch {
    return "unparseable";
  }
}

/**
 * Fingerprint of the underlying Neon BRANCH rather than the raw hostname.
 *
 * Neon exposes two hostnames per branch — the direct endpoint and a pooled one
 * that adds a `-pooler` suffix. Comparing raw hostnames therefore reports the
 * pooled and unpooled URLs of the SAME branch as different, which is a false
 * alarm. Stripping the suffix makes the comparison mean what it should:
 * "are these the same branch?"
 */
function branchFingerprint(connectionString) {
  try {
    const { hostname } = new URL(connectionString);
    const normalised = hostname.replace(/-pooler(?=\.)/, "");
    return createHash("sha256").update(normalised).digest("hex").slice(0, 12);
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

// Both variables are reported by PRESENCE and FINGERPRINT, never by value.
//
// This matters because the build and the runtime read different variables:
// migrations prefer DATABASE_URL_UNPOOLED (DDL wants a direct connection),
// while lib/db/client.ts connects over DATABASE_URL. Two failure modes hide in
// that gap, and neither is visible from a table check:
//
//   - DATABASE_URL absent for this scope  -> getDb() returns null at runtime,
//     so every profile read silently degrades even though migrations succeeded.
//   - the two fingerprints DIFFER         -> the runtime is talking to a
//     different Neon branch than the one just migrated, which would break
//     Preview/Production isolation.
{
  const usable = (v) => v && v !== "[SENSITIVE]";
  const fpPooled = usable(pooled) ? hostFingerprint(pooled) : null;
  const fpUnpooled = usable(unpooled) ? hostFingerprint(unpooled) : null;
  // Branch-level fingerprints ignore Neon's `-pooler` hostname suffix, so this
  // comparison answers "same branch?" rather than "same hostname?".
  const brPooled = usable(pooled) ? branchFingerprint(pooled) : null;
  const brUnpooled = usable(unpooled) ? branchFingerprint(unpooled) : null;

  console.log(
    `[migrate] DATABASE_URL present=${Boolean(pooled)} host=${fpPooled ?? "n/a"} branch=${brPooled ?? "n/a"}`
  );
  console.log(
    `[migrate] DATABASE_URL_UNPOOLED present=${Boolean(unpooled)} host=${fpUnpooled ?? "n/a"} branch=${brUnpooled ?? "n/a"}`
  );
  if (!pooled) {
    console.log(
      "[migrate] NOTE: DATABASE_URL absent — the runtime falls back to DATABASE_URL_UNPOOLED"
    );
  } else if (brPooled && brUnpooled && brPooled !== brUnpooled) {
    console.log(
      "[migrate] WARNING: pooled and unpooled resolve to DIFFERENT Neon branches — the runtime would read a branch this build did not migrate"
    );
  } else if (brPooled && brUnpooled) {
    console.log("[migrate] pooled and unpooled agree on the same Neon branch");
  }
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

  // Column-level verification. Names only — never a value.
  const colRows = await sql`
    select column_name, is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'professional_profiles'
    order by column_name`;
  const cols = new Map(colRows.map((r) => [r.column_name, r.is_nullable]));
  const missingCols = RELEASE_1_1_PROFILE_COLUMNS.filter((c) => !cols.has(c));
  if (missingCols.length > 0) {
    bail(`MISSING Release 1.1 columns: ${missingCols.join(", ")}`);
  }
  const notNullable = RELEASE_1_1_PROFILE_COLUMNS.filter((c) => cols.get(c) !== "YES");
  if (notNullable.length > 0) {
    bail(`Release 1.1 columns must stay nullable: ${notNullable.join(", ")}`);
  }
  console.log(
    `[migrate] all ${RELEASE_1_1_PROFILE_COLUMNS.length} Release 1.1 presence columns present and nullable`
  );
  console.log(`[migrate] professional_profiles column count: ${cols.size}`);
} catch (error) {
  // Deliberately narrow: a driver error can carry the host and user portion of
  // the connection string, so only the error's class name is ever printed.
  bail(`failed (${error?.constructor?.name ?? "Error"})`);
}
