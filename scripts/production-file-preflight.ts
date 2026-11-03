/** Explicit production-only provider check; emits only fixed status codes and synthetic-probe metadata. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProductionFilePreflightError, runProductionFilePreflight, type ProductionFilePreflightOptions } from "./production-file-preflight-core.ts";

export function readProductionFilePreflightArguments(args: string[]): ProductionFilePreflightOptions {
  const seen = new Set<string>(); let expectedStoreId = "";
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!["--force", "--expected-store-id"].includes(flag) || seen.has(flag)) throw new ProductionFilePreflightError("explicit_force_required");
    seen.add(flag);
    if (flag === "--expected-store-id") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new ProductionFilePreflightError("approved_store_required");
      expectedStoreId = value;
    }
  }
  return { force: seen.has("--force"), expectedStoreId };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runProductionFilePreflight(readProductionFilePreflightArguments(process.argv.slice(2)), process.env), null, 2)); }
  catch (error) { console.error(JSON.stringify({ productionFiles: "refused", error: error instanceof ProductionFilePreflightError ? error.code : "file_preflight_failed", ...(error instanceof ProductionFilePreflightError && error.operationFailure ? { operationFailure: error.operationFailure } : {}) })); process.exitCode = 1; }
}
