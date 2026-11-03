/** Production-only migration gate. No credentials are logged or constructed here. */
import { createHash } from "node:crypto";
import { assertTransactionSafe, MIGRATION_LOCK_KEY } from "./migrate-core.mjs";
import { currentDatabaseManifest, inspectStagingDatabase as inspectSchemaManifest, type StagingDbClient } from "./staging-db-preflight-core.ts";

export const APPROVED_PRODUCTION_ENDPOINT_ID = "ep-delicate-morning-avh7x6vk";
export const KNOWN_0009_CRLF = {
  index: 9, timestamp: 1790131131105,
  repositoryHash: "d7b6f614ef029216473207be3ee3e59a72b59451c3aedf5e528b51f62eaf4326",
  recordedHash: "f4c194194364e4b7b11a70215b7ee018b42f0bd191cff3f794983fe9b9043c77",
} as const;
export type ProductionReleaseOptions = { force: boolean; expectedEndpointId: string; allowKnown0009Crlf: boolean };
type Manifest = ReturnType<typeof currentDatabaseManifest>;
export type ProductionReleaseClient = StagingDbClient & { migrateAtomically(migrationsFolder: string): Promise<void> };
type ProductionFailure = "production_scope_required" | "explicit_force_required" | "approved_endpoint_required" | "both_database_urls_required" | "invalid_database_url" | "unapproved_endpoint" | "database_urls_inconsistent" | "manifest_invalid" | "connection_failed" | "ledger_missing" | "ledger_prefix_mismatch" | "known_0009_crlf_requires_explicit_option" | "read_only_required" | "metadata_unavailable" | "migration_failed" | "verification_failed";
export class ProductionReleaseError extends Error {
  readonly code: ProductionFailure;
  readonly verification?: ProductionReleaseReport["verification"];
  constructor(code: ProductionFailure, verification?: ProductionReleaseReport["verification"]) { super(code); this.name = "ProductionReleaseError"; this.code = code; this.verification = verification; }
}
/** Both injected URLs must independently match the fixed approved endpoint before any socket opens. */
export function resolveProductionReleaseTarget(options: ProductionReleaseOptions, env: Record<string, string | undefined>): { connectionString: string; endpointFingerprint: string } {
  if (env.VERCEL_ENV !== "production") throw new ProductionReleaseError("production_scope_required");
  if (options.force !== true) throw new ProductionReleaseError("explicit_force_required");
  if (options.expectedEndpointId !== APPROVED_PRODUCTION_ENDPOINT_ID) throw new ProductionReleaseError("approved_endpoint_required");
  if (!env.DATABASE_URL?.trim() || !env.DATABASE_URL_UNPOOLED?.trim()) throw new ProductionReleaseError("both_database_urls_required");
  const parsed = [env.DATABASE_URL, env.DATABASE_URL_UNPOOLED].map((value, index) => {
    let url: URL; try { url = new URL(value); } catch { throw new ProductionReleaseError("invalid_database_url"); }
    if (!/^postgres(?:ql)?:$/.test(url.protocol) || !url.username || !url.password || !url.hostname || !url.pathname || url.pathname === "/" || url.hash || value !== value.trim() || url.port && url.port !== "5432") throw new ProductionReleaseError("invalid_database_url");
    for (const [key, setting] of url.searchParams) if (url.searchParams.getAll(key).length !== 1 || (key === "sslmode" ? !["require", "verify-ca", "verify-full"].includes(setting) : key === "channel_binding" ? !["prefer", "require"].includes(setting) : true)) throw new ProductionReleaseError("invalid_database_url");
    // A session advisory lock must never run through transaction pooling.
    if (index === 1 && /-pooler(?=\.)/i.test(url.hostname)) throw new ProductionReleaseError("unapproved_endpoint");
    const hostname = url.hostname.toLowerCase().replace(/-pooler(?=\.)/, "");
    // Pin the resource identity independently verified in the provider console.
    // The former build fingerprint is not assumed to identify this current hostname.
    if (!/^ep-delicate-morning-avh7x6vk(?:\.c-\d+)?\.us-east-1\.aws\.neon\.tech$/.test(hostname)) throw new ProductionReleaseError("unapproved_endpoint");
    if (url.pathname !== "/neondb") throw new ProductionReleaseError("database_urls_inconsistent");
    return { hostname, database: url.pathname, user: url.username };
  });
  if (parsed[0].hostname !== parsed[1].hostname || parsed[0].database !== parsed[1].database || parsed[0].user !== parsed[1].user) throw new ProductionReleaseError("database_urls_inconsistent");
  return { connectionString: env.DATABASE_URL_UNPOOLED, endpointFingerprint: createHash("sha256").update(parsed[0].hostname).digest("hex").slice(0, 12) };
}
function assertManifest(manifest: Manifest, migrationsFolder: string) {
  try {
    if (assertTransactionSafe(migrationsFolder) !== manifest.migrations.length || manifest.migrations.length < 10 || manifest.migrations.some((row, index) => !/^[a-f0-9]{64}$/.test(row.hash) || !Number.isSafeInteger(row.timestamp) || index && row.timestamp <= manifest.migrations[index - 1].timestamp)) throw Error();
    const legacy = manifest.migrations[KNOWN_0009_CRLF.index];
    if (legacy.hash !== KNOWN_0009_CRLF.repositoryHash || legacy.timestamp !== KNOWN_0009_CRLF.timestamp) throw Error();
  } catch { throw new ProductionReleaseError("manifest_invalid"); }
}
async function appliedPrefix(client: ProductionReleaseClient, manifest: Manifest, allowLegacy: boolean): Promise<{ count: number; legacy: boolean }> {
  let began = false;
  try {
    await client.query("BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ"); began = true;
    if ((await client.query("SHOW transaction_read_only")).rows[0]?.transaction_read_only !== "on") throw new ProductionReleaseError("read_only_required");
    const exists = await client.query("SELECT to_regclass('drizzle.__drizzle_migrations')::text AS ledger");
    if (!exists.rows[0]?.ledger) throw new ProductionReleaseError("ledger_missing");
    const ledger = (await client.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id")).rows;
    // Production is historically known to contain 0000–0009. Never initialize a blank database here.
    if (ledger.length < 10 || ledger.length > manifest.migrations.length) throw new ProductionReleaseError("ledger_prefix_mismatch");
    let legacy = false;
    for (let index = 0; index < ledger.length; index++) {
      const actual = ledger[index], expected = manifest.migrations[index];
      if (Number(actual.created_at) !== expected.timestamp) throw new ProductionReleaseError("ledger_prefix_mismatch");
      if (actual.hash === expected.hash) continue;
      if (index !== KNOWN_0009_CRLF.index || expected.hash !== KNOWN_0009_CRLF.repositoryHash || actual.hash !== KNOWN_0009_CRLF.recordedHash || Number(actual.created_at) !== KNOWN_0009_CRLF.timestamp) throw new ProductionReleaseError("ledger_prefix_mismatch");
      if (!allowLegacy) throw new ProductionReleaseError("known_0009_crlf_requires_explicit_option");
      legacy = true;
    }
    return { count: ledger.length, legacy };
  } catch (error) { throw error instanceof ProductionReleaseError ? error : new ProductionReleaseError("metadata_unavailable"); }
  finally { if (began) { try { await client.query("ROLLBACK"); } catch { throw new ProductionReleaseError("metadata_unavailable"); } } }
}
export type ProductionReleaseReport = {
  ok: true; target: "production"; endpointId: typeof APPROVED_PRODUCTION_ENDPOINT_ID; endpointFingerprint: string;
  migrations: { before: number; after: number; applied: number; atomicRunner: "drizzle-single-transaction-advisory-lock"; known0009CrlfAccepted: boolean; historicalLedgerRewritten: false };
  verification: { ok: boolean; readOnly: true; transactionEnded: "rolled_back"; approvedOrderedLedger: boolean; exactRepositoryHashes: boolean; tables: number; columns: number; enums: number; missingTables: string[]; missingColumns: string[]; nullabilityMismatches: string[]; enumMismatches: string[] };
};
export async function runProductionRelease(options: ProductionReleaseOptions, env: Record<string, string | undefined>, connector: (connectionString: string) => Promise<ProductionReleaseClient>, config: { migrationsFolder?: string; manifest?: Manifest } = {}): Promise<ProductionReleaseReport> {
  const target = resolveProductionReleaseTarget(options, env), migrationsFolder = config.migrationsFolder ?? new URL("../lib/db/migrations/", import.meta.url).pathname, manifest = config.manifest ?? currentDatabaseManifest(migrationsFolder);
  assertManifest(manifest, migrationsFolder);
  let client: ProductionReleaseClient; try { client = await connector(target.connectionString); } catch { throw new ProductionReleaseError("connection_failed"); }
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]); locked = true;
    const before = await appliedPrefix(client, manifest, options.allowKnown0009Crlf);
    try { await client.migrateAtomically(migrationsFolder); } catch { throw new ProductionReleaseError("migration_failed"); }
    // Reuse the strict read-only schema engine. Its staging display label is discarded;
    // production target authorization was checked above, before this connection opened.
    const approvedManifest = before.legacy ? { ...manifest, migrations: manifest.migrations.map((row, index) => index === KNOWN_0009_CRLF.index ? { ...row, hash: KNOWN_0009_CRLF.recordedHash } : row) } : manifest;
    let inspected: Awaited<ReturnType<typeof inspectSchemaManifest>>;
    try { inspected = await inspectSchemaManifest(client, approvedManifest, "staging"); } catch { throw new ProductionReleaseError("metadata_unavailable"); }
    const verification: ProductionReleaseReport["verification"] = { ok: inspected.ok, readOnly: true, transactionEnded: "rolled_back", approvedOrderedLedger: inspected.migrations.exactOrderedLedger, exactRepositoryHashes: !before.legacy && inspected.migrations.exactOrderedLedger, tables: inspected.schema.expectedTables, columns: inspected.schema.expectedColumns, enums: inspected.schema.expectedEnums, missingTables: inspected.schema.missingTables, missingColumns: inspected.schema.missingColumns, nullabilityMismatches: inspected.schema.nullabilityMismatches, enumMismatches: inspected.schema.enumMismatches };
    if (!verification.ok) throw new ProductionReleaseError("verification_failed", verification);
    return { ok: true, target: "production", endpointId: APPROVED_PRODUCTION_ENDPOINT_ID, endpointFingerprint: target.endpointFingerprint, migrations: { before: before.count, after: inspected.migrations.actual, applied: inspected.migrations.actual - before.count, atomicRunner: "drizzle-single-transaction-advisory-lock", known0009CrlfAccepted: before.legacy, historicalLedgerRewritten: false }, verification };
  } catch (error) { throw error instanceof ProductionReleaseError ? error : new ProductionReleaseError("metadata_unavailable"); }
  finally { if (locked) await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {}); await client.end().catch(() => {}); }
}
