// Actual production adapters, multipart files and download bytes over the closed synthetic API.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installPreviewTransport, getPreviewMetrics } from "./fixtures.mjs";
import { sampleTransactionBundles, SAMPLE_FOREIGN_TRANSACTION_ID } from "./transaction-fixtures.mjs";
import { SAMPLE_ACTOR } from "./sample-session.mjs";
import { MAX_TRANSACTION_ATTACHMENT_BYTES } from "../../lib/transactions/attachment-format.ts";
import { useDataVersion } from "../../lib/data/store.ts";

const root = fileURLToPath(new URL("../../", import.meta.url)), output = fileURLToPath(new URL(`./dist/transaction-operations-test-${process.pid}.mjs`, import.meta.url));
mkdirSync(path.dirname(output), { recursive: true });
const bundle = await build({ stdin: { contents: 'export * from "./lib/data/adapters/transactions.ts"; export * from "./lib/data/adapters/transaction-workspace.ts"; export * from "./lib/data/adapters/transaction-setup.ts";', resolveDir: root, sourcefile: "preview-transaction-operations-entry.ts" }, bundle: true, write: false, platform: "node", format: "esm", tsconfigRaw: { compilerOptions: {} }, plugins: [{ name: "actual-operation-adapters", setup(builder) {
  builder.onResolve({ filter: /^(?:@\/|\.|\/)/ }, args => {
    const base = args.path.startsWith("@/") ? path.join(root, args.path.slice(2)) : path.resolve(args.resolveDir || root, args.path);
    const found = [base, ...[".ts", ".tsx", ".mjs", ".js", "/index.ts"].map(suffix => base + suffix)].find(candidate => existsSync(candidate));
    if (!found) return undefined;
    return found === path.join(root, "lib/data/store.ts") ? { path: pathToFileURL(found).href, external: true } : { path: found };
  });
} }] });
writeFileSync(output, bundle.outputFiles[0].text);
let api;
try { api = await import(pathToFileURL(output).href); } finally { rmSync(output, { force: true }); }
globalThis.window = Object.assign(new EventTarget(), { location: { search: "?scenario=records&view=%2Ftransactions", origin: "http://127.0.0.1:4173" } });
installPreviewTransport();
const calls = [], responses = [];
globalThis.fetch = async (input, init = {}) => { calls.push({ path: String(input), method: init.method || "GET", body: init.body, headers: init.headers }); const response = await window.fetch(input, init); responses.push({ path: String(input), method: init.method || "GET", status: response.status, headers: response.headers }); return response; };
const mode = value => { window.location.search = `?scenario=${value}&view=%2Ftransactions`; };
const refused = (fn, status, code) => assert.rejects(fn, error => error.status === status && (!code || error.code === code));
const itemInput = (file, item) => ({ requestId: crypto.randomUUID(), expectedUpdatedAt: file.updatedAt, itemId: item.id, expectedItemUpdatedAt: item.updatedAt });
const itemOf = (file, id) => file.checklist.items.find(item => item.id === id);
const completion = (file, item, action = "complete") => ({ ...itemInput(file, item), action });
const selection = (file, role, vendor = null, status = "selected") => ({ requestId: crypto.randomUUID(), expectedUpdatedAt: file.updatedAt, role, status, vendorId: vendor?.id ?? null, expectedVendorUpdatedAt: vendor?.updatedAt ?? null, expectedSelectionUpdatedAt: file.vendors.find(item => item.role === role)?.updatedAt ?? null });
const fields = (vendor, extra = {}) => { const { id, updatedAt, ...values } = vendor; return { ...values, ...extra }; };
const vendorInput = (extra = {}) => ({ requestId: crypto.randomUUID(), vendor: { name: "Sample operations specialist", company: "Sample operations company", email: "operations@example.test", phone: "954-555-0108", categories: ["inspector", "mortgage"], approved: false, ...extra } });
const makeFile = async name => { const result = await api.createTransaction({ requestId: crypto.randomUUID(), address: name, city: "Sample City", clientName: "Sample client", side: "buyer", contractPrice: 0 }); return api.getTransactionWorkspace(result.id); };
const pdfBytes = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
const pdf = new File([pdfBytes], "../../Sample proof.exe", { type: "application/octet-stream" });
const base = JSON.stringify(sampleTransactionBundles), actor = { ...SAMPLE_ACTOR };
let groups = 0;

