// Actual client adapters exercise immutable vendor generations over the closed synthetic transport.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installPreviewTransport } from "./fixtures.mjs";
import { SAMPLE_ACTOR } from "./sample-session.mjs";
import { SAMPLE_COLLEAGUE_ID } from "./contact-fixtures.mjs";
import { SAMPLE_FOREIGN_TRANSACTION_ID, sampleTransactionBundles } from "./transaction-fixtures.mjs";
import { DEFAULT_VENDOR_DETAIL_FIELDS, vendorMonthlyBreakdown } from "../../lib/transactions/vendor-detail-domain.ts";
import { MAX_TRANSACTION_ATTACHMENT_BYTES } from "../../lib/transactions/attachment-format.ts";

const root = fileURLToPath(new URL("../../", import.meta.url)), output = fileURLToPath(new URL(`./dist/vendor-detail-test-${process.pid}.mjs`, import.meta.url));
mkdirSync(path.dirname(output), { recursive: true });
const bundle = await build({ stdin: { contents: 'export * from "./lib/data/adapters/transactions.ts"; export * from "./lib/data/adapters/transaction-workspace.ts"; export * from "./lib/data/adapters/transaction-setup.ts"; export * from "./lib/data/adapters/vendor-details.ts";', resolveDir: root, sourcefile: "preview-vendor-detail-entry.ts" }, bundle: true, write: false, platform: "node", format: "esm", tsconfigRaw: { compilerOptions: {} }, plugins: [{ name: "actual-vendor-detail-adapters", setup(builder) {
  builder.onResolve({ filter: /^(?:@\/|\.|\/)/ }, args => {
    const base = args.path.startsWith("@/") ? path.join(root, args.path.slice(2)) : path.resolve(args.resolveDir || root, args.path);
    const found = [base, ...[".ts", ".tsx", ".mjs", ".js", "/index.ts"].map(suffix => base + suffix)].find(candidate => existsSync(candidate));
    if (!found) return undefined;
    return found === path.join(root, "lib/data/store.ts") ? { path: pathToFileURL(found).href, external: true } : { path: found };
  });
} }] });
writeFileSync(output, bundle.outputFiles[0].text); let api;
try { api = await import(pathToFileURL(output).href); } finally { rmSync(output, { force: true }); }
globalThis.window = Object.assign(new EventTarget(), { location: { search: "?scenario=interactive&view=%2Ftransactions", origin: "http://127.0.0.1:4173" } });
installPreviewTransport();
const calls = [], responses = [];
globalThis.fetch = async (input, init = {}) => { calls.push({ path: String(input), method: init.method || "GET", body: init.body, headers: init.headers }); const response = await window.fetch(input, init); responses.push({ path: String(input), status: response.status, headers: response.headers }); return response; };
const refused = (fn, status, code) => assert.rejects(fn, error => error.status === status && (!code || error.code === code));
const actor = { ...SAMPLE_ACTOR }, baseline = JSON.stringify(sampleTransactionBundles);
const detailInput = record => ({ requestId: crypto.randomUUID(), expectedUpdatedAt: record.transactionUpdatedAt, expectedDetailUpdatedAt: record.updatedAt });
const patch = (record, extra = {}) => ({ ...detailInput(record), details: { ...record.details, ...extra } });
const selection = (file, role, vendor = null, status = "selected") => ({ requestId: crypto.randomUUID(), expectedUpdatedAt: file.updatedAt, role, status, vendorId: vendor?.id ?? null, expectedVendorUpdatedAt: vendor?.updatedAt ?? null, expectedSelectionUpdatedAt: file.vendors.find(row => row.role === role)?.updatedAt ?? null });
const vendorFields = (vendor, extra = {}) => { const { id, updatedAt, ...fields } = vendor; return { ...fields, ...extra }; };
const choose = async (id, role, vendor = null, status = "selected") => { const file = await api.getTransactionWorkspace(id); return api.updateTransactionVendor(id, selection(file, role, vendor, status)); };
const pdfBytes = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
const pdf = new File([pdfBytes], "../../Sample preapproval.html", { type: "text/html" });
let groups = 0;

