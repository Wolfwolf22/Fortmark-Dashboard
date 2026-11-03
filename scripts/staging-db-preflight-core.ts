/** Read-only schema certification. This module never constructs a database connection. */
import { is } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { getTableConfig, isPgEnum, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../lib/db/schema.ts";

export type StagingDbTarget = { target: "preview" | "staging"; expectedDbHost: string; productionDbHost: string };
export type StagingDbClient = { query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; end(): Promise<unknown> };
export type StagingDbConnector = (connectionString: string) => Promise<StagingDbClient>;
export class StagingDbPreflightError extends Error {
  readonly code: "invalid_target" | "invalid_host" | "missing_database_url" | "invalid_database_url" | "production_target_refused" | "database_urls_inconsistent" | "connection_failed" | "read_only_required" | "metadata_unavailable" | "rollback_failed";
  constructor(code: StagingDbPreflightError["code"]) { super(code); this.name = "StagingDbPreflightError"; this.code = code; }
}
type Manifest = { migrations: { hash: string; timestamp: number }[]; tables: { schema: string; name: string; columns: { name: string; nullable: boolean }[] }[]; enums: { schema: string; name: string; values: string[] }[] };
export function currentDatabaseManifest(migrationsFolder = new URL("../lib/db/migrations/", import.meta.url).pathname): Manifest {
  const values: unknown[] = Object.values(schema);
  const tables = values.filter(value => is(value, PgTable)).map(table => { const config = getTableConfig(table); return { schema: config.schema ?? "public", name: config.name, columns: config.columns.map(column => ({ name: column.name, nullable: !column.notNull })).sort((a, b) => a.name.localeCompare(b.name)) }; }).sort((a, b) => a.name.localeCompare(b.name));
  const enums = values.filter(isPgEnum).map(value => ({ schema: value.schema ?? "public", name: value.enumName, values: [...value.enumValues] })).sort((a, b) => a.name.localeCompare(b.name));
  return { migrations: readMigrationFiles({ migrationsFolder }).map(migration => ({ hash: migration.hash, timestamp: migration.folderMillis })), tables, enums };
}
function normalizedHost(value: string): string {
  if (typeof value !== "string" || !value || value !== value.trim() || !/^[A-Za-z0-9.:[\]-]+$/.test(value)) throw new StagingDbPreflightError("invalid_host");
  let parsed: URL; try { parsed = new URL(`postgresql://${value}/database`); } catch { throw new StagingDbPreflightError("invalid_host"); }
  if (!parsed.hostname || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/database") throw new StagingDbPreflightError("invalid_host");
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (["localhost", "127.0.0.1", "[::1]"].includes(host)) return "loopback";
  return host.replace(/-pooler(?=\.)/, "");
}
/** Validate every target input before any connector is called. No target text is included in errors. */
export function resolveStagingDatabaseTarget(target: StagingDbTarget, env: Record<string, string | undefined>): { connectionString: string } {
  if (!target || !["preview", "staging"].includes(target.target)) throw new StagingDbPreflightError("invalid_target");
  const expected = normalizedHost(target.expectedDbHost), production = normalizedHost(target.productionDbHost);
  if (expected === production) throw new StagingDbPreflightError("production_target_refused");
  const values = [env.DATABASE_URL, env.DATABASE_URL_UNPOOLED].filter((value): value is string => value !== undefined);
  if (!values.length) throw new StagingDbPreflightError("missing_database_url");
  const parsed = values.map(value => {
    let url: URL; try { url = new URL(value); } catch { throw new StagingDbPreflightError("invalid_database_url"); }
    if (!/^postgres(?:ql)?:$/.test(url.protocol) || !url.hostname || !url.username || !url.password || !url.pathname || url.pathname === "/" || url.hash || value !== value.trim()) throw new StagingDbPreflightError("invalid_database_url");
    // Connection-string query options may override pg connection fields. Accept only
    // the two TLS choices used by Neon URLs, never host/user/database/options overrides.
    for (const [key, setting] of url.searchParams) if (url.searchParams.getAll(key).length !== 1 || (key === "sslmode" ? !["disable", "allow", "prefer", "require", "verify-ca", "verify-full"].includes(setting) : key === "channel_binding" ? !["disable", "prefer", "require"].includes(setting) : true)) throw new StagingDbPreflightError("invalid_database_url");
    const host = normalizedHost(url.hostname);
    if (host === production) throw new StagingDbPreflightError("production_target_refused");
    if (host !== expected) throw new StagingDbPreflightError("database_urls_inconsistent");
    return { host, port: url.port || "5432", database: url.pathname, user: url.username };
  });
  if (parsed.some(value => value.host !== parsed[0].host || value.port !== parsed[0].port || value.database !== parsed[0].database || value.user !== parsed[0].user)) throw new StagingDbPreflightError("database_urls_inconsistent");
  return { connectionString: env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL! };
}
export type StagingDbReport = {
  ok: boolean; target: "preview" | "staging"; readOnly: true; transactionEnded: "rolled_back"; targetGuard: "matched_explicit_staging_host_and_excluded_production_host";
  migrations: { expected: number; actual: number; exactOrderedLedger: boolean; firstMismatchPosition: number | null };
  schema: { expectedTables: number; expectedColumns: number; expectedEnums: number; missingTables: string[]; missingColumns: string[]; nullabilityMismatches: string[]; enumMismatches: string[] };
};
/** Only system catalog / Drizzle bookkeeping reads. No user-record query is performed. */
export async function inspectStagingDatabase(client: StagingDbClient, manifest: Manifest, target: StagingDbTarget["target"]): Promise<StagingDbReport> {
  let began = false, report: StagingDbReport | undefined, failure: StagingDbPreflightError | undefined;
  try {
    await client.query("BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ"); began = true;
    const mode = await client.query("SHOW transaction_read_only");
    if (mode.rows[0]?.transaction_read_only !== "on") throw new StagingDbPreflightError("read_only_required");
    const ledgerExists = await client.query("SELECT to_regclass('drizzle.__drizzle_migrations')::text AS ledger");
    const ledger = ledgerExists.rows[0]?.ledger ? (await client.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id")).rows : [];
    const tables = (await client.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows;
    const columns = (await client.query("SELECT table_schema, table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema='public'")).rows;
    const enums = (await client.query("SELECT n.nspname AS schema_name,t.typname AS enum_name,e.enumlabel AS enum_value FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace JOIN pg_catalog.pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder")).rows;
    const knownTables = new Set(tables.map(row => `${row.table_schema}.${row.table_name}`)), knownColumns = new Map(columns.map(row => [`${row.table_schema}.${row.table_name}.${row.column_name}`, row.is_nullable === "YES"])), knownEnums = new Map<string, string[]>();
    for (const row of enums) { const key = `${row.schema_name}.${row.enum_name}`, values = knownEnums.get(key) ?? []; values.push(String(row.enum_value)); knownEnums.set(key, values); }
    const missingTables: string[] = [], missingColumns: string[] = [], nullabilityMismatches: string[] = [], enumMismatches: string[] = [];
    for (const table of manifest.tables) { const key = `${table.schema}.${table.name}`; if (!knownTables.has(key)) { missingTables.push(key); continue; } for (const column of table.columns) { const name = `${key}.${column.name}`; if (!knownColumns.has(name)) missingColumns.push(name); else if (knownColumns.get(name) !== column.nullable) nullabilityMismatches.push(name); } }
    for (const value of manifest.enums) { const key = `${value.schema}.${value.name}`; if (JSON.stringify(knownEnums.get(key)) !== JSON.stringify(value.values)) enumMismatches.push(key); }
    const firstMismatch = manifest.migrations.findIndex((migration, index) => ledger[index]?.hash !== migration.hash || Number(ledger[index]?.created_at) !== migration.timestamp), exactOrderedLedger = firstMismatch === -1 && ledger.length === manifest.migrations.length;
    report = { ok: exactOrderedLedger && !missingTables.length && !missingColumns.length && !nullabilityMismatches.length && !enumMismatches.length, target, readOnly: true, transactionEnded: "rolled_back", targetGuard: "matched_explicit_staging_host_and_excluded_production_host", migrations: { expected: manifest.migrations.length, actual: ledger.length, exactOrderedLedger, firstMismatchPosition: firstMismatch >= 0 ? firstMismatch + 1 : ledger.length > manifest.migrations.length ? manifest.migrations.length + 1 : null }, schema: { expectedTables: manifest.tables.length, expectedColumns: manifest.tables.reduce((total, table) => total + table.columns.length, 0), expectedEnums: manifest.enums.length, missingTables, missingColumns, nullabilityMismatches, enumMismatches } };
  } catch (error) { failure = error instanceof StagingDbPreflightError ? error : new StagingDbPreflightError("metadata_unavailable"); }
  finally { if (began) { try { await client.query("ROLLBACK"); } catch { failure = new StagingDbPreflightError("rollback_failed"); } } }
  if (failure) throw failure;
  return report!;
}
export async function runStagingDatabasePreflight(target: StagingDbTarget, env: Record<string, string | undefined>, connector: StagingDbConnector, manifest = currentDatabaseManifest()): Promise<StagingDbReport> {
  const resolved = resolveStagingDatabaseTarget(target, env);
  let client: StagingDbClient; try { client = await connector(resolved.connectionString); } catch { throw new StagingDbPreflightError("connection_failed"); }
  try { return await inspectStagingDatabase(client, manifest, target.target); } finally { await client.end().catch(() => {}); }
}
