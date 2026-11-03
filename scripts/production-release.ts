/** Production migration + verification, invoked explicitly or by the Production build orchestrator. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { runProductionRelease, ProductionReleaseError, type ProductionReleaseOptions } from "./production-release-core.ts";

export function readProductionReleaseArguments(args: string[]): ProductionReleaseOptions {
  const allowed = new Set(["--force", "--expected-endpoint-id", "--allow-known-0009-crlf"]), seen = new Set<string>(); let endpointId = "";
  for (let i = 0; i < args.length; i++) { const flag = args[i]; if (!allowed.has(flag) || seen.has(flag)) throw new ProductionReleaseError("explicit_force_required"); seen.add(flag); if (flag === "--expected-endpoint-id") { const next = args[++i]; if (!next || next.startsWith("--")) throw new ProductionReleaseError("approved_endpoint_required"); endpointId = next; } }
  return { force: seen.has("--force"), expectedEndpointId: endpointId, allowKnown0009Crlf: seen.has("--allow-known-0009-crlf") };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runProductionRelease(readProductionReleaseArguments(process.argv.slice(2)), process.env, async connectionString => {
      const client = new Client({ connectionString, connectionTimeoutMillis: 10000, statement_timeout: 120000 });
      try { await client.connect(); } catch (error) { await client.end().catch(() => {}); throw error; }
      return { query: async (text, params) => ({ rows: (await client.query(text, params)).rows }), end: () => client.end(), migrateAtomically: folder => migrate(drizzle({ client }), { migrationsFolder: folder }) };
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { console.error(JSON.stringify({ productionRelease: "refused", error: error instanceof ProductionReleaseError ? error.code : "release_failed", ...(error instanceof ProductionReleaseError && error.verification ? { verification: error.verification } : {}) })); process.exitCode = 1; }
}
