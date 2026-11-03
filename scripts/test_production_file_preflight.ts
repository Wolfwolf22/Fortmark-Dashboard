/** Injected storage only. Never runs the release probe against a live provider. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { APPROVED_PRODUCTION_FILE_STORE_ID, ProductionFilePreflightError, productionFileProbeBytes, runProductionFilePreflight } from "./production-file-preflight-core.ts";
import { readProductionFilePreflightArguments } from "./production-file-preflight.ts";
import { createTransactionFileStorage, type TransactionFileStorage } from "../lib/transactions/transaction-file-storage.ts";
import { detectTransactionAttachment } from "../lib/transactions/attachment-format.ts";

let checks = 0;
function check(name: string, value: unknown) { assert.ok(value, name); checks++; console.log(`PASS ${name}`); }
const options = { force: true, expectedStoreId: APPROVED_PRODUCTION_FILE_STORE_ID };
const environment = { VERCEL_ENV: "production", TRANSACTION_FILES_ENABLED: "1", TRANSACTION_FILES_BLOB_STORE_ID: APPROVED_PRODUCTION_FILE_STORE_ID, TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_NSTN5f48IHugiItT_synthetic-private-token" };
const ids = ["10000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002"], pathname = `transaction-files/${ids[0]}/${ids[1]}.png`;
const clientPath = "transaction-files/30000000-0000-4000-8000-000000000003/40000000-0000-4000-8000-000000000004.pdf";
type Behavior = { put?: "fail" | "throw" | "lost"; get?: "fail" | "throw" | "stream_error"; bytes?: Uint8Array; size?: number; cleanup?: "fail" | "throw"; enabled?: boolean };
function harness(behavior: Behavior = {}) {
  const calls: { kind: string; path: string; contentType?: string; bytes?: Uint8Array }[] = [], files = new Map<string, Uint8Array>([[clientPath, new Uint8Array([1, 2, 3])]]);
  let uuidCalls = 0, factoryCalls = 0;
  const storage: TransactionFileStorage = {
    enabled: behavior.enabled !== false,
    async put(path, bytes, contentType) {
      calls.push({ kind: "put", path, bytes: bytes.slice(), contentType });
      if (behavior.put === "throw") throw Error("provider-error-containing-synthetic-private-token");
      if (behavior.put === "fail") return { ok: false, reason: "unavailable" };
      files.set(path, bytes.slice());
      if (behavior.put === "lost") throw Error("provider acknowledgement lost after put containing-synthetic-private-token");
      return { ok: true };
    },
    async get(path) {
      calls.push({ kind: "get", path });
      if (behavior.get === "throw") throw Error("provider-error-containing-synthetic-private-token");
      if (behavior.get === "fail") return { ok: false, reason: "unavailable" };
      const bytes = behavior.bytes ?? files.get(path)!;
      return { ok: true, sizeBytes: behavior.size ?? bytes.byteLength, stream: new ReadableStream<Uint8Array>({ start(controller) { if (behavior.get === "stream_error") { controller.error(Error("provider-error-containing-synthetic-private-token")); return; } controller.enqueue(bytes.slice(0, 11)); controller.enqueue(bytes.slice(11)); controller.close(); } }) };
    },
    async removeOrphan(path) { calls.push({ kind: "remove", path }); if (behavior.cleanup === "throw") throw Error("provider-error-containing-synthetic-private-token"); if (behavior.cleanup === "fail") return false; files.delete(path); return true; },
  };
  return { calls, files, dependencies: { storageFactory: () => { factoryCalls++; return storage; }, randomUuid: () => ids[uuidCalls++] }, counts: () => ({ uuidCalls, factoryCalls }) };
}
async function refusal(behavior: Behavior, expected: string) {
  const test = harness(behavior); let failure: unknown;
  try { await runProductionFilePreflight(options, environment, test.dependencies); } catch (error) { failure = error; }
  check(`${expected} refuses release with a fixed safe error code`, failure instanceof ProductionFilePreflightError && failure.code === expected && !String(failure).includes("synthetic-private-token"));
  return { ...test, failure: failure as ProductionFilePreflightError };
}

{
  const bytes = productionFileProbeBytes();
  function crc32(data: Uint8Array) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
  const chunks: { kind: string; data: Uint8Array }[] = []; let valid = true;
  for (let offset = 8; offset < bytes.byteLength;) { const length = Buffer.from(bytes).readUInt32BE(offset), data = bytes.subarray(offset + 8, offset + 8 + length), kind = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString("ascii"); valid &&= crc32(bytes.subarray(offset + 4, offset + 8 + length)) === Buffer.from(bytes).readUInt32BE(offset + 8 + length); chunks.push({ kind, data }); offset += 12 + length; }
  check("probe is a genuine small PNG accepted by actual attachment validation", bytes.byteLength === 68 && detectTransactionAttachment(bytes)?.contentType === "image/png");
  check("PNG contains correct chunk checksums and one transparent RGBA pixel", valid && chunks.map(chunk => chunk.kind).join(",") === "IHDR,IDAT,IEND" && Buffer.from(chunks[0].data).readUInt32BE(0) === 1 && Buffer.from(chunks[0].data).readUInt32BE(4) === 1 && chunks[0].data[8] === 8 && chunks[0].data[9] === 6 && inflateSync(chunks[1].data).equals(Buffer.alloc(5)));
  bytes[0] = 0; check("each run gets independent immutable-source probe bytes", productionFileProbeBytes()[0] === 137);
}
{
  const test = harness(), report = await runProductionFilePreflight(options, environment, test.dependencies);
  check("successful release checks one put, exact read, then owned cleanup", test.calls.map(call => call.kind).join(",") === "put,get,remove" && test.calls.every(call => call.path === pathname));
  check("probe uses only generated UUIDs, a PNG path and the exact synthetic bytes", test.counts().uuidCalls === 2 && test.calls[0].contentType === "image/png" && Buffer.from(test.calls[0].bytes!).equals(Buffer.from(productionFileProbeBytes())));
  check("successful cleanup removes the probe and never alters an existing client object", !test.files.has(pathname) && test.files.size === 1 && test.files.get(clientPath)?.join(",") === "1,2,3");
  check("safe success report identifies approved store, exact checksum and completed cleanup", report.ok && report.storeId === APPROVED_PRODUCTION_FILE_STORE_ID && report.probe.bytes === 68 && report.probe.exactReadVerified && report.probe.removed && report.probe.sha256 === createHash("sha256").update(productionFileProbeBytes()).digest("hex") && !report.clientRecordsTouched && !JSON.stringify(report).includes(environment.TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN) && !JSON.stringify(report).includes(pathname));
}
const invalidConfigurations: [string, typeof options, Record<string, string | undefined>][] = [
  ["production_scope_required", options, { ...environment, VERCEL_ENV: "preview" }],
  ["production_scope_required", options, { ...environment, VERCEL_ENV: undefined }],
  ["explicit_force_required", { ...options, force: false }, environment],
  ["approved_store_required", { ...options, expectedStoreId: "store_unapproved" }, environment],
  ["store_identity_mismatch", options, { ...environment, TRANSACTION_FILES_BLOB_STORE_ID: "store_unapproved" }],
  ["store_identity_mismatch", options, { ...environment, TRANSACTION_FILES_BLOB_STORE_ID: undefined }],
  ["file_uploads_required", options, { ...environment, TRANSACTION_FILES_ENABLED: "true" }],
  ["file_uploads_required", options, { ...environment, TRANSACTION_FILES_ENABLED: undefined }],
  ["dedicated_token_required", options, { ...environment, TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN: " " }],
  ["dedicated_token_required", options, { ...environment, TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN: undefined, BLOB_READ_WRITE_TOKEN: "synthetic-generic-token", PROFILE_BLOB_READ_WRITE_TOKEN: "synthetic-profile-token" }],
  ["dedicated_token_invalid", options, { ...environment, TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN: "synthetic-private-token" }],
  ["dedicated_token_invalid", options, { ...environment, TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN: "vercel_blob_client_NSTN5f48IHugiItT_synthetic-secret" }],
  ["dedicated_token_invalid", options, { ...environment, TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_NSTN5f48IHugiItT_" }],
  ["dedicated_token_invalid", options, { ...environment, TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_NSTN5f48IHugiItT_synthetic\nsecret" }],
  ["credential_store_mismatch", options, { ...environment, TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_ANOTHERPRIVATESTORE_synthetic-private-token" }],
  ["credential_store_mismatch", options, { ...environment, TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_nstn5f48ihugiitt_synthetic-private-token" }],
  ["credential_store_mismatch", options, { ...environment, TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_ANOTHERPRIVATESTORE_synthetic-private-token", BLOB_READ_WRITE_TOKEN: environment.TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN, PROFILE_BLOB_READ_WRITE_TOKEN: environment.TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN, VERCEL_OIDC_TOKEN: "synthetic-oidc-token", BLOB_STORE_ID: APPROVED_PRODUCTION_FILE_STORE_ID }],
];
for (const [code, input, env] of invalidConfigurations) {
  const test = harness(); await assert.rejects(runProductionFilePreflight(input, env, test.dependencies), error => error instanceof ProductionFilePreflightError && error.code === code && !String(error).includes("vercel_blob_") && !JSON.stringify(error).includes("synthetic-private-token"));
  check(`invalid ${code} configuration performs zero identity, storage or provider I/O`, test.counts().uuidCalls === 0 && test.counts().factoryCalls === 0 && test.calls.length === 0);
}
{
  const folder = dirname(createRequire(import.meta.url).resolve("@vercel/blob"));
  const sdkSource = readdirSync(folder).filter(name => /^chunk-.*\.js$/.test(name)).map(name => readFileSync(join(folder, name), "utf8")).find(source => source.includes("function parseStoreIdFromReadWriteToken(token)"));
  check("installed SDK still derives credential store identity from the exact fourth token field", Boolean(sdkSource && /function parseStoreIdFromReadWriteToken\(token\)\s*\{\s*const \[, , , storeId = ""\] = token\.split\("_"\);\s*return storeId;\s*\}/.test(sdkSource)));
  check("installed SDK explicit token remains authoritative before any ambient OIDC or generic credential", Boolean(sdkSource && /if \(options == null \? void 0 : options\.token\)\s*\{\s*const storeId = parseStoreIdFromReadWriteToken\(options\.token\);\s*return \{ kind: "readWrite", token: options\.token, storeId \};\s*\}/.test(sdkSource) && sdkSource.indexOf("parseStoreIdFromReadWriteToken(options.token)") < sdkSource.indexOf("const manualOidcToken")));
}
{
  const test = harness(); await assert.rejects(runProductionFilePreflight(options, environment, { ...test.dependencies, randomUuid: () => "../../existing-client-file" }), error => error instanceof ProductionFilePreflightError && error.code === "invalid_probe_identity");
  check("invalid generated probe identities cannot reach storage or target another path", test.counts().factoryCalls === 0 && test.calls.length === 0);
  const duplicate = harness(); await assert.rejects(runProductionFilePreflight(options, environment, { ...duplicate.dependencies, randomUuid: () => ids[0] }), error => error instanceof ProductionFilePreflightError && error.code === "invalid_probe_identity");
  check("namespace and object identities must be independently generated", duplicate.calls.length === 0);
  const disabled = await refusal({ enabled: false }, "storage_unavailable"); check("a disabled storage adapter cannot pass configuration or touch objects", disabled.calls.length === 0);
}
for (const put of ["fail", "throw", "lost"] as const) {
  const test = await refusal({ put }, "upload_failed");
  check(`${put} put acknowledgement always triggers one cleanup without reading or retrying`, test.calls.map(call => call.kind).join(",") === "put,remove" && test.calls.every(call => call.path === pathname) && !test.files.has(pathname) && test.files.has(clientPath));
}
for (const get of ["fail", "throw", "stream_error"] as const) {
  const test = await refusal({ get }, "read_failed");
  check(`${get} read still cleans only the owned object`, test.calls.map(call => call.kind).join(",") === "put,get,remove" && !test.files.has(pathname) && test.files.has(clientPath));
}
for (const behavior of [{ size: 69 }, { size: 68, bytes: productionFileProbeBytes().slice(0, 67) }, { size: 68, bytes: new Uint8Array(69) }]) {
  const test = await refusal(behavior, "read_size_mismatch"); check("incorrect advertised, short or oversized stream bytes refuse and clean up", !test.files.has(pathname) && test.calls.at(-1)?.kind === "remove");
}
{
  const changed = productionFileProbeBytes(); changed[changed.length - 1] ^= 1;
  const test = await refusal({ bytes: changed }, "read_checksum_mismatch"); check("same-size corruption cannot pass and still removes the owned probe", !test.files.has(pathname) && test.files.has(clientPath));
}
for (const cleanup of ["fail", "throw"] as const) {
  const test = await refusal({ cleanup }, "cleanup_failed"); check(`${cleanup} cleanup refuses release despite a verified read and never retries deletion`, test.calls.map(call => call.kind).join(",") === "put,get,remove" && test.files.has(clientPath));
}
{
  const test = await refusal({ put: "lost", cleanup: "fail" }, "cleanup_failed"); check("cleanup failure remains explicit after a lost put acknowledgement", test.failure.operationFailure === "upload_failed" && test.calls.map(call => call.kind).join(",") === "put,remove");
}
{
  const calls: { method: string; path: string; options: Record<string, unknown> }[] = [], files = new Map<string, Uint8Array>();
  const sdk = {
    put: async (path: string, bytes: Buffer, options: Record<string, unknown>) => { calls.push({ method: "put", path, options }); files.set(path, bytes); return { pathname: path }; },
    get: async (path: string, options: Record<string, unknown>) => { calls.push({ method: "get", path, options }); const bytes = files.get(path)!; return { statusCode: 200, blob: { pathname: path, size: bytes.byteLength }, stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }) }; },
    del: async (path: string, options: Record<string, unknown>) => { calls.push({ method: "del", path, options }); files.delete(path); },
  };
  let uuidIndex = 0;
  await runProductionFilePreflight(options, environment, { randomUuid: () => ids[uuidIndex++], storageFactory: env => createTransactionFileStorage(env, { sdk: sdk as unknown as NonNullable<Parameters<typeof createTransactionFileStorage>[1]>["sdk"] }) });
  check("actual private storage adapter performs the full put/get/delete probe with the dedicated credential", calls.map(call => call.method).join(",") === "put,get,del" && calls.every(call => call.path === pathname && call.options.token === environment.TRANSACTION_FILES_BLOB_READ_WRITE_TOKEN) && files.size === 0);
  check("actual upload is private, cannot overwrite, and keeps the exact generated path", calls[0].options.access === "private" && calls[0].options.allowOverwrite === false && calls[0].options.addRandomSuffix === false && calls[0].options.contentType === "image/png");
  check("actual read requests private uncached bytes rather than a public storage URL", calls[1].options.access === "private" && calls[1].options.useCache === false);
}
{
  check("CLI requires the explicit approved store declaration", JSON.stringify(readProductionFilePreflightArguments(["--force", "--expected-store-id", APPROVED_PRODUCTION_FILE_STORE_ID])) === JSON.stringify(options));
  for (const args of [["--unexpected"], ["--force", "--force"], ["--expected-store-id"], ["--expected-store-id", "--force"]]) { assert.throws(() => readProductionFilePreflightArguments(args), ProductionFilePreflightError); checks++; }
  const omitted = readProductionFilePreflightArguments([]); check("missing CLI authorization cannot become an implicit force run", omitted.force === false && omitted.expectedStoreId === "");
}
console.log(`${checks}/${checks} production private-file preflight checks passed (injected storage; no live operations)`);