assert.equal(await api.getTransactionSource(), "db");
const baseline = await api.getTransactionWorkspace("sample-offer"), defaults = await api.getChecklistAttachmentDefaults(), originalDirectory = await api.getBrokerageVendors();
assert.equal(baseline.attachmentUploadsEnabled, true); assert.equal(baseline.canManageTransactionSetup, true); assert.deepEqual(baseline.vendors, []);
assert(defaults.items.every(item => item.attachmentRequired === false && item.updatedAt === null)); assert(originalDirectory.items.some(vendor => !vendor.approved));
await refused(() => api.createBrokerageVendor(vendorInput()), 403, "preview_read_only");
await refused(() => api.uploadTransactionAttachment(baseline.transaction.id, itemInput(baseline, baseline.checklist.items[0]), pdf), 403, "preview_read_only"); groups++;

mode("interactive");
for (const role of ["agent", "broker", "transaction_coordinator", "member"]) {
  SAMPLE_ACTOR.role = role;
  const directory = await api.getBrokerageVendors(); assert.equal(directory.canManage, false); assert(directory.items.every(vendor => vendor.approved));
  assert.equal((await api.getChecklistAttachmentDefaults()).canManage, false);
  await refused(() => api.updateChecklistAttachmentDefault({ requestId: crypto.randomUUID(), templateKey: defaults.items[0].templateKey, attachmentRequired: true, expectedUpdatedAt: null }), 403, "forbidden");
  await refused(() => api.createBrokerageVendor(vendorInput()), 403, "forbidden");
  const existing = originalDirectory.items[0]; await refused(() => api.updateBrokerageVendor(existing.id, { requestId: crypto.randomUUID(), expectedUpdatedAt: existing.updatedAt, vendor: fields(existing, { approved: false }) }), 403, "forbidden");
  await refused(() => api.updateTransactionAttachmentRequirement(baseline.transaction.id, { ...itemInput(baseline, baseline.checklist.items[0]), attachmentRequired: true }), 403, "forbidden");
}
SAMPLE_ACTOR.role = "admin"; groups++;

const defaultInput = Object.freeze({ requestId: crypto.randomUUID(), templateKey: defaults.items[0].templateKey, attachmentRequired: true, expectedUpdatedAt: null });
const changedDefaults = await api.updateChecklistAttachmentDefault(defaultInput), defaultRevision = changedDefaults.items[0].updatedAt;
assert(defaultRevision); assert.equal(changedDefaults.items[0].attachmentRequired, true);
assert.equal((await api.updateChecklistAttachmentDefault(defaultInput)).items[0].updatedAt, defaultRevision);
await refused(() => api.updateChecklistAttachmentDefault({ ...defaultInput, attachmentRequired: false }), 409, "request_conflict");
await refused(() => api.updateChecklistAttachmentDefault({ ...defaultInput, requestId: crypto.randomUUID() }), 409, "conflict");
assert.equal((await api.getTransactionWorkspace(baseline.transaction.id)).checklist.items[0].attachmentRequired, false);
let proofFile = await makeFile("Sample operations proof file"), proofId = proofFile.checklist.items[0].id;
assert.equal(itemOf(proofFile, proofId).attachmentRequired, true); assert.deepEqual(itemOf(proofFile, proofId).attachments, []); groups++;

