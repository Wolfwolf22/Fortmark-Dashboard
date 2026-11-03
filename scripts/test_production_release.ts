/** Production orchestration tested only with actual isolated PostgreSQL + injected Drizzle migrator. */
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { currentDatabaseManifest } from "./staging-db-preflight-core.ts";
import { runProductionRelease, resolveProductionReleaseTarget, ProductionReleaseError, APPROVED_PRODUCTION_ENDPOINT_ID, KNOWN_0009_CRLF, type ProductionReleaseClient, type ProductionReleaseOptions } from "./production-release-core.ts";
import { readProductionReleaseArguments } from "./production-release.ts";

let passed = 0;
function check(name: string, value: unknown): asserts value { assert.ok(value, name); passed++; }
const folder = new URL("../lib/db/migrations/", import.meta.url).pathname, manifest = currentDatabaseManifest(folder), options: ProductionReleaseOptions = { force: true, expectedEndpointId: APPROVED_PRODUCTION_ENDPOINT_ID, allowKnown0009Crlf: false };
// Nonsecret host fixture is the explicitly approved production endpoint; the connector below is always injected.
const host = "ep-delicate-morning-avh7x6vk.us-east-1.aws.neon.tech", env = { VERCEL_ENV: "production", DATABASE_URL: `postgresql://test:synthetic-private-password@${host.replace(/(?=\.)/, "-pooler")}/neondb?sslmode=require`, DATABASE_URL_UNPOOLED: `postgresql://test:synthetic-private-password@${host}/neondb?sslmode=require` };
const source0009 = readFileSync(join(folder, "0009_steep_warstar.sql"), "utf8");
check("historicalexceptionisexactpublishedLFandCRLFbytesonly", createHash("sha256").update(source0009).digest("hex") === KNOWN_0009_CRLF.repositoryHash && createHash("sha256").update(source0009.replace(/\r?\n/g, "\r\n")).digest("hex") === KNOWN_0009_CRLF.recordedHash && manifest.migrations[9].timestamp === KNOWN_0009_CRLF.timestamp);
check("CLIrequiresoperatorforceandfixedendpointidentity", JSON.stringify(readProductionReleaseArguments(["--force", "--expected-endpoint-id", APPROVED_PRODUCTION_ENDPOINT_ID])) === JSON.stringify(options));
for (const args of [["--force", "--force"], ["--unknown"], ["--expected-endpoint-id"], ["--expected-endpoint-id", "--force"]]) { assert.throws(() => readProductionReleaseArguments(args), ProductionReleaseError); check("duplicateunknownorincompleteCLIrefused", true); }
let opens = 0;
const noConnect = async () => { opens++; throw Error("Must never open connector"); };
const unsafe: { env?: Record<string, string | undefined>; options?: Partial<ProductionReleaseOptions> }[] = [
  { env: { ...env, VERCEL_ENV: "preview" } }, { env: { ...env, VERCEL_ENV: undefined } }, { options: { force: false } }, { options: { expectedEndpointId: "unknown" } },
  { env: { ...env, DATABASE_URL: undefined } }, { env: { ...env, DATABASE_URL_UNPOOLED: undefined } }, { env: { ...env, DATABASE_URL: "[SENSITIVE]" } }, { env: { ...env, DATABASE_URL_UNPOOLED: "[SENSITIVE]" } },
  { env: { ...env, DATABASE_URL: "postgresql://test:secret@ep-unapproved.us-east-1.aws.neon.tech/neondb" } }, { env: { ...env, DATABASE_URL_UNPOOLED: "postgresql://test:secret@ep-unapproved.us-east-1.aws.neon.tech/neondb" } },
  { env: { ...env, DATABASE_URL_UNPOOLED: env.DATABASE_URL } },
  { env: { ...env, DATABASE_URL_UNPOOLED: env.DATABASE_URL.replace("-pooler", "-POOLER") } },
  { env: { ...env, DATABASE_URL: env.DATABASE_URL.replace("us-east-1", "us-east-2") } },
  { env: { ...env, DATABASE_URL_UNPOOLED: env.DATABASE_URL_UNPOOLED.replace(".neon.tech", ".neon.tech.attacker.invalid") } },
  { env: { ...env, DATABASE_URL: env.DATABASE_URL.replace("/neondb", "/otherdb") } },
  { env: { ...env, DATABASE_URL_UNPOOLED: env.DATABASE_URL_UNPOOLED.replace("//test:", "//other:") } },
  { env: { ...env, DATABASE_URL: `${env.DATABASE_URL}&host=unapproved.example` } }, { env: { ...env, DATABASE_URL_UNPOOLED: `${env.DATABASE_URL_UNPOOLED}&options=-csearch_path=private` } },
  { env: { ...env, DATABASE_URL: `${env.DATABASE_URL}&sslmode=disable` } }, { env: { ...env, DATABASE_URL_UNPOOLED: `${env.DATABASE_URL_UNPOOLED}#fragment` } },
];
for (const value of unsafe) { let refused = false; try { await runProductionRelease({ ...options, ...value.options }, value.env ?? env, noConnect); } catch (error) { refused = error instanceof ProductionReleaseError; check("refusalneverincludessecretURLorrawdriverdetails", !/synthetic-private-password|postgresql:|unapproved\.example/.test(String(error))); } check("unsafeconfigurationopensZEROconnections", refused && opens === 0); }

