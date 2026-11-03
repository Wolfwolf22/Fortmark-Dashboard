// Real client adapters over isolated, revision-checked transaction checklists.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installPreviewTransport, getPreviewMetrics } from "./fixtures.mjs";
import { sampleTransactionBundles, SAMPLE_FOREIGN_TRANSACTION_ID } from "./transaction-fixtures.mjs";
import { readPreviewTransactionBundles } from "./transaction-model.mjs";
import { SAMPLE_ACTOR, readSampleContact } from "./sample-session.mjs";
import { DEFAULT_TRANSACTION_CHECKLIST, TRANSACTION_CHECKLIST_VERSION, checklistBlockers, checklistMissingStages } from "../../lib/transactions/checklist-domain.ts";
import { useDataVersion } from "../../lib/data/store.ts";

const root = fileURLToPath(new URL("../../", import.meta.url)), output = fileURLToPath(new URL(`./dist/checklist-adapter-test-${process.pid}.mjs`, import.meta.url));
mkdirSync(path.dirname(output), { recursive: true });
const bundle = await build({ stdin: { contents: 'export * from "./lib/data/adapters/transactions.ts"; export * from "./lib/data/adapters/transaction-workspace.ts";', resolveDir: root, sourcefile: "preview-checklist-adapter-entry.ts" }, bundle: true, write: false, platform: "node", format: "esm", tsconfigRaw: { compilerOptions: {} }, plugins: [{ name: "actual-checklist-adapters", setup(builder) {
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
const calls = [];
globalThis.fetch = async (input, init = {}) => { calls.push({ path: String(input), method: init.method || "GET", body: init.body }); return window.fetch(input, init); };
const mode = value => { window.location.search = `?scenario=${value}&view=%2Ftransactions`; };
const refused = (fn, status, code) => assert.rejects(fn, error => error.status === status && (!code || error.code === code));
const mutation = (workspace, item, action = "complete") => ({ requestId: crypto.randomUUID(), expectedUpdatedAt: workspace.updatedAt, itemId: item.id, expectedItemUpdatedAt: item.updatedAt, action });
const advance = (workspace, stage) => api.updateTransactionStage(workspace.transaction.id, stage, { requestId: crypto.randomUUID(), expectedUpdatedAt: workspace.updatedAt,...stage==="closed"?{closeAcknowledgement:{version:"fortmark-close-mock-v1",reviewedToEnd:true,acknowledged:true}}:{},...(["cancelled","fell_through","withdrawn"].includes(stage)?{reason:"Synthetic exit review"}:{}) });
async function completeRequired(workspace, target) {
  for (const item of checklistBlockers(workspace.checklist.items, workspace.transaction.stage, target)) workspace = await api.mutateTransactionChecklist(workspace.transaction.id, mutation(workspace, item));
  return workspace;
}
const base = JSON.stringify(sampleTransactionBundles), contact = structuredClone(readSampleContact("sample-overdue"));
let groups = 0;

const listed = await api.getTransactions();
assert.equal(listed.length, 6);
for (const record of listed) {
  const file = await api.getTransactionWorkspace(record.id);
  assert.equal(file.checklist.templateVersion, TRANSACTION_CHECKLIST_VERSION);
  assert.deepEqual(file.checklist.progress, { completed: 0, required: 12 });
  assert.deepEqual(file.checklist.items.map(({ templateKey, label, stage, required, sortOrder, attachmentRequired }) => ({ templateKey, label, stage, required, sortOrder, attachmentRequired })), DEFAULT_TRANSACTION_CHECKLIST);
  assert(file.checklist.items.every(item => item.completedAt === null));
  assert(!JSON.stringify(file.checklist).includes("completedByUserId"));
}
let offer = await api.getTransactionWorkspace("sample-offer");
await refused(() => api.mutateTransactionChecklist(offer.transaction.id, mutation(offer, offer.checklist.items[0])), 403, "preview_read_only"); groups++;

mode("interactive");
const beforeGate = JSON.stringify(readPreviewTransactionBundles()), gateVersion = useDataVersion.getState().version;
await refused(() => advance(offer, "under_contract"), 409, "checklist_incomplete");
assert.equal(JSON.stringify(readPreviewTransactionBundles()), beforeGate); assert.equal(useDataVersion.getState().version, gateVersion + 1);
assert.deepEqual(checklistMissingStages(offer.checklist.items.filter(item => item.stage !== "opportunity"), "offer", "under_contract"), ["opportunity"]); groups++;

const initialDeadlineFacts = JSON.stringify(offer.deadlines), initialMetrics = JSON.stringify(getPreviewMetrics().transactions.data), activityBefore = JSON.stringify(getPreviewMetrics().activity.data);
const originalItem = offer.checklist.items[0], firstInput = Object.freeze(mutation(offer, originalItem)), firstInputText = JSON.stringify(firstInput);
offer = await api.mutateTransactionChecklist(offer.transaction.id, firstInput);
const completed = offer.checklist.items.find(item => item.id === originalItem.id);
assert(completed.completedAt); assert.notEqual(completed.updatedAt, originalItem.updatedAt); assert.notEqual(offer.updatedAt, firstInput.expectedUpdatedAt);
assert.deepEqual(offer.checklist.progress, { completed: 1, required: 12 }); assert.equal(offer.transaction.stage, "offer");
assert.equal(JSON.stringify(offer.deadlines), initialDeadlineFacts); assert.equal(JSON.stringify(getPreviewMetrics().transactions.data), initialMetrics); assert.equal(JSON.stringify(getPreviewMetrics().activity.data), activityBefore);
assert.equal(JSON.stringify(firstInput), firstInputText);
const taskEvent = offer.history.items.find(item => item.action === "complete_checklist"); assert(taskEvent); assert.deepEqual(taskEvent.fields, ["completedAt"]); assert(!JSON.stringify(taskEvent).includes(completed.label));
assert.equal(readSampleContact("sample-overdue").lastTouchDate, contact.lastTouchDate); assert.deepEqual(readSampleContact("sample-overdue").nextAction, contact.nextAction); groups++;

const repeated = await api.mutateTransactionChecklist(offer.transaction.id, firstInput); assert.equal(repeated.updatedAt, offer.updatedAt); assert.equal(repeated.history.total, offer.history.total);
const stable = JSON.stringify(readPreviewTransactionBundles());
await refused(() => api.mutateTransactionChecklist(offer.transaction.id, { ...firstInput, action: "reopen" }), 409, "request_conflict");
await refused(() => api.mutateTransactionChecklist(offer.transaction.id, { ...firstInput, requestId: crypto.randomUUID() }), 409, "conflict");
await refused(() => api.mutateTransactionChecklist(offer.transaction.id, { ...mutation(offer, completed, "reopen"), expectedItemUpdatedAt: originalItem.updatedAt }), 409, "conflict");
assert.equal(JSON.stringify(readPreviewTransactionBundles()), stable); groups++;

const raceItems = offer.checklist.items.filter(item => !item.completedAt).slice(0, 2), raced = await Promise.allSettled(raceItems.map(item => api.mutateTransactionChecklist(offer.transaction.id, mutation(offer, item))));
assert.equal(raced.filter(result => result.status === "fulfilled").length, 1); assert.equal(raced.filter(result => result.status === "rejected" && result.reason.code === "conflict").length, 1);
offer = await api.getTransactionWorkspace(offer.transaction.id);
const reviewed = offer.checklist.items.find(item => item.id === originalItem.id);
await refused(() => api.mutateTransactionChecklist(offer.transaction.id, mutation(offer, reviewed)), 409, "invalid_checklist_transition");
offer = await api.mutateTransactionChecklist(offer.transaction.id, mutation(offer, reviewed, "reopen"));
const reopened = offer.checklist.items.find(item => item.id === reviewed.id); assert.equal(reopened.completedAt, null);
await refused(() => api.mutateTransactionChecklist(offer.transaction.id, mutation(offer, reopened, "reopen")), 409, "invalid_checklist_transition"); groups++;

const otherFile = await api.getTransactionWorkspace("sample-financing"), beforeInvalid = JSON.stringify(readPreviewTransactionBundles());
await refused(() => api.mutateTransactionChecklist(offer.transaction.id, mutation(offer, otherFile.checklist.items[0])), 404, "not_found");
await refused(() => api.mutateTransactionChecklist(offer.transaction.id, { ...mutation(offer, reopened), itemId: crypto.randomUUID() }), 404, "not_found");
await refused(() => api.mutateTransactionChecklist(offer.transaction.id, { ...mutation(offer, reopened), label: "Injected replacement" }), 400, "invalid_transaction");
await refused(() => api.mutateTransactionChecklist(offer.transaction.id, { ...mutation(offer, reopened), action: "remove" }), 400, "invalid_transaction");
await refused(() => api.mutateTransactionChecklist(SAMPLE_FOREIGN_TRANSACTION_ID, mutation(offer, reopened)), 404, "not_found");
assert.equal(JSON.stringify(readPreviewTransactionBundles()), beforeInvalid); groups++;

offer = await completeRequired(offer, "financing");
assert(offer.checklist.items.filter(item => item.stage === "financing").every(item => item.completedAt === null));
assert.equal(offer.transaction.stage,"financing");
await refused(() => advance(offer, "closing_prep"), 409, "checklist_incomplete");
offer = await completeRequired(offer, "closing_prep"); assert.equal(offer.transaction.stage,"closing_prep");
await refused(() => advance(offer, "closed"), 409, "checklist_incomplete");
offer = await completeRequired(offer, "closed"); assert.deepEqual(offer.checklist.progress, { completed: 12, required: 12 });
await advance(offer, "closed"); offer = await api.getTransactionWorkspace(offer.transaction.id); assert.equal(offer.canEdit, false); assert.equal(offer.deadlines.length, 0);
await refused(() => api.mutateTransactionChecklist(offer.transaction.id, mutation(offer, offer.checklist.items[0], "reopen")), 409, "invalid_transition");
assert.equal((await api.mutateTransactionChecklist(offer.transaction.id, firstInput)).transaction.stage, "closed"); groups++;

let backwards = await api.getTransactionWorkspace("sample-diligence"); await advance(backwards, "under_contract"); backwards = await api.getTransactionWorkspace(backwards.transaction.id);
await advance(backwards, "on_hold"); backwards = await api.getTransactionWorkspace(backwards.transaction.id);
await refused(() => advance(backwards, "closing_prep"), 409, "checklist_incomplete");
await advance(backwards, "opportunity"); backwards = await api.getTransactionWorkspace(backwards.transaction.id);
assert(backwards.checklist.items.every(item => item.completedAt === null)); await advance(backwards, "cancelled");
const cancelled = await api.getTransactionWorkspace(backwards.transaction.id); assert.equal(cancelled.canEdit, false); assert(cancelled.checklist.items.every(item => item.completedAt === null)); groups++;

let paused = await api.getTransactionWorkspace("sample-on-hold"); await refused(() => advance(paused, "offer"), 409, "checklist_incomplete");
paused = await completeRequired(paused, "offer"); await advance(paused, "offer");
assert.equal((await api.getTransactionWorkspace(paused.transaction.id)).checklist.progress.completed, 2); groups++;

const created = await api.createTransaction({ requestId: crypto.randomUUID(), address: "Sample checklist snapshot file", city: "Hollywood", clientName: "Sample review client", side: "buyer", contractPrice: 0 });
const newFile = await api.getTransactionWorkspace(created.id); assert.equal(newFile.transaction.stage, "opportunity");
assert.equal(newFile.checklist.templateVersion, TRANSACTION_CHECKLIST_VERSION); assert.deepEqual(newFile.checklist.progress, { completed: 0, required: 12 }); assert.equal(newFile.deadlines.length, 0);
assert(newFile.checklist.items.every(item => !sampleTransactionBundles.some(bundle => bundle.checklist.some(existing => existing.id === item.id))));
assert.equal(readPreviewTransactionBundles().find(bundle => bundle.row.id === created.id).row.checklistTemplateVersion, TRANSACTION_CHECKLIST_VERSION); groups++;

const actualTransport = window.fetch, lostInput = mutation(newFile, newFile.checklist.items[0]), historyBeforeLost = newFile.history.total; let lose = true;
window.fetch = async (input, init = {}) => { const response = await actualTransport(input, init); if (lose && init.method === "POST" && String(input).endsWith("/checklist") && response.ok) { lose = false; throw new TypeError("Synthetic lost checklist reply after commit"); } return response; };
const lostStart = calls.length; await assert.rejects(() => api.mutateTransactionChecklist(created.id, lostInput), TypeError); assert.equal(calls.slice(lostStart).filter(call => call.method === "POST").length, 1);
const recovered = await api.mutateTransactionChecklist(created.id, lostInput); assert.equal(recovered.history.total, historyBeforeLost + 1); assert.equal(recovered.checklist.progress.completed, 1); window.fetch = actualTransport; groups++;

const role = SAMPLE_ACTOR.role; SAMPLE_ACTOR.role = "member";
try { const readonly = await api.getTransactionWorkspace(created.id); assert.equal(readonly.canEdit, false); await refused(() => api.mutateTransactionChecklist(created.id, mutation(readonly, readonly.checklist.items[1])), 403, "forbidden"); await refused(() => api.mutateTransactionChecklist(created.id, lostInput), 403, "forbidden"); } finally { SAMPLE_ACTOR.role = role; }
mode("conflict"); const opening = await api.getTransactionWorkspace("sample-financing"), kept = Object.freeze(mutation(opening, opening.checklist.items[0])), keptText = JSON.stringify(kept);
await refused(() => api.mutateTransactionChecklist(opening.transaction.id, kept), 409, "conflict"); const remote = await api.getTransactionWorkspace(opening.transaction.id);
assert.notEqual(remote.updatedAt, opening.updatedAt); assert.equal(JSON.stringify(kept), keptText); assert(remote.checklist.items.every(item => item.completedAt === null));
await refused(() => api.mutateTransactionChecklist(remote.transaction.id, mutation(remote, remote.checklist.items[0])), 403, "preview_read_only");
mode("records"); assert.equal((await api.getTransactionWorkspace("sample-offer")).checklist.progress.completed, 0); assert.equal(JSON.stringify(sampleTransactionBundles), base); assert.equal((await api.getTransactions()).length, 6); groups++;

console.log(`PASS: ${groups} isolated transaction checklist groups (pending snapshots, real adapter/HTTP, parent+child CAS, receipts/concurrency, atomic refusals, prior-stage/skip/pause/close gates, independent deadlines/touch/activity, terminal/member scope, create/lost-reply recovery, history privacy and reset).`);