const activityBeforeProof = JSON.stringify(getPreviewMetrics().activity.data), touchesBefore = JSON.stringify(getPreviewMetrics().contacts.data);
await refused(() => api.mutateTransactionChecklist(proofFile.transaction.id, completion(proofFile, itemOf(proofFile, proofId))), 409, "attachment_required");
const upload = Object.freeze(itemInput(proofFile, itemOf(proofFile, proofId))), versionBefore = useDataVersion.getState().version, uploadStart = calls.length;
proofFile = await api.uploadTransactionAttachment(proofFile.transaction.id, upload, pdf);
assert.equal(useDataVersion.getState().version, versionBefore + 1);
const uploaded = itemOf(proofFile, proofId).attachments[0], sent = calls.slice(uploadStart).find(call => call.method === "POST");
assert(sent.body instanceof FormData); assert.equal(sent.body.get("file").name, pdf.name); assert.equal(sent.headers["Content-Type"], undefined);
assert.equal(uploaded.filename, "Sample proof.pdf"); assert.equal(uploaded.contentType, "application/pdf"); assert.equal(uploaded.sizeBytes, pdfBytes.length); assert.equal(uploaded.itemId, proofId);
assert(!JSON.stringify(uploaded).includes("storagePath")); assert(!JSON.stringify(uploaded).includes("sha256"));
assert.notEqual(proofFile.updatedAt, upload.expectedUpdatedAt); assert.notEqual(itemOf(proofFile, proofId).updatedAt, upload.expectedItemUpdatedAt);
const uploadHistory = proofFile.history.total, replayedUpload = await api.uploadTransactionAttachment(proofFile.transaction.id, upload, pdf);
assert.equal(replayedUpload.history.total, uploadHistory); assert.equal(itemOf(replayedUpload, proofId).attachments.length, 1); assert.equal(itemOf(replayedUpload, proofId).attachments[0].id, uploaded.id);
await refused(() => api.uploadTransactionAttachment(proofFile.transaction.id, { ...upload, requestId: crypto.randomUUID() }, pdf), 409, "conflict");
await refused(() => api.uploadTransactionAttachment(proofFile.transaction.id, upload, new File([pdfBytes, "\n"], "Different proof.pdf", { type: "application/pdf" })), 409, "request_conflict"); groups++;

const downloaded = await api.downloadTransactionAttachment(proofFile.transaction.id, uploaded.id); assert.equal(downloaded.type, "application/pdf"); assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), pdfBytes);
const downloadResponse = responses.findLast(response => response.path.endsWith(`/attachments/${uploaded.id}`));
assert.equal(downloadResponse.headers.get("Cache-Control"), "private, no-store"); assert.equal(downloadResponse.headers.get("X-Content-Type-Options"), "nosniff"); assert(downloadResponse.headers.get("Content-Disposition").includes("attachment;"));
await refused(() => api.downloadTransactionAttachment(baseline.transaction.id, uploaded.id), 404, "not_found");
await refused(() => api.downloadTransactionAttachment(SAMPLE_FOREIGN_TRANSACTION_ID, uploaded.id), 404, "not_found");
SAMPLE_ACTOR.role = "member"; assert.deepEqual(new Uint8Array(await (await api.downloadTransactionAttachment(proofFile.transaction.id, uploaded.id)).arrayBuffer()), pdfBytes);
await refused(() => api.uploadTransactionAttachment(proofFile.transaction.id, itemInput(proofFile, itemOf(proofFile, proofId)), pdf), 403, "forbidden");
await refused(() => api.removeTransactionAttachment(proofFile.transaction.id, uploaded.id, { ...itemInput(proofFile, itemOf(proofFile, proofId)), expectedAttachmentUpdatedAt: uploaded.updatedAt }), 403, "forbidden");
SAMPLE_ACTOR.role = "admin"; groups++;

await refused(() => api.uploadTransactionAttachment(proofFile.transaction.id, itemInput(proofFile, itemOf(proofFile, proofId)), new File(["<!doctype html>pretend PDF"], "fake.pdf", { type: "application/pdf" })), 400, "invalid_attachment");
await refused(() => api.uploadTransactionAttachment(proofFile.transaction.id, itemInput(proofFile, itemOf(proofFile, proofId)), new File([new Uint8Array(MAX_TRANSACTION_ATTACHMENT_BYTES + 1)], "huge.pdf", { type: "application/pdf" })), 413, "file_too_large");
const invalidForm = new FormData(); invalidForm.append("file", pdf); invalidForm.append("requestId", crypto.randomUUID()); invalidForm.append("requestId", crypto.randomUUID()); invalidForm.append("expectedUpdatedAt", proofFile.updatedAt); invalidForm.append("expectedItemUpdatedAt", itemOf(proofFile, proofId).updatedAt);
assert.equal((await fetch(`/api/transactions/${proofFile.transaction.id}/checklist/${proofId}/attachments`, { method: "POST", body: invalidForm })).status, 400); groups++;

