import "server-only";
import { put, get, del, type PutCommandOptions, type GetCommandOptions, type DeleteCommandOptions } from "@vercel/blob";
import { MAX_TRANSACTION_ATTACHMENT_BYTES, type TransactionAttachmentContentType } from "./attachment-format.ts";

export type TransactionFileStorageFailure = "not_configured" | "not_found" | "unavailable";
export interface TransactionFileStorage {
  enabled: boolean;
  put(pathname: string, bytes: Uint8Array, contentType: TransactionAttachmentContentType): Promise<{ ok: true } | { ok: false; reason: TransactionFileStorageFailure }>;
  get(pathname: string): Promise<{ ok: true; stream: ReadableStream<Uint8Array>; sizeBytes: number } | { ok: false; reason: TransactionFileStorageFailure }>;
  removeOrphan(pathname: string): Promise<boolean>;
}
type Sdk = {
  put: (path: string, body: Buffer, options: PutCommandOptions) => Promise<{ pathname: string }>;
  get: (path: string, options: GetCommandOptions) => ReturnType<typeof get>;
  del: (path: string, options: DeleteCommandOptions) => Promise<void>;
};
export function transactionFilesEnabled(env: Record<string, string | undefined> = process.env): boolean { return env.TRANSACTION_FILES_ENABLED === "1" && Boolean(env.TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN?.trim()); }
export function isTransactionFilePath(pathname: string): boolean { return /^transaction-files\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:pdf|jpg|png)$/.test(pathname); }
/** Inert constructor. This subsystem never borrows public-photo, generic, or OIDC credentials. */
export function createTransactionFileStorage(env: Record<string, string | undefined> = process.env, options: { sdk?: Sdk; signal?: AbortSignal } = {}): TransactionFileStorage {
  const enabled = transactionFilesEnabled(env), token = env.TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN?.trim(), sdk = options.sdk ?? { put, get, del };
  const signal = () => options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
  return { enabled,
    async put(pathname, bytes, contentType) { if (!enabled) return { ok: false, reason: "not_configured" }; if (!isTransactionFilePath(pathname) || !bytes.length || bytes.length > MAX_TRANSACTION_ATTACHMENT_BYTES) return { ok: false, reason: "unavailable" };
      try { const result = await sdk.put(pathname, Buffer.from(bytes), { token, access: "private", contentType, addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60, maximumSizeInBytes: MAX_TRANSACTION_ATTACHMENT_BYTES, abortSignal: signal() }); return result.pathname === pathname ? { ok: true } : { ok: false, reason: "unavailable" }; } catch { return { ok: false, reason: "unavailable" }; } },
    async get(pathname) { if (!token) return { ok: false, reason: "not_configured" }; if (!isTransactionFilePath(pathname)) return { ok: false, reason: "not_found" };
      try { const result = await sdk.get(pathname, { token, access: "private", useCache: false, abortSignal: signal() }); if (!result) return { ok: false, reason: "not_found" }; if (result.statusCode !== 200) return { ok: false, reason: "unavailable" };
        if (result.blob.pathname !== pathname || result.blob.size < 1 || result.blob.size > MAX_TRANSACTION_ATTACHMENT_BYTES) { await result.stream.cancel(); return { ok: false, reason: "unavailable" }; } return { ok: true, stream: result.stream, sizeBytes: result.blob.size };
      } catch { return { ok: false, reason: "unavailable" }; } },
    async removeOrphan(pathname) { if (!token || !isTransactionFilePath(pathname)) return false; try { await sdk.del(pathname, { token, abortSignal: signal() }); return true; } catch { return false; } },
  };
}