const created = await api.createTransaction({ requestId: crypto.randomUUID(), address: "Sample vendor detail file", city: "Sample City", clientName: "Sample borrower", side: "buyer", contractPrice: 0 });
let file = await api.getTransactionWorkspace(created.id), directory = await api.getBrokerageVendors();
// A fixture route uses a public alias; detail ownership must match the workspace
// DTO so the dialog can accept its loaded record just as it does for new IDs.
const aliasFile = await choose("sample-diligence", "inspector", directory.items.find(vendor => vendor.approved && vendor.categories.includes("inspector")));
const aliasDetail = await api.getTransactionVendorDetail(aliasFile.transaction.id, aliasFile.vendors.find(row => row.role === "inspector").detailId);
assert.equal(aliasDetail.transactionId, aliasFile.transaction.id);
let lender = directory.items.find(vendor => vendor.approved && vendor.categories.includes("mortgage")); assert(lender);
file = await choose(created.id, "mortgage", lender); const firstId = file.vendors.find(row => row.role === "mortgage").detailId; assert(firstId);
let detail = await api.getTransactionVendorDetail(created.id, firstId);
assert.equal(detail.id, firstId); assert.equal(detail.transactionId, created.id); assert.equal(detail.vendorId, lender.id); assert.equal(detail.role, "mortgage");
assert.equal(detail.isCurrent, true); assert.equal(detail.canEdit, true); assert.equal(detail.attachmentUploadsEnabled, true); assert.deepEqual(detail.details, DEFAULT_VENDOR_DETAIL_FIELDS); assert.deepEqual(detail.attachments, []);
assert.deepEqual(vendorMonthlyBreakdown(detail.details), { subtotalCents: null, entered: 0, total: 6, complete: false, differenceCents: null });
assert.equal((await api.getTransactionVendorDetails(created.id, "mortgage")).total, 1); groups++;

// Manual entered cents/rates survive unchanged; no mortgage payment is generated.
const entered = Object.freeze(patch(detail, { serviceDate: "2026-11-06", serviceStatus: "scheduled", costCents: 185050, reference: "Sample lender reference", notes: "Sample private lender conditions <script>not executable</script>", quoteDate: "2026-11-02", preApprovalAmountCents: 55000000, preApprovalIssuedDate: "2026-11-01", preApprovalExpiryDate: "2027-01-30", loanAmountCents: 47500000, loanType: "Conventional", rateType: "fixed", interestRatePercent: "6.125", aprPercent: "6.2375", termMonths: 360, rateLockExpiryDate: "2026-12-01", estimatedClosingCostsCents: 1234567, estimatedCashToCloseCents: 6345678 }));
detail = await api.updateTransactionVendorDetail(created.id, firstId, entered);
assert.equal(detail.details.costCents, 185050); assert.equal(detail.details.interestRatePercent, "6.125"); assert.equal(detail.details.aprPercent, "6.2375"); assert.equal(detail.details.serviceDate, "2026-11-06"); assert(detail.details.notes.includes("<script>not executable</script>"));
assert.equal(detail.details.monthlyPrincipalInterestCents, null); assert.equal(vendorMonthlyBreakdown(detail.details).subtotalCents, null); assert.notEqual(detail.updatedAt, entered.expectedDetailUpdatedAt); assert.notEqual(detail.transactionUpdatedAt, entered.expectedUpdatedAt);
const summaryAfterEdit=(await api.getTransactionWorkspace(created.id)).vendors.find(row=>row.role==="mortgage").detailSummary;assert.equal(summaryAfterEdit.details.loanAmountCents,47500000);assert.equal(summaryAfterEdit.details.interestRatePercent,"6.125");assert.equal(summaryAfterEdit.attachmentCount,0);assert.equal(summaryAfterEdit.hasNotes,true);assert.equal("notes" in summaryAfterEdit.details,false);groups++;
const revisionAfterEdit = detail.updatedAt, historyAfterEdit = (await api.getTransactionWorkspace(created.id)).history.total;
assert.equal((await api.updateTransactionVendorDetail(created.id, firstId, entered)).updatedAt, revisionAfterEdit); assert.equal((await api.getTransactionWorkspace(created.id)).history.total, historyAfterEdit);
await refused(() => api.updateTransactionVendorDetail(created.id, firstId, { ...entered, details: { ...entered.details, notes: "Changed after receipt" } }), 409, "request_conflict");
await refused(() => api.updateTransactionVendorDetail(created.id, firstId, { ...entered, requestId: crypto.randomUUID() }), 409, "conflict"); groups++;

