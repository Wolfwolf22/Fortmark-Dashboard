/** One synthetic private-file round trip. No database rows, client paths or notifications are used. */
import { createHash, randomUUID } from "node:crypto";
import { createTransactionFileStorage, type TransactionFileStorage } from "../lib/transactions/transaction-file-storage.ts";

export const APPROVED_PRODUCTION_FILE_STORE_ID = "store_NSTN5f48IHugiItT";
export type ProductionFilePreflightOptions = { force: boolean; expectedStoreId: string };
type Environment = Record<string, string | undefined>;
type Failure = "production_scope_required" | "explicit_force_required" | "approved_store_required" | "file_uploads_required" | "dedicated_token_required" | "dedicated_token_invalid" | "credential_store_mismatch" | "store_identity_mismatch" | "invalid_probe_identity" | "storage_unavailable" | "upload_failed" | "read_failed" | "read_size_mismatch" | "read_checksum_mismatch" | "cleanup_failed";
export class ProductionFilePreflightError extends Error {
  readonly code: Failure;
  readonly operationFailure?: Failure;
  constructor(code: Failure, operationFailure?: Failure) { super(code); this.name = "ProductionFilePreflightError"; this.code = code; this.operationFailure = operationFailure; }
}

/** A complete 1×1 transparent RGBA PNG, including valid chunk CRCs and compressed pixel bytes. */
export function productionFileProbeBytes(): Uint8Array {
  return new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64"));
}
export function assertProductionFileTarget(options: ProductionFilePreflightOptions, env: Environment): void {
  if (env.VERCEL_ENV !== "production") throw new ProductionFilePreflightError("production_scope_required");
  if (options.force !== true) throw new ProductionFilePreflightError("explicit_force_required");
  if (options.expectedStoreId !== APPROVED_PRODUCTION_FILE_STORE_ID) throw new ProductionFilePreflightError("approved_store_required");
  if (env.TRANSACTION_FILES_ENABLED !== "1") throw new ProductionFilePreflightError("file_uploads_required");
  if (!env.TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN?.trim()) throw new ProductionFilePreflightError("dedicated_token_required");
  if (env.TRANSACTION_FILES_BLOB_STORE_ID !== APPROVED_PRODUCTION_FILE_STORE_ID) throw new ProductionFilePreflightError("store_identity_mismatch");
  const token = env.TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN.trim(), parts = token.split("_");
  // @vercel/blob 2.6.1 resolveBlobAuth uses explicit options.token first and
  // parseStoreIdFromReadWriteToken returns its fourth underscore-delimited field.
  // Keep the credential in memory; compare only its case-preserved nonsecret store identity.
  if (!token.startsWith("vercel_blob_rw_") || !parts[3] || !parts.slice(4).join("_") || /[\s\u0000-\u001f\u007f]/.test(token)) throw new ProductionFilePreflightError("dedicated_token_invalid");
  if (parts[3] !== APPROVED_PRODUCTION_FILE_STORE_ID.slice("store_".length)) throw new ProductionFilePreflightError("credential_store_mismatch");
}
async function verifyProbe(storage: TransactionFileStorage, pathname: string, expected: Uint8Array): Promise<string> {
  let result: Awaited<ReturnType<TransactionFileStorage["get"]>>;
  try { result = await storage.get(pathname); } catch { throw new ProductionFilePreflightError("read_failed"); }
  if (!result.ok) throw new ProductionFilePreflightError("read_failed");
  if (result.sizeBytes !== expected.byteLength) { await result.stream.cancel().catch(() => {}); throw new ProductionFilePreflightError("read_size_mismatch"); }
  const reader = result.stream.getReader(), hash = createHash("sha256");
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > expected.byteLength) { await reader.cancel().catch(() => {}); throw new ProductionFilePreflightError("read_size_mismatch"); }
      hash.update(part.value);
    }
  } catch (error) { throw error instanceof ProductionFilePreflightError ? error : new ProductionFilePreflightError("read_failed"); }
  finally { reader.releaseLock(); }
  if (size !== expected.byteLength) throw new ProductionFilePreflightError("read_size_mismatch");
  const digest = hash.digest("hex");
  if (digest !== createHash("sha256").update(expected).digest("hex")) throw new ProductionFilePreflightError("read_checksum_mismatch");
  return digest;
}
export type ProductionFilePreflightReport = {
  ok: true; target: "production"; storeId: typeof APPROVED_PRODUCTION_FILE_STORE_ID;
  probe: { contentType: "image/png"; bytes: number; sha256: string; exactReadVerified: true; removed: true };
  clientRecordsTouched: false;
};
/** Storage and UUID generation are injectable; all release configuration is validated before either is used. */
export async function runProductionFilePreflight(options: ProductionFilePreflightOptions, env: Environment, dependencies: {
  storageFactory?: (env: Environment) => TransactionFileStorage; randomUuid?: () => string;
} = {}): Promise<ProductionFilePreflightReport> {
  assertProductionFileTarget(options, env);
  let ids: string[];
  try { const uuid = dependencies.randomUuid ?? randomUUID; ids = [uuid(), uuid()]; }
  catch { throw new ProductionFilePreflightError("invalid_probe_identity"); }
  // These freshly generated identities are never supplied by a caller or read from a client record.
  if (ids[0] === ids[1] || ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))) throw new ProductionFilePreflightError("invalid_probe_identity");
  const pathname = `transaction-files/${ids[0]}/${ids[1]}.png`, bytes = productionFileProbeBytes();
  let storage: TransactionFileStorage;
  try { storage = (dependencies.storageFactory ?? createTransactionFileStorage)(env); }
  catch { throw new ProductionFilePreflightError("storage_unavailable"); }
  if (storage.enabled !== true) throw new ProductionFilePreflightError("storage_unavailable");
  let failure: ProductionFilePreflightError | null = null, digest = "";
  try {
    // Cleanup is mandatory after invoking put, even if its acknowledgement is lost.
    let uploaded: Awaited<ReturnType<TransactionFileStorage["put"]>>;
    try { uploaded = await storage.put(pathname, bytes, "image/png"); }
    catch { throw new ProductionFilePreflightError("upload_failed"); }
    if (!uploaded.ok) throw new ProductionFilePreflightError("upload_failed");
    digest = await verifyProbe(storage, pathname, bytes);
  } catch (error) { failure = error instanceof ProductionFilePreflightError ? error : new ProductionFilePreflightError("read_failed"); }
  finally {
    let removed = false;
    try { removed = await storage.removeOrphan(pathname); } catch { /* Provider errors never cross the release boundary. */ }
    if (!removed) throw new ProductionFilePreflightError("cleanup_failed", failure?.code);
  }
  if (failure) throw failure;
  return { ok: true, target: "production", storeId: APPROVED_PRODUCTION_FILE_STORE_ID, probe: { contentType: "image/png", bytes: bytes.byteLength, sha256: digest, exactReadVerified: true, removed: true }, clientRecordsTouched: false };
}
