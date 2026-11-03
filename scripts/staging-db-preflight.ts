/** Explicit operator-run read-only staging database manifest check. Never applies migrations. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@neondatabase/serverless";
import { runStagingDatabasePreflight, StagingDbPreflightError, type StagingDbTarget } from "./staging-db-preflight-core.ts";

export function readStagingDbArguments(args: string[]): StagingDbTarget {
  const fields = new Map<string, string>(), allowed = new Set(["--target", "--expected-db-host", "--production-db-host"]);
  if (args.length !== 6) throw new StagingDbPreflightError("invalid_target");
  for (let i = 0; i < args.length; i += 2) { if (!allowed.has(args[i]) || fields.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new StagingDbPreflightError("invalid_target"); fields.set(args[i], args[i + 1]); }
  const target = fields.get("--target"); if (target !== "preview" && target !== "staging") throw new StagingDbPreflightError("invalid_target");
  return { target, expectedDbHost: fields.get("--expected-db-host")!, productionDbHost: fields.get("--production-db-host")! };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runStagingDatabasePreflight(readStagingDbArguments(process.argv.slice(2)), process.env, async connectionString => { const client = new Client({ connectionString, connectionTimeoutMillis: 10000, statement_timeout: 10000 }); await client.connect(); return { query: async (text, params) => ({ rows: (await client.query(text, params)).rows }), end: () => client.end() }; });
    console.log(JSON.stringify(report, null, 2)); if (!report.ok) process.exitCode = 1;
  } catch (error) { console.error(`[staging-db-preflight] refused: ${error instanceof StagingDbPreflightError ? error.code : "preflight_failed"}`); process.exitCode = 1; }
}