proofFile = await api.mutateTransactionChecklist(proofFile.transaction.id, completion(proofFile, itemOf(proofFile, proofId)));
assert(itemOf(proofFile, proofId).completedAt); assert.equal(proofFile.checklist.progress.completed, 1);
await refused(() => api.removeTransactionAttachment(proofFile.transaction.id, uploaded.id, { ...itemInput(proofFile, itemOf(proofFile, proofId)), expectedAttachmentUpdatedAt: uploaded.updatedAt }), 409, "attachment_requires_reopen");
proofFile = await api.mutateTransactionChecklist(proofFile.transaction.id, completion(proofFile, itemOf(proofFile, proofId), "reopen"));
const remove = Object.freeze({ ...itemInput(proofFile, itemOf(proofFile, proofId)), expectedAttachmentUpdatedAt: uploaded.updatedAt });
proofFile = await api.removeTransactionAttachment(proofFile.transaction.id, uploaded.id, remove); assert.deepEqual(itemOf(proofFile, proofId).attachments, []);
assert.equal((await api.removeTransactionAttachment(proofFile.transaction.id, uploaded.id, remove)).history.total, proofFile.history.total);
await refused(() => api.downloadTransactionAttachment(proofFile.transaction.id, uploaded.id), 404, "not_found");
await refused(() => api.mutateTransactionChecklist(proofFile.transaction.id, completion(proofFile, itemOf(proofFile, proofId))), 409, "attachment_required");
const secondOpportunity = proofFile.checklist.items.find(item => item.stage === "opportunity" && item.id !== proofId);
proofFile = await api.mutateTransactionChecklist(proofFile.transaction.id, completion(proofFile, secondOpportunity));
await refused(() => api.updateTransactionStage(proofFile.transaction.id, "offer", { requestId: crypto.randomUUID(), expectedUpdatedAt: proofFile.updatedAt }), 409, "checklist_incomplete");
assert.equal(JSON.stringify(getPreviewMetrics().activity.data), activityBeforeProof); assert.equal(JSON.stringify(getPreviewMetrics().contacts.data), touchesBefore); groups++;

// Per-file changes do not rewrite defaults; enabling proof on completed, unproven work requires reopening.
await refused(() => api.updateTransactionAttachmentRequirement(proofFile.transaction.id, { ...itemInput(proofFile, itemOf(proofFile, secondOpportunity.id)), attachmentRequired: true }), 409, "attachment_requires_reopen");
let oldFile = await api.getTransactionWorkspace(baseline.transaction.id);
oldFile = await api.updateTransactionAttachmentRequirement(oldFile.transaction.id, { ...itemInput(oldFile, oldFile.checklist.items[1]), attachmentRequired: true });
assert.equal(oldFile.checklist.items[1].attachmentRequired, true); assert.equal(oldFile.checklist.items[0].attachmentRequired, false);
await api.updateChecklistAttachmentDefault({ requestId: crypto.randomUUID(), templateKey: defaultInput.templateKey, attachmentRequired: false, expectedUpdatedAt: defaultRevision });
assert.equal((await api.getTransactionWorkspace(proofFile.transaction.id)).checklist.items[0].attachmentRequired, true);
const laterFile = await makeFile("Sample after default reset"); assert.equal(laterFile.checklist.items[0].attachmentRequired, false); groups++;

// Lose a response after the multipart operation committed: no automatic write retry, then exact receipt recovery.
let recoverFile = await makeFile("Sample interrupted attachment file"); const recoverItem = recoverFile.checklist.items[0], lostInput = Object.freeze(itemInput(recoverFile, recoverItem)), actualTransport = window.fetch; let lose = true;
window.fetch = async (input, init = {}) => { const response = await actualTransport(input, init); if (lose && init.method === "POST" && String(input).endsWith(`/checklist/${recoverItem.id}/attachments`) && response.ok) { lose = false; throw new TypeError("Synthetic lost multipart response after commit"); } return response; };
const lostStart = calls.length; await assert.rejects(() => api.uploadTransactionAttachment(recoverFile.transaction.id, lostInput, pdf), TypeError); assert.equal(calls.slice(lostStart).filter(call => call.method === "POST").length, 1);
recoverFile = await api.uploadTransactionAttachment(recoverFile.transaction.id, lostInput, pdf); assert.equal(recoverFile.checklist.items[0].attachments.length, 1); assert.equal(recoverFile.history.total, 2); window.fetch = actualTransport; groups++;