detail = await api.updateTransactionVendorDetail(created.id, firstId, patch(detail, { costCents: 0, interestRatePercent: "6.1250", monthlyPrincipalInterestCents: 288615, monthlyPropertyTaxCents: 52000, lenderMonthlyTotalCents: 403115 }));
assert.equal(detail.details.costCents, 0); assert.equal(detail.details.interestRatePercent, "6.1250"); assert.deepEqual(vendorMonthlyBreakdown(detail.details), { subtotalCents: 340615, entered: 2, total: 6, complete: false, differenceCents: null });
detail = await api.updateTransactionVendorDetail(created.id, firstId, patch(detail, { monthlyHomeInsuranceCents: 22500, monthlyMortgageInsuranceCents: 0, monthlyHoaCents: 40000, monthlyOtherCents: 0 }));
assert.deepEqual(vendorMonthlyBreakdown(detail.details), { subtotalCents: 403115, entered: 6, total: 6, complete: true, differenceCents: 0 });
detail = await api.updateTransactionVendorDetail(created.id, firstId, patch(detail, { lenderMonthlyTotalCents: 403116, costCents: null }));
assert.equal(detail.details.costCents, null); assert.equal(vendorMonthlyBreakdown(detail.details).differenceCents, -1);
for (const extra of [{ serviceDate: "2026-02-30" }, { costCents: 10.5 }, { loanAmountCents: -1 }, { interestRatePercent: "6.12345" }, { aprPercent: "100.0001" }, { termMonths: 0 }]) await refused(() => api.updateTransactionVendorDetail(created.id, firstId, patch(detail, extra)), 400, "invalid_vendor_details");
await refused(() => api.updateTransactionVendorDetail(created.id, firstId, { ...patch(detail), vendorName: "Forged provider identity" }), 400, "invalid_vendor_details"); groups++;

// A non-financing role cannot receive another lender's financial fields.
const inspector = directory.items.find(vendor => vendor.approved && vendor.categories.includes("inspector")); file = await choose(created.id, "inspector", inspector);
const inspectorId = file.vendors.find(row => row.role === "inspector").detailId; let inspection = await api.getTransactionVendorDetail(created.id, inspectorId);
inspection = await api.updateTransactionVendorDetail(created.id, inspectorId, patch(inspection, { serviceDate: "2026-11-07", serviceStatus: "scheduled", costCents: 50000, notes: "Sample inspection scope" }));
assert.equal(inspection.details.costCents, 50000); await refused(() => api.updateTransactionVendorDetail(created.id, inspectorId, patch(inspection, { preApprovalAmountCents: 55000000 })), 400, "invalid_vendor_details");
assert.deepEqual((await api.getTransactionVendorDetails(created.id, "inspector")).items.map(row => row.id), [inspectorId]); groups++;

detail = await api.getTransactionVendorDetail(created.id, firstId); const uploadInput = Object.freeze({ ...detailInput(detail), kind: "pre_approval" });
const uploadStart = calls.length; detail = await api.uploadTransactionVendorFile(created.id, firstId, uploadInput, pdf);
const report = detail.attachments[0], multipart = calls.slice(uploadStart).find(call => call.method === "POST");
assert(multipart.body instanceof FormData); assert.equal(multipart.body.get("kind"), "pre_approval"); assert.equal(multipart.headers["Content-Type"], undefined);
assert.equal(report.detailId, firstId); assert.equal(report.kind, "pre_approval"); assert.equal(report.filename, "Sample preapproval.pdf"); assert.equal(report.contentType, "application/pdf"); assert.equal(report.sizeBytes, pdfBytes.length);
assert(!JSON.stringify(report).includes("storagePath")); assert(!JSON.stringify(report).includes("sha256"));
assert.equal((await api.getTransactionWorkspace(created.id)).vendors.find(row=>row.role==="mortgage").detailSummary.attachmentCount,1);groups++;
const uploadedRevision = detail.updatedAt; assert.equal((await api.uploadTransactionVendorFile(created.id, firstId, uploadInput, pdf)).updatedAt, uploadedRevision); assert.equal((await api.getTransactionVendorDetail(created.id, firstId)).attachments.length, 1);
const downloaded = await api.downloadTransactionVendorFile(created.id, report.id); assert.equal(downloaded.type, "application/pdf"); assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), pdfBytes);
const downloadResponse = responses.findLast(response => response.path.endsWith(`/vendor-attachments/${report.id}`)); assert.equal(downloadResponse.headers.get("Cache-Control"), "private, no-store"); assert.equal(downloadResponse.headers.get("X-Content-Type-Options"), "nosniff"); groups++;