async function baseline(legacy = false) {
  const pg = new PGlite();
  for (const migration of readMigrationFiles({ migrationsFolder: folder }).slice(0, 14)) for (const sql of migration.sql) await pg.exec(sql);
  await pg.exec("CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations(id serial PRIMARY KEY,hash text NOT NULL,created_at bigint NOT NULL)");
  for (let index = 0; index < 14; index++) await pg.query("insert into drizzle.__drizzle_migrations(hash,created_at)values($1,$2)", [legacy && index === 9 ? KNOWN_0009_CRLF.recordedHash : manifest.migrations[index].hash, manifest.migrations[index].timestamp]);
  const owner = randomUUID(), contact = randomUUID();
  await pg.query("insert into dashboard_users(id,clerk_user_id,primary_email,role,status)values($1,$2,'release@example.test','agent','active')", [owner, `release-${owner}`]);
  await pg.query("insert into contacts(id,assigned_agent_user_id,first_name,notes)values($1,$2,'Existing private client','Existing private notes')", [contact, owner]);
  return { pg, contact };
}
/** Same installed PgDialect migration engine used by neon-serverless/migrator.
 * PGlite's normal adapter always prepares SQL and rejects multi-command DDL;
 * this driver shim uses actual PostgreSQL simple execution when no params exist,
 * matching the Neon WebSocket driver's behavior. Transaction boundaries stay real.
 */
async function migrateAtomically(pg: PGlite, migrationsFolder: string) {
  const dialect = new PgDialect();
  type Session = { execute(statement: SQL): Promise<unknown>; all(statement: SQL): Promise<unknown[]>; transaction(callback: (tx: Session) => Promise<void>): Promise<void> };
  function session(executor: Pick<PGlite, "exec" | "query">): Session {
    return {
      execute: async (statement: SQL) => { const query = dialect.sqlToQuery(statement); return query.params.length ? executor.query(query.sql, query.params) : executor.exec(query.sql); },
      all: async (statement: SQL) => { const query = dialect.sqlToQuery(statement); return (await executor.query(query.sql, query.params)).rows; },
      transaction: async callback => pg.transaction(tx => callback(session(tx))),
    };
  }
  await dialect.migrate(readMigrationFiles({ migrationsFolder }), session(pg) as unknown as Parameters<PgDialect["migrate"]>[1], { migrationsFolder });
}
function harness(pg: PGlite, run: (migrationsFolder: string) => Promise<void> = migrationsFolder => migrateAtomically(pg, migrationsFolder)) {
  const queries: string[] = []; let migrations = 0, ended = 0;
  const client: ProductionReleaseClient = { query: async (text, params) => { queries.push(text); return { rows: (await pg.query<Record<string, unknown>>(text, params)).rows }; }, migrateAtomically: async path => { migrations++; await run(path); }, end: async () => { ended++; } };
  return { connector: async () => { opens++; return client; }, state: () => ({ queries, migrations, ended }) };
}
async function refuses(operation: () => Promise<unknown>, code: ProductionReleaseError["code"]) { try { await operation(); assert.fail(`Expected ${code}`); } catch (error) { check("controlledreleasefailure", error instanceof ProductionReleaseError && error.code === code); return error as ProductionReleaseError; } }