// Admin-curated directory and file selection use separate CAS tokens and retain identity snapshots.
const pendingInput = Object.freeze(vendorInput()); let vendor = await api.createBrokerageVendor(pendingInput);
assert.equal(vendor.approved, false); assert.equal((await api.createBrokerageVendor(pendingInput)).id, vendor.id);
await refused(() => api.createBrokerageVendor({ ...pendingInput, vendor: { ...pendingInput.vendor, approved: true } }), 409, "request_conflict");
let vendorFile = await api.getTransactionWorkspace(oldFile.transaction.id);
await refused(() => api.updateTransactionVendor(vendorFile.transaction.id, selection(vendorFile, "inspector", vendor)), 409, "vendor_unavailable");
const approval = Object.freeze({ requestId: crypto.randomUUID(), expectedUpdatedAt: vendor.updatedAt, vendor: fields(vendor, { approved: true }) }); vendor = await api.updateBrokerageVendor(vendor.id, approval);
assert.equal((await api.updateBrokerageVendor(vendor.id, approval)).updatedAt, vendor.updatedAt);
await refused(() => api.updateBrokerageVendor(vendor.id, { ...approval, requestId: crypto.randomUUID() }), 409, "conflict");
assert((await api.getBrokerageVendors("inspector")).items.some(item => item.id === vendor.id)); assert(!(await api.getBrokerageVendors("title")).items.some(item => item.id === vendor.id)); groups++;

SAMPLE_ACTOR.role = "agent"; const selectedInput = Object.freeze(selection(vendorFile, "inspector", vendor)), vendorHistory = vendorFile.history.total;
vendorFile = await api.updateTransactionVendor(vendorFile.transaction.id, selectedInput); assert.equal(vendorFile.canManageTransactionSetup, false);
const chosen = vendorFile.vendors.find(item => item.role === "inspector"); assert.equal(chosen.vendorName, vendor.name); assert.equal(chosen.email, vendor.email); assert.equal(chosen.approved, true);
assert.equal(vendorFile.history.total, vendorHistory + 1); assert.equal((await api.updateTransactionVendor(vendorFile.transaction.id, selectedInput)).history.total, vendorFile.history.total);
await refused(() => api.updateTransactionVendor(vendorFile.transaction.id, { ...selectedInput, requestId: crypto.randomUUID() }), 409, "conflict");
await refused(() => api.updateTransactionVendor(vendorFile.transaction.id, { ...selection(vendorFile, "inspector", vendor), expectedSelectionUpdatedAt: null }), 409, "conflict");
await refused(() => api.updateTransactionVendor(vendorFile.transaction.id, selection(vendorFile, "appraiser", vendor)), 409, "vendor_unavailable");
await refused(() => api.updateTransactionVendor(vendorFile.transaction.id, { ...selection(vendorFile, "other", vendor), vendorName: "Unapproved arbitrary provider" }), 400, "invalid_transaction");
await refused(() => api.updateTransactionVendor(SAMPLE_FOREIGN_TRANSACTION_ID, { ...selectedInput, requestId: crypto.randomUUID() }), 404, "not_found"); groups++;

SAMPLE_ACTOR.role = "admin"; const priorVendor = vendor;
vendor = await api.updateBrokerageVendor(vendor.id, { requestId: crypto.randomUUID(), expectedUpdatedAt: vendor.updatedAt, vendor: fields(vendor, { name: "Sample revised directory identity", email: "revised@example.test" }) });
vendorFile = await api.getTransactionWorkspace(vendorFile.transaction.id); assert.equal(vendorFile.vendors[0].vendorName, priorVendor.name); assert.equal(vendorFile.vendors[0].email, priorVendor.email); assert.equal(vendorFile.vendors[0].approved, true);
await refused(() => api.updateTransactionVendor(vendorFile.transaction.id, selection(vendorFile, "inspector", priorVendor)), 409, "conflict");
vendor = await api.updateBrokerageVendor(vendor.id, { requestId: crypto.randomUUID(), expectedUpdatedAt: vendor.updatedAt, vendor: fields(vendor, { approved: false }) });
SAMPLE_ACTOR.role = "agent"; vendorFile = await api.getTransactionWorkspace(vendorFile.transaction.id); assert.equal(vendorFile.vendors[0].approved, false); assert.equal(vendorFile.vendors[0].vendorName, priorVendor.name);
assert(!(await api.getBrokerageVendors()).items.some(item => item.id === vendor.id));
await refused(() => api.updateTransactionVendor(vendorFile.transaction.id, selection(vendorFile, "inspector", vendor)), 409, "vendor_unavailable");
vendorFile = await api.updateTransactionVendor(vendorFile.transaction.id, selection(vendorFile, "inspector", null, "not_needed")); assert.equal(vendorFile.vendors[0].status, "not_needed"); assert.equal(vendorFile.vendors[0].vendorId, null); assert.equal(vendorFile.vendors[0].email, null);
vendorFile = await api.updateTransactionVendor(vendorFile.transaction.id, selection(vendorFile, "inspector", null, "unset")); assert.equal(vendorFile.vendors[0].status, "unset"); assert.equal(vendorFile.vendors[0].id, chosen.id); groups++;