await refused(() => api.uploadTransactionVendorFile(created.id, firstId, { ...detailInput(detail), kind: "pre_approval" }, new File(["<html>not a PDF</html>"], "fake.pdf", { type: "application/pdf" })), 400, "invalid_attachment");
await refused(() => api.uploadTransactionVendorFile(created.id, firstId, { ...detailInput(detail), kind: "report" }, new File([new Uint8Array(MAX_TRANSACTION_ATTACHMENT_BYTES + 1)], "large.pdf")), 413, "file_too_large");
await refused(() => api.uploadTransactionVendorFile(created.id, firstId, { ...detailInput(detail), kind: "arbitrary-kind" }, pdf), 400, "invalid_vendor_details");
const badForm = new FormData(); badForm.append("file", pdf); badForm.append("requestId", crypto.randomUUID()); badForm.append("requestId", crypto.randomUUID()); badForm.append("expectedUpdatedAt", detail.transactionUpdatedAt); badForm.append("expectedDetailUpdatedAt", detail.updatedAt); badForm.append("kind", "report");
assert.equal((await fetch(`/api/transactions/${created.id}/vendor-details/${firstId}/attachments`, { method: "POST", body: badForm })).status, 400); groups++;

// Writes are never automatically retried; exact UUID recovery resolves an already committed result.
const originalTransport = window.fetch; let lose = true;
window.fetch = async (input, init = {}) => { const response = await originalTransport(input, init); if (lose && init.method === "PATCH" && String(input).endsWith(`/vendor-details/${firstId}`) && response.ok) { lose = false; throw new TypeError("Synthetic lost detail reply after commit"); } return response; };
const lost = Object.freeze(patch(detail, { notes: "Sample recovered lender conditions" })), lostStart = calls.length;
await assert.rejects(() => api.updateTransactionVendorDetail(created.id, firstId, lost), TypeError); assert.equal(calls.slice(lostStart).filter(call => call.method === "PATCH").length, 1);
detail = await api.updateTransactionVendorDetail(created.id, firstId, lost); assert.equal(detail.details.notes, "Sample recovered lender conditions"); window.fetch = originalTransport;
let loseUpload = true; const lostUpload = Object.freeze({ ...detailInput(detail), kind: "loan_estimate" });
window.fetch = async (input, init = {}) => { const response = await originalTransport(input, init); if (loseUpload && init.method === "POST" && String(input).endsWith(`/vendor-details/${firstId}/attachments`) && response.ok) { loseUpload = false; throw new TypeError("Synthetic lost lender file reply after commit"); } return response; };
const lostUploadStart = calls.length; await assert.rejects(() => api.uploadTransactionVendorFile(created.id, firstId, lostUpload, pdf), TypeError); assert.equal(calls.slice(lostUploadStart).filter(call => call.method === "POST").length, 1);
detail = await api.uploadTransactionVendorFile(created.id, firstId, lostUpload, pdf); assert.equal(detail.attachments.length, 2); window.fetch = originalTransport; groups++;

const concurrentBase = detail, raced = await Promise.allSettled([api.updateTransactionVendorDetail(created.id, firstId, patch(concurrentBase, { reference: "Sample editor one" })), api.updateTransactionVendorDetail(created.id, firstId, patch(concurrentBase, { reference: "Sample editor two" }))]);
assert.equal(raced.filter(result => result.status === "fulfilled").length, 1); assert.equal(raced.filter(result => result.status === "rejected" && result.reason.code === "conflict").length, 1);
detail = await api.getTransactionVendorDetail(created.id, firstId);
await refused(() => api.updateTransactionVendorDetail(created.id, firstId, { ...patch(detail), expectedDetailUpdatedAt: entered.expectedDetailUpdatedAt }), 409, "conflict"); groups++;