// Only injected clients are used; accepted host shape is not a claim of live DNS/config verification.
check("bothapprovedURLsresolvewithoutprintingorreturningmetadata", resolveProductionReleaseTarget(options, env).connectionString === env.DATABASE_URL_UNPOOLED);
const routedEnv = { ...env, DATABASE_URL: env.DATABASE_URL.replace(".us-east-1", ".c-2.us-east-1"), DATABASE_URL_UNPOOLED: env.DATABASE_URL_UNPOOLED.replace(".us-east-1", ".c-2.us-east-1") }; check("officialregionalroutinghostacceptedonlyforfixedendpoint", /^[a-f0-9]{12}$/.test(resolveProductionReleaseTarget(options, routedEnv).endpointFingerprint));
const normal = await baseline();
try {
  const before = (await normal.pg.query<Record<string, unknown>>("select * from contacts where id=$1", [normal.contact])).rows, h = harness(normal.pg), released = await runProductionRelease(options, env, h.connector);
  check("actualDrizzleatomicallyupgrades14to31andstrictlyverifies", released.ok && released.migrations.before === 14 && released.migrations.after === 31 && released.migrations.applied === 17 && released.verification.ok && released.verification.exactRepositoryHashes);
  check("sameadvisorylockspanprefixmigrationandpostverification", h.state().queries[0].startsWith("SELECT pg_advisory_lock") && h.state().queries.at(-1)?.startsWith("SELECT pg_advisory_unlock") && h.state().queries.filter(q => q === "ROLLBACK").length === 2 && h.state().ended === 1);
  const after = (await normal.pg.query<Record<string, unknown>>("select * from contacts where id=$1", [normal.contact])).rows;
  check("existingprivateclientfieldsunchanged", JSON.stringify(after.map(row => Object.fromEntries(Object.keys(before[0]).map(key => [key, row[key]])))) === JSON.stringify(before));
  check("safeoutputhasnoURLscredentialsuserrecordsorledgerhashes", !/synthetic-private-password|postgresql:|Existing private/.test(JSON.stringify(released)) && !manifest.migrations.some(migration => JSON.stringify(released).includes(migration.hash)));
  const retry = await runProductionRelease(options, env, h.connector); check("exactreleaseagainisnooppreserving31ledgerrows", retry.migrations.before === 31 && retry.migrations.after === 31 && retry.migrations.applied === 0);
  await normal.pg.query("update drizzle.__drizzle_migrations set hash=repeat('0',64)where id=9"); const beforeMigrate = h.state().migrations; await refuses(() => runProductionRelease({ ...options, allowKnown0009Crlf: true }, env, h.connector), "ledger_prefix_mismatch"); check("knownexceptiondoesnotpermitANYotherhistoricalhash", h.state().migrations === beforeMigrate);
  await normal.pg.exec("DROP TABLE drizzle.__drizzle_migrations"); await refuses(() => runProductionRelease(options, env, h.connector), "ledger_missing"); check("missingproductionledgerneverinitializesfreshdata", h.state().migrations === beforeMigrate);
} finally { await normal.pg.close(); }
const legacy = await baseline(true);
try {
  const h = harness(legacy.pg); await refuses(() => runProductionRelease(options, env, h.connector), "known_0009_crlf_requires_explicit_option"); check("knownexceptionneversilentlyaccepted", h.state().migrations === 0);
  const accepted = await runProductionRelease({ ...options, allowKnown0009Crlf: true }, env, h.connector); check("explicitexactCRLFexceptionpermitsatomicupgradebutreportshashdifference", accepted.migrations.known0009CrlfAccepted && accepted.verification.approvedOrderedLedger && !accepted.verification.exactRepositoryHashes && !accepted.migrations.historicalLedgerRewritten);
  check("historicledgerrowremainsbyteforbyteunchanged", (await legacy.pg.query<{ hash: string }>("select hash from drizzle.__drizzle_migrations where id=10")).rows[0].hash === KNOWN_0009_CRLF.recordedHash);
  await legacy.pg.query("update drizzle.__drizzle_migrations set created_at=created_at+1 where id=10"); await refuses(() => runProductionRelease({ ...options, allowKnown0009Crlf: true }, env, h.connector), "ledger_prefix_mismatch");
} finally { await legacy.pg.close(); }
const failure = await baseline(), temporary = mkdtempSync(join(tmpdir(), "fortmark-release-migrations-"));
try {
  cpSync(folder, temporary, { recursive: true }); const journalPath = join(temporary, "meta/_journal.json"), journal = JSON.parse(readFileSync(journalPath, "utf8")); journal.entries.push({ idx: 31, version: "7", when: journal.entries.at(-1).when + 1000, tag: "0031_synthetic_release_failure", breakpoints: true }); writeFileSync(journalPath, JSON.stringify(journal)); writeFileSync(join(temporary, "0031_synthetic_release_failure.sql"), "CREATE TABLE release_atomic_probe(id integer);\n--> statement-breakpoint\nSELECT 1/0;");
  const h = harness(failure.pg); await refuses(() => runProductionRelease(options, env, h.connector, { migrationsFolder: temporary }), "migration_failed");
  check("lastmigrationfailureleaves14ledgerrowsandNOnewobjects", (await failure.pg.query<{ n: number }>("select count(*)::int n from drizzle.__drizzle_migrations")).rows[0].n === 14 && (await failure.pg.query<{ t: string | null }>("select to_regclass('public.calendar_labels')::text t")).rows[0].t === null && (await failure.pg.query<{ t: string | null }>("select to_regclass('public.release_atomic_probe')::text t")).rows[0].t === null);
  check("failedreleasestillunlocksendconnection", h.state().queries.at(-1)?.startsWith("SELECT pg_advisory_unlock") && h.state().ended === 1);
} finally { await failure.pg.close(); rmSync(temporary, { recursive: true, force: true }); }
const uncertain = await baseline();
try {
  const lost = harness(uncertain.pg, async migrationsFolder => { await migrateAtomically(uncertain.pg, migrationsFolder); throw Error("Synthetic response lost after committed migration"); }); await refuses(() => runProductionRelease(options, env, lost.connector), "migration_failed");
  const replay = await runProductionRelease(options, env, harness(uncertain.pg).connector); check("committedbutunknownoutcomesrecoverasverifiednoop", replay.migrations.before === 31 && replay.migrations.applied === 0 && replay.verification.ok);
  await uncertain.pg.exec("ALTER TABLE contacts DROP COLUMN about"); const refused = await refuses(() => runProductionRelease(options, env, harness(uncertain.pg).connector), "verification_failed"); check("ledgeralonecannotcertifymissingruntimecolumn", refused.verification?.missingColumns.includes("public.contacts.about") && refused.verification.ok === false);
} finally { await uncertain.pg.close(); }
console.log(`${passed}/${passed} production release checks passed (isolated PostgreSQL + actual Drizzle atomic migrations; no live access)`);