SAMPLE_ACTOR.role = "member"; await refused(() => api.updateTransactionVendor(vendorFile.transaction.id, selection(vendorFile, "inspector", null, "not_needed")), 403, "forbidden");
SAMPLE_ACTOR.role = "admin"; SAMPLE_ACTOR.brokerageKey = "other-preview-book";
assert.deepEqual((await api.getBrokerageVendors()).items, []);
await refused(() => api.updateBrokerageVendor(vendor.id, { requestId: crypto.randomUUID(), expectedUpdatedAt: vendor.updatedAt, vendor: fields(vendor, { approved: true }) }), 404, "not_found");
await refused(() => api.getTransactionWorkspace(vendorFile.transaction.id), 404, "not_found");
Object.assign(SAMPLE_ACTOR, actor); groups++;

// Terminal files retain readable evidence and exact already-committed receipts, but accept no new edits.
recoverFile = await api.getTransactionWorkspace(recoverFile.transaction.id); await api.updateTransactionStage(recoverFile.transaction.id, "cancelled", { requestId: crypto.randomUUID(), expectedUpdatedAt: recoverFile.updatedAt }); recoverFile = await api.getTransactionWorkspace(recoverFile.transaction.id);
assert.equal(recoverFile.canEdit, false); const retained = recoverFile.checklist.items[0].attachments[0]; assert.deepEqual(new Uint8Array(await (await api.downloadTransactionAttachment(recoverFile.transaction.id, retained.id)).arrayBuffer()), pdfBytes);
await refused(() => api.uploadTransactionAttachment(recoverFile.transaction.id, itemInput(recoverFile, recoverFile.checklist.items[0]), pdf), 409, "invalid_transition");
await refused(() => api.removeTransactionAttachment(recoverFile.transaction.id, retained.id, { ...itemInput(recoverFile, recoverFile.checklist.items[0]), expectedAttachmentUpdatedAt: retained.updatedAt }), 409, "invalid_transition");
await refused(() => api.updateTransactionVendor(recoverFile.transaction.id, selection(recoverFile, "inspector", null, "not_needed")), 409, "invalid_transition");
assert.equal((await api.uploadTransactionAttachment(recoverFile.transaction.id, lostInput, pdf)).transaction.stage, "cancelled"); groups++;

const histories = JSON.stringify([vendorFile.history, proofFile.history, recoverFile.history]); assert(!histories.includes("operations@example.test")); assert(!histories.includes("Sample operations specialist")); assert(!histories.includes("Sample proof.pdf"));
assert(calls.every(call => !/operations@example|revised@example|Sample%20proof|Sample proof|Sample operations specialist/.test(call.path)));
mode("records"); assert.equal(JSON.stringify(sampleTransactionBundles), base); assert.equal((await api.getTransactionWorkspace(baseline.transaction.id)).vendors.length, 0); assert.equal((await api.getTransactionWorkspace(baseline.transaction.id)).checklist.items[1].attachmentRequired, false); assert.equal((await api.getTransactions()).length, 6); groups++;

console.log(`PASS: ${groups} isolated transaction operations groups (actual adapters, multipart PDF bytes/download/removal, proof and stage gates, default snapshots, Admin-only directory, approved role choices, retired identity preservation, CAS/UUID recovery, scope, terminal/Member rules and private history).`);
