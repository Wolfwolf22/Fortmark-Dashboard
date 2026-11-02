// Actual production client adapters over the closed synthetic transaction API.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installPreviewTransport, getPreviewMetrics } from "./fixtures.mjs";
import { sampleTransactionBundles, SAMPLE_FOREIGN_TRANSACTION_ID } from "./transaction-fixtures.mjs";
import { readPreviewTransactionBundles, previewContactTransactionParties, previewTransactionActivity } from "./transaction-model.mjs";
import { SAMPLE_ACTOR, readSampleContact } from "./sample-session.mjs";
import { SAMPLE_COLLEAGUE_ID } from "./contact-fixtures.mjs";
import { calendarDayKey, formatTransactionDay, transactionDay } from "../../lib/transactions/calendar-days.ts";
import { useDataVersion } from "../../lib/data/store.ts";
import * as contacts from "./contact-adapters.mjs";
import { DUPLICATE_PRIMARY_ID, DUPLICATE_SOURCE_ID } from "./import-merge-fixtures.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url)), output = fileURLToPath(new URL(`./dist/transaction-adapter-test-${process.pid}.mjs`, import.meta.url));
mkdirSync(path.dirname(output), { recursive: true });
const bundle = await build({ stdin: { contents: 'export * from "./lib/data/adapters/transactions.ts"; export * from "./lib/data/adapters/transaction-workspace.ts";', resolveDir: root, sourcefile: "preview-transaction-adapter-entry.ts" }, bundle: true, write: false, platform: "node", format: "esm", tsconfigRaw: { compilerOptions: {} }, plugins: [{ name: "actual-preview-adapters", setup(builder) {
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
const edit = (workspace, values = {}) => ({ requestId: crypto.randomUUID(), expectedUpdatedAt: workspace.updatedAt, details: { ...workspace.details, ...values } });
const deadline = (workspace, action, child, value) => ({ requestId: crypto.randomUUID(), expectedUpdatedAt: workspace.updatedAt, action, ...(child ? { deadlineId: child.id, expectedDeadlineUpdatedAt: child.updatedAt } : {}), ...(value ? { deadline: value } : {}) });
const nextDay = days => new Date(Date.parse(`${calendarDayKey()}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const base = JSON.stringify(sampleTransactionBundles);
let groups = 0;

assert.equal(await api.getTransactionSource(), "db");
let offer = await api.getTransactionWorkspace("sample-offer"), financing = await api.getTransactionWorkspace("sample-financing");
assert.equal(offer.details.contractExecutionDate, null); assert.equal(offer.transaction.contractDate, undefined); assert.equal(offer.details.closingDate, null); assert.equal(offer.deadlines.length, 0); assert.equal(offer.transaction.statusLabel, "Needs setup");
assert.equal((await api.getTransactions()).length, 6); assert.equal(financing.history.total, 25); assert.equal(financing.history.items.length, 20);
const older = await api.getTransactionWorkspace("sample-financing", { historyPage: 2 }); assert.equal(older.history.items.length, 5); assert.equal(new Set([...older.history.items, ...financing.history.items].map(item => item.id)).size, 25);
await refused(() => api.updateTransactionWorkspace(offer.transaction.id, edit(offer, { notes: "Refused Records write" })), 403);
assert.equal(await api.getTransaction(SAMPLE_FOREIGN_TRANSACTION_ID), undefined); await refused(() => api.getTransactionWorkspace(SAMPLE_FOREIGN_TRANSACTION_ID), 404); groups++;

const today = financing.deadlines.find(item => item.dueDate === calendarDayKey()); assert(today); assert.equal(today.state, "upcoming");
assert.equal(transactionDay(financing.transaction.milestones.find(item => item.id === today.id).date), calendarDayKey());
assert.equal(formatTransactionDay(today.dueDate), formatTransactionDay(`${today.dueDate}T12:00:00Z`));
const todayAttention = getPreviewMetrics().attention.data.items.find(item => item.id === `deadline:${today.id}`); assert(todayAttention); assert.equal(todayAttention.daysAway, 0); assert.equal(todayAttention.kind, "deadline_soon"); groups++;

mode("interactive");
const notes = "  Confirm the revised terms.\n<strong>This stays plain text.</strong>  ", input = Object.freeze(edit(financing, { notes, contractPriceCents: 50000000, commissionRateBps: 275 })), frozen = JSON.stringify(input), version = useDataVersion.getState().version;
financing = await api.updateTransactionWorkspace("sample-financing", input);
assert.equal(financing.details.notes, notes); assert.equal(financing.transaction.contractPrice, 500000); assert.equal(financing.transaction.projectedCommission, 13750); assert.equal(useDataVersion.getState().version, version + 1);
assert.equal(JSON.stringify(input), frozen); assert(!JSON.stringify(financing.history).includes("<strong>"));
assert.equal((await api.getTransactions()).find(row => row.id === "sample-financing").contractPrice, 500000);
assert.equal((await contacts.getLinkedTransactions("sample-upcoming"))[0].stage, financing.transaction.stage); groups++;

const replay = await api.updateTransactionWorkspace("sample-financing", input); assert.equal(replay.updatedAt, financing.updatedAt);
const failVersion = useDataVersion.getState().version, rowBeforeFailure = JSON.stringify(readPreviewTransactionBundles());
await refused(() => api.updateTransactionWorkspace("sample-financing", { ...input, requestId: crypto.randomUUID() }), 409, "conflict");
await refused(() => api.updateTransactionWorkspace("sample-financing", { ...input, details: { ...input.details, notes: "Changed same UUID" } }), 409, "request_conflict");
assert.equal(JSON.stringify(readPreviewTransactionBundles()), rowBeforeFailure); assert.equal(useDataVersion.getState().version, failVersion + 2); groups++;

const afterBeforeRace = await api.getTransactionWorkspace("sample-offer"), race = await Promise.allSettled([api.updateTransactionWorkspace("sample-offer", edit(afterBeforeRace, { notes: "First concurrent edit" })), api.updateTransactionWorkspace("sample-offer", edit(afterBeforeRace, { notes: "Second concurrent edit" }))]);
assert.equal(race.filter(result => result.status === "fulfilled").length, 1); assert.equal(race.filter(result => result.status === "rejected" && result.reason.status === 409).length, 1); groups++;

offer = await api.getTransactionWorkspace("sample-offer"); offer = await api.updateTransactionWorkspace(offer.transaction.id, edit(offer, { closingDate: nextDay(20), commissionFlatCents: 1250000 }));
assert.equal(offer.deadlines.filter(item => item.kind === "closing").length, 1); assert.equal(offer.transaction.projectedCommission, 12500);
const closingId = offer.deadlines[0].id;
offer = await api.updateTransactionWorkspace(offer.transaction.id, edit(offer, { closingDate: nextDay(21) })); assert.equal(offer.deadlines[0].id, closingId); assert.equal(offer.deadlines[0].dueDate, nextDay(21));
offer = await api.mutateTransactionDeadline(offer.transaction.id, deadline(offer, "edit", offer.deadlines[0], { kind: "closing", label: "Closing appointment", dueDate: nextDay(22), note: "Confirm the scheduled date." }));
assert.equal(offer.details.closingDate, nextDay(22)); assert.equal(transactionDay(offer.transaction.closeDate), nextDay(22)); groups++;

const beforeComplete = offer, completeRequest = deadline(offer, "complete", offer.deadlines[0]);
offer = await api.mutateTransactionDeadline(offer.transaction.id, completeRequest); assert.equal(offer.deadlines[0].state, "done"); assert.equal(offer.transaction.stage, "offer");
assert.equal((await api.mutateTransactionDeadline(offer.transaction.id, completeRequest)).deadlines[0].completedAt, offer.deadlines[0].completedAt);
await refused(() => api.mutateTransactionDeadline(offer.transaction.id, deadline(offer, "complete", offer.deadlines[0])), 409, "invalid_deadline_transition");
await refused(() => api.updateTransactionWorkspace(offer.transaction.id, edit(offer, { closingDate: null })), 409, "closing_deadline_conflict");
await refused(() => api.mutateTransactionDeadline(offer.transaction.id, deadline(offer, "remove", offer.deadlines[0])), 409, "closing_deadline_conflict");
assert.equal((await api.getTransactionWorkspace(offer.transaction.id)).details.closingDate, nextDay(22)); groups++;

offer = await api.mutateTransactionDeadline(offer.transaction.id, deadline(offer, "reopen", offer.deadlines[0]));
offer = await api.updateTransactionWorkspace(offer.transaction.id, edit(offer, { closingDate: null })); assert.equal(offer.deadlines.length, 0); assert.equal(offer.transaction.closeDate, undefined);
const rawOffer = readPreviewTransactionBundles().find(item => item.row.id.endsWith("000001")); assert(rawOffer.deadlines.find(item => item.id === closingId).removedAt); groups++;

financing = await api.getTransactionWorkspace("sample-financing");
const missingChild = { ...deadline(financing, "complete", financing.deadlines[0]), deadlineId: crypto.randomUUID() }, badCalendar = deadline(financing, "add", null, { kind: "other", label: "Impossible day", dueDate: "2026-02-31", note: "" });
const atomicBefore = JSON.stringify(readPreviewTransactionBundles());
await refused(() => api.mutateTransactionDeadline(financing.transaction.id, missingChild), 404); await refused(() => api.mutateTransactionDeadline(financing.transaction.id, badCalendar), 400, "invalid_transaction");
await refused(() => api.mutateTransactionDeadline(financing.transaction.id, { ...deadline(financing, "complete", financing.deadlines[0]), expectedDeadlineUpdatedAt: new Date(Date.parse(financing.deadlines[0].updatedAt) - 1).toISOString() }), 409, "conflict");
const otherFileDeadline = (await api.getTransactionWorkspace("sample-diligence")).deadlines[0];
await refused(() => api.mutateTransactionDeadline(financing.transaction.id, { ...deadline(financing, "complete", financing.deadlines[0]), deadlineId: otherFileDeadline.id, expectedDeadlineUpdatedAt: otherFileDeadline.updatedAt }), 404);
await refused(() => api.updateTransactionWorkspace(financing.transaction.id, { ...edit(financing), details: { ...financing.details, agentUserId: SAMPLE_COLLEAGUE_ID } }), 400);
assert.equal(JSON.stringify(readPreviewTransactionBundles()), atomicBefore); groups++;

const originalToday = financing.deadlines.find(item => item.id === today.id), attentionBefore = getPreviewMetrics().attention.data.items;
financing = await api.mutateTransactionDeadline(financing.transaction.id, deadline(financing, "complete", originalToday));
assert(!getPreviewMetrics().attention.data.items.some(item => item.id === `deadline:${today.id}`));
assert.equal(getPreviewMetrics().transactions.data.projectedCommissionCents, readPreviewTransactionBundles().filter(item => ["opportunity", "offer", "under_contract", "due_diligence", "financing", "closing_prep"].includes(item.row.stage)).reduce((sum, item) => sum + (item.row.commissionFlatCents ?? Math.round((item.row.contractPriceCents || 0) * (item.row.commissionRateBps || 0) / 10000)), 0));
assert(attentionBefore.some(item => item.id === `deadline:${today.id}`)); groups++;

let closing = await api.getTransactionWorkspace("sample-closing"); const untouchedDeadlines = JSON.stringify(closing.deadlines), beforeClose = getPreviewMetrics().transactions.data.activeCount;
const stageInput = Object.freeze({ requestId: crypto.randomUUID(), expectedUpdatedAt: closing.updatedAt }), closed = await api.updateTransactionStage(closing.transaction.id, "closed", stageInput);
closing = await api.getTransactionWorkspace(closing.transaction.id); assert.equal(closed.stage, "closed"); assert.equal(JSON.stringify(closing.deadlines), untouchedDeadlines); assert.equal(closing.canEdit, false);
assert.equal(getPreviewMetrics().transactions.data.activeCount, beforeClose - 1); assert(getPreviewMetrics().activity.data.some(item => item.kind === "transaction_closed"));
assert.equal((await api.updateTransactionStage(closing.transaction.id, "closed", stageInput)).updatedAt, closed.updatedAt);
await refused(() => api.updateTransactionWorkspace(closing.transaction.id, edit(closing)), 409, "invalid_transition"); groups++;

let paused = await api.getTransactionWorkspace("sample-on-hold"); assert(paused.canEdit); paused = await api.updateTransactionWorkspace(paused.transaction.id, edit(paused, { notes: "Updated while paused" }));
const resumed = await api.updateTransactionStage(paused.transaction.id, "offer", { requestId: crypto.randomUUID(), expectedUpdatedAt: paused.updatedAt }); assert.equal(resumed.stage, "offer");
assert.equal(resumed.milestones.length, 0); await refused(() => api.updateTransactionStage(resumed.id, "closed", { requestId: crypto.randomUUID(), expectedUpdatedAt: resumed.updatedAt }), 409, "invalid_transition");
const ready = await api.updateTransactionStage(resumed.id, "closing_prep", { requestId: crypto.randomUUID(), expectedUpdatedAt: resumed.updatedAt });
await api.updateTransactionStage(ready.id, "closed", { requestId: crypto.randomUUID(), expectedUpdatedAt: ready.updatedAt });
const stagedActivity = previewTransactionActivity().filter(item => item.href.endsWith("/sample-on-hold"));
assert.equal(stagedActivity.filter(item => item.kind === "transaction_stage_changed").length, 2); assert.equal(stagedActivity.filter(item => item.kind === "transaction_closed").length, 1); groups++;

const sourceBeforeCreate = readSampleContact("sample-overdue"), countBeforeCreate = (await api.getTransactions()).length, createInput = Object.freeze({ requestId: crypto.randomUUID(), address: "Sample Created File", city: "Fort Lauderdale", clientName: "Ignored forged name", contactId: (await contacts.getEligibleContacts())[0].id, side: "buyer", contractPrice: 250000 });
const [created, repeatedCreate] = await Promise.all([api.createTransaction(createInput), api.createTransaction(createInput)]); assert.equal(created.id, repeatedCreate.id); assert.equal((await api.getTransactions()).length, countBeforeCreate + 1);
const fresh = await api.getTransactionWorkspace(created.id); assert.equal(fresh.transaction.clientName, sourceBeforeCreate.name); assert.equal(fresh.details.contractExecutionDate, null); assert.equal(fresh.details.closingDate, null); assert.equal(fresh.deadlines.length, 0); assert.equal(fresh.details.commissionRateBps, null);
assert.equal(fresh.transaction.stage, "opportunity");
assert.equal(readSampleContact("sample-overdue").lastTouchDate, sourceBeforeCreate.lastTouchDate); assert.deepEqual(readSampleContact("sample-overdue").nextAction, sourceBeforeCreate.nextAction);
assert((await contacts.getLinkedTransactions("sample-overdue")).some(item => item.id === created.id)); groups++;

const beforeInvalidCreate = JSON.stringify(readPreviewTransactionBundles());
await refused(() => api.createTransaction({ ...createInput, requestId: crypto.randomUUID(), contactId: crypto.randomUUID() }), 400, "invalid_contact");
await refused(() => api.createTransaction({ ...createInput, requestId: crypto.randomUUID(), contractPrice: -1 }), 400, "invalid_transaction");
assert.equal(JSON.stringify(readPreviewTransactionBundles()), beforeInvalidCreate); groups++;

const actualTransport = window.fetch, lostInput = { requestId: crypto.randomUUID(), address: "Sample Lost Reply File", city: "Hollywood", clientName: "Sample Manual Client", side: "tenant", contractPrice: 5000 }, beforeLost = (await api.getTransactions()).length;
let lose = true;
window.fetch = async (input, init = {}) => { const response = await actualTransport(input, init); if (lose && init.method === "POST" && String(input).endsWith("/api/transactions") && response.ok) { lose = false; throw new TypeError("Synthetic lost response after commit"); } return response; };
await assert.rejects(() => api.createTransaction(lostInput), TypeError); assert.equal((await api.getTransactions()).length, beforeLost + 1);
const recovered = await api.createTransaction(lostInput); assert.equal(recovered.transactionType, "residential_lease"); assert.equal((await api.getTransactions()).length, beforeLost + 1); window.fetch = actualTransport; groups++;

const role = SAMPLE_ACTOR.role; SAMPLE_ACTOR.role = "member";
try { const readonly = await api.getTransactionWorkspace("sample-offer"); assert.equal(readonly.canEdit, false); await refused(() => api.updateTransactionWorkspace(readonly.transaction.id, edit(readonly)), 403, "forbidden"); await refused(() => api.createTransaction({ ...createInput, requestId: crypto.randomUUID() }), 403, "forbidden"); } finally { SAMPLE_ACTOR.role = role; }
assert.equal((await api.getTransactionWorkspace(SAMPLE_FOREIGN_TRANSACTION_ID).catch(error => error)).status, 404); groups++;

for (const target of ["qualified", "representation"]) { const contact = await contacts.getLead("sample-colleague-contact"); if (contact.stage !== target) await contacts.updateLeadStage(contact.id, target, { expectedStage: contact.stage }); }
const colleagueId = (await contacts.getEligibleContacts()).find(contact => contact.name === "Sample Colleague Contact").id;
const colleagueDeal = await api.createTransaction({ requestId: crypto.randomUUID(), address: "Sample Colleague File", city: "Hollywood", clientName: "", contactId: colleagueId, side: "buyer", contractPrice: 100000 });
assert.equal(colleagueDeal.agentId, SAMPLE_COLLEAGUE_ID);
SAMPLE_ACTOR.role = "broker";
try { const brokerRead = await api.getTransactionWorkspace(colleagueDeal.id); assert(brokerRead.canEdit); assert(brokerRead.parties.every(party => party.contactId === null && !party.canOpenContact)); } finally { SAMPLE_ACTOR.role = role; }
SAMPLE_ACTOR.role = "agent";
try { assert(!(await api.getTransactions()).some(row => row.id === colleagueDeal.id)); await refused(() => api.getTransactionWorkspace(colleagueDeal.id), 404); assert.equal(getPreviewMetrics().scope, "own"); assert.deepEqual(getPreviewMetrics().leaderboard.data, []); } finally { SAMPLE_ACTOR.role = role; }
groups++;

for (const target of ["qualified", "representation"]) { const contact = await contacts.getLead(DUPLICATE_SOURCE_ID); if (contact.stage !== target) await contacts.updateLeadStage(contact.id, target, { expectedStage: contact.stage }); }
const mergeReview = await contacts.getContactMergeReview(DUPLICATE_PRIMARY_ID, DUPLICATE_SOURCE_ID), mergeInput = value => ({ requestId: crypto.randomUUID(), primaryId: DUPLICATE_PRIMARY_ID, duplicateId: DUPLICATE_SOURCE_ID, expectedPrimaryUpdatedAt: value.primary.updatedAt, expectedDuplicateUpdatedAt: value.duplicate.updatedAt, expectedPrimaryHistoryFingerprint: value.primary.historyFingerprint, expectedDuplicateHistoryFingerprint: value.duplicate.historyFingerprint, choices: value.defaults, nextActionChoice: "primary" });
const mergeDeal = await api.createTransaction({ requestId: crypto.randomUUID(), address: "Sample Canonical Contact File", city: "Hollywood", clientName: "", contactId: DUPLICATE_SOURCE_ID, side: "buyer", contractPrice: 125000 });
await refused(() => contacts.mergeContacts(mergeInput(mergeReview)), 409);
await contacts.mergeContacts(mergeInput(await contacts.getContactMergeReview(DUPLICATE_PRIMARY_ID, DUPLICATE_SOURCE_ID)));
assert((await api.getTransactionWorkspace(mergeDeal.id)).parties.some(party => party.contactId === DUPLICATE_PRIMARY_ID)); assert.equal(previewContactTransactionParties(DUPLICATE_SOURCE_ID).length, 0); groups++;

const searchStart = calls.length; assert((await api.getTransactions({ query: "Sample Created File" })).some(item => item.id === created.id));
const searchCalls = calls.slice(searchStart); assert(searchCalls.some(call => call.path.endsWith("/search") && call.method === "POST")); assert(searchCalls.every(call => !call.path.includes("Created")));
assert.equal((await window.fetch("https://example.com/api/transactions")).status, 403); groups++;

mode("conflict"); const opening = await api.getTransactionWorkspace("sample-offer"), kept = Object.freeze(edit(opening, { notes: "Kept conflict draft" })), beforeKept = JSON.stringify(kept);
await refused(() => api.updateTransactionWorkspace("sample-offer", kept), 409, "conflict"); const newer = await api.getTransactionWorkspace("sample-offer"); assert.notEqual(newer.updatedAt, opening.updatedAt); assert.notEqual(newer.details.notes, kept.details.notes); assert.equal(JSON.stringify(kept), beforeKept);
await refused(() => api.updateTransactionWorkspace("sample-offer", edit(newer, { notes: kept.details.notes })), 403); groups++;

mode("records"); assert.equal((await api.getTransactions()).length, 6); assert.equal((await api.getTransactionWorkspace("sample-offer")).details.contractExecutionDate, null); assert.equal(JSON.stringify(sampleTransactionBundles), base);
console.log(`PASS: ${groups} isolated transaction groups (actual adapter/HTTP DTOs, raw calendar/cents, metadata/deadline CAS and receipts, atomic refusal, closing consistency, stage lifecycle, no invented completions, create/recovery, scope/history/privacy, Home/contact/merge agreement and reset).`);