// Directory revisions and retirement cannot silently change an engagement's captured identity.
const oldIdentity = detail.vendorName;
lender = await api.updateBrokerageVendor(lender.id, { requestId: crypto.randomUUID(), expectedUpdatedAt: lender.updatedAt, vendor: vendorFields(lender, { name: "Sample renamed lender", email: "renamed-lender@example.test" }) });
file = await choose(created.id, "mortgage", lender); assert.equal(file.vendors.find(row => row.role === "mortgage").detailId, firstId); assert.equal(file.vendors.find(row => row.role === "mortgage").vendorName, oldIdentity);
detail = await api.getTransactionVendorDetail(created.id, firstId); assert.equal(detail.vendorName, oldIdentity); assert.equal(detail.attachments.length, 2); assert.equal(detail.details.preApprovalAmountCents, 55000000);
lender = await api.updateBrokerageVendor(lender.id, { requestId: crypto.randomUUID(), expectedUpdatedAt: lender.updatedAt, vendor: vendorFields(lender, { approved: false }) });
file = await api.getTransactionWorkspace(created.id); assert.equal(file.vendors.find(row => row.role === "mortgage").approved, false); assert.equal(file.vendors.find(row => row.role === "mortgage").detailId, firstId);
detail = await api.getTransactionVendorDetail(created.id, firstId); assert.equal(detail.isCurrent, true); assert.equal(detail.vendorName, oldIdentity); assert.deepEqual(new Uint8Array(await (await api.downloadTransactionVendorFile(created.id, report.id)).arrayBuffer()), pdfBytes); groups++;

const replacement = await api.createBrokerageVendor({ requestId: crypto.randomUUID(), vendor: { name: "Sample replacement lender", company: null, email: null, phone: null, categories: ["mortgage"], approved: true } });
file = await choose(created.id, "mortgage", replacement); const replacementId = file.vendors.find(row => row.role === "mortgage").detailId; assert.notEqual(replacementId, firstId);
let replacementDetail = await api.getTransactionVendorDetail(created.id, replacementId); assert.deepEqual(replacementDetail.details, DEFAULT_VENDOR_DETAIL_FIELDS); assert.deepEqual(replacementDetail.attachments, []);
detail = await api.getTransactionVendorDetail(created.id, firstId); assert.equal(detail.isCurrent, false); assert.equal(detail.canEdit, false); assert.equal(detail.attachments.length, 2); assert.equal(detail.details.loanAmountCents, 47500000);
await refused(() => api.updateTransactionVendorDetail(created.id, firstId, patch(detail, { notes: "Must not modify historical provider" })), 409, "vendor_detail_not_current");
await refused(() => api.uploadTransactionVendorFile(created.id, firstId, { ...detailInput(detail), kind: "report" }, pdf), 409, "vendor_detail_not_current");
await refused(() => api.removeTransactionVendorFile(created.id, report.id, { ...detailInput(detail), detailId: firstId, expectedAttachmentUpdatedAt: report.updatedAt }), 409, "vendor_detail_not_current");
const history = await api.getTransactionVendorDetails(created.id, "mortgage"); assert.equal(history.total, 2); assert.equal(history.items.find(row => row.id === firstId).isCurrent, false); assert.equal(history.items.find(row => row.id === replacementId).isCurrent, true); groups++;

file = await choose(created.id, "mortgage", null, "not_needed"); assert.equal(file.vendors.find(row => row.role === "mortgage").detailId, null); assert.equal((await api.getTransactionVendorDetail(created.id, replacementId)).canEdit, false);
file = await choose(created.id, "mortgage", replacement); const reselectedId = file.vendors.find(row => row.role === "mortgage").detailId; assert.notEqual(reselectedId, replacementId); assert.deepEqual((await api.getTransactionVendorDetail(created.id, reselectedId)).details, DEFAULT_VENDOR_DETAIL_FIELDS);
file = await choose(created.id, "mortgage", null, "unset"); assert.equal(file.vendors.find(row => row.role === "mortgage").detailId, null);
file = await choose(created.id, "mortgage", replacement); const currentId = file.vendors.find(row => row.role === "mortgage").detailId; assert.notEqual(currentId, reselectedId); replacementDetail = await api.getTransactionVendorDetail(created.id, currentId); assert.deepEqual(replacementDetail.details, DEFAULT_VENDOR_DETAIL_FIELDS); assert.deepEqual(replacementDetail.attachments, []);
assert.equal((await api.getTransactionVendorDetails(created.id, "mortgage")).total, 4); groups++;

// Ordinary owned-file access, Member read-only access and brokerage boundaries apply to old records too.
SAMPLE_ACTOR.role = "member"; assert.equal((await api.getTransactionVendorDetail(created.id, firstId)).canEdit, false); assert.deepEqual(new Uint8Array(await (await api.downloadTransactionVendorFile(created.id, report.id)).arrayBuffer()), pdfBytes);
await refused(() => api.updateTransactionVendorDetail(created.id, currentId, patch(replacementDetail, { notes: "Member write" })), 403, "forbidden");
await refused(() => api.uploadTransactionVendorFile(created.id, currentId, { ...detailInput(replacementDetail), kind: "report" }, pdf), 403, "forbidden");
SAMPLE_ACTOR.role = "agent"; SAMPLE_ACTOR.userId = SAMPLE_COLLEAGUE_ID;
await refused(() => api.getTransactionVendorDetail(created.id, firstId), 404, "not_found"); await refused(() => api.getTransactionVendorDetails(created.id), 404, "not_found"); await refused(() => api.downloadTransactionVendorFile(created.id, report.id), 404, "not_found");
Object.assign(SAMPLE_ACTOR, actor); await refused(() => api.getTransactionVendorDetail(SAMPLE_FOREIGN_TRANSACTION_ID, firstId), 404, "not_found");
SAMPLE_ACTOR.brokerageKey = "other-brokerage"; await refused(() => api.getTransactionVendorDetail(created.id, firstId), 404, "not_found"); Object.assign(SAMPLE_ACTOR, actor); groups++;

// Active-file soft removal and terminal-file retained downloads have distinct behavior.
replacementDetail = await api.getTransactionVendorDetail(created.id, currentId); replacementDetail = await api.uploadTransactionVendorFile(created.id, currentId, { ...detailInput(replacementDetail), kind: "invoice" }, pdf); const removable = replacementDetail.attachments[0];
const removeInput = Object.freeze({ ...detailInput(replacementDetail), detailId: currentId, expectedAttachmentUpdatedAt: removable.updatedAt });
replacementDetail = await api.removeTransactionVendorFile(created.id, removable.id, removeInput); assert.deepEqual(replacementDetail.attachments, []);
assert.equal((await api.removeTransactionVendorFile(created.id, removable.id, removeInput)).updatedAt, replacementDetail.updatedAt); await refused(() => api.downloadTransactionVendorFile(created.id, removable.id), 404, "not_found");
file = await api.getTransactionWorkspace(created.id); await api.updateTransactionStage(created.id, "cancelled", { requestId: crypto.randomUUID(), expectedUpdatedAt: file.updatedAt,reason:"Synthetic terminal file review" });
replacementDetail = await api.getTransactionVendorDetail(created.id, currentId); assert.equal(replacementDetail.isCurrent, true); assert.equal(replacementDetail.canEdit, false);
await refused(() => api.updateTransactionVendorDetail(created.id, currentId, patch(replacementDetail)), 409, "invalid_transition");
assert.deepEqual(new Uint8Array(await (await api.downloadTransactionVendorFile(created.id, report.id)).arrayBuffer()), pdfBytes); assert.equal((await api.updateTransactionVendorDetail(created.id, firstId, lost)).canEdit, false); groups++;

const finalWorkspace = await api.getTransactionWorkspace(created.id), privateHistory = JSON.stringify(finalWorkspace.history);
assert(!privateHistory.includes("Sample recovered lender conditions")); assert(!privateHistory.includes("Sample preapproval.pdf")); assert(!privateHistory.includes("47500000")); assert(!privateHistory.includes("renamed-lender@example.test"));
assert(calls.every(call => !/Sample preapproval|Sample%20preapproval|lender conditions|renamed-lender@example/.test(call.path)));
assert.equal(JSON.stringify(sampleTransactionBundles), baseline); groups++;
console.log(`PASS: ${groups} isolated vendor detail groups (actual adapters, exact dates/cents/rates/monthly subtotals, multipart reports and pre-approvals, current/historical generations, retired snapshots, CAS/UUID/lost replies, private downloads and Member/terminal/scope rules).`);
