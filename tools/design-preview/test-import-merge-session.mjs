// Run: node --experimental-strip-types --no-warnings tools/design-preview/test-import-merge-session.mjs
// Isolated synthetic import/merge; no real transport or account data.
import assert from "node:assert/strict";
import * as api from "./contact-adapters.mjs";
import { sampleImportCsv, allPreviewContacts, duplicateContacts, duplicateNotes, duplicateNeeds, duplicateTimeline, duplicateOpportunities, DUPLICATE_PRIMARY_ID as primaryId, DUPLICATE_SOURCE_ID as duplicateId, DUPLICATE_DECOY_ID as decoyId } from "./import-merge-fixtures.mjs";
import { parseContactCsv, suggestImportMapping, mapImportRows } from "../../lib/contacts/import.ts";
import { getPreviewMetrics, installPreviewTransport } from "./fixtures.mjs";
import { readSampleRawContacts, readSampleNotes, readSampleNeeds, readSampleTimeline, readSampleActivities, readSampleOpportunities, readSampleTransactionIds } from "./sample-session.mjs";
import { useDataVersion } from "../../lib/data/store.ts";

globalThis.window = Object.assign(new EventTarget(), { location: { search: "?scenario=records", origin: "http://127.0.0.1:4173" } });
const mode = value => { window.location.search = `?scenario=${value}`; };
const denied = (fn, status) => assert.rejects(fn, error => error.status === status);
const immutable = () => JSON.stringify({ allPreviewContacts, duplicateContacts, duplicateNotes, duplicateNeeds, duplicateTimeline, duplicateOpportunities });
const original = immutable();
const csv = parseContactCsv(sampleImportCsv); assert(csv.ok);
const rows = mapImportRows(csv, suggestImportMapping(csv.headers));
let groups = 0;
function mergeInput(review, overrides = {}) { return { requestId: crypto.randomUUID(), primaryId: review.primary.id, duplicateId: review.duplicate.id, expectedPrimaryUpdatedAt: review.primary.updatedAt, expectedDuplicateUpdatedAt: review.duplicate.updatedAt, expectedPrimaryHistoryFingerprint: review.primary.historyFingerprint, expectedDuplicateHistoryFingerprint: review.duplicate.historyFingerprint, choices: { ...review.defaults }, nextActionChoice: "duplicate", ...overrides }; }
function commitRows(preview) { return preview.rows.map(row => ({ rowNumber: row.rowNumber, values: row.values, reviewFingerprint: row.reviewFingerprint, decision: "skip" })); }

let review = await api.getContactMergeReview(primaryId, duplicateId);
await denied(() => api.mergeContacts(mergeInput(review)), 403);
await denied(() => api.commitContactImport({ requestId: crypto.randomUUID(), rows: [] }), 403);
const suggestions = await api.getContactDuplicates();
assert.equal(suggestions.pairs.length, 1);
assert.equal(suggestions.pairs[0].primary.id, primaryId);
assert.equal(suggestions.pairs[0].duplicate.id, duplicateId);
assert(suggestions.pairs[0].reasons.includes("email"));
assert(!JSON.stringify(suggestions).includes(decoyId));
assert.equal(suggestions.hasMore, false);
assert.equal(suggestions.scannedContacts, suggestions.totalContacts);
await denied(() => api.getContactMergeReview(primaryId, decoyId), 404);
await denied(() => api.getContactDuplicates("invalid"), 400); groups++;

const preview = await api.previewContactImport({ rows });
assert.deepEqual(preview.counts, { total: 5, valid: 4, invalid: 1, matched: 4 });
assert.deepEqual(preview.rows.find(row => row.rowNumber === 2).fileDuplicates, [4]);
assert.deepEqual(preview.rows.find(row => row.rowNumber === 4).fileDuplicates, [2]);
assert.equal(preview.rows.find(row => row.rowNumber === 3).candidates[0].contact.id, duplicateId);
assert.equal(preview.rows.find(row => row.rowNumber === 6).candidates.length, 2);
assert(!JSON.stringify(preview).includes(decoyId));
assert(preview.rows.every(row => /^[a-f0-9]{64}$/.test(row.reviewFingerprint)));
assert.equal((await api.getLeadsPage({})).total, allPreviewContacts.length); groups++;

mode("interactive");
const before = await api.getLead(duplicateId), beforeTotal = (await api.getLeadSnapshot()).total;
const selected = commitRows(preview);
Object.assign(selected[0], { decision: "add", createSeparate: true });
Object.assign(selected[1], { decision: "update", targetId: duplicateId, expectedUpdatedAt: before.updatedAt });
const batch = { requestId: crypto.randomUUID(), rows: selected };
const version = useDataVersion.getState().version;
const imported = await api.commitContactImport(batch);
assert.deepEqual(imported.counts, { added: 1, updated: 1, skipped: 3 });
assert.equal(useDataVersion.getState().version, version + 1);
assert.equal((await api.getLeadSnapshot()).total, beforeTotal + 1);
const createdId = imported.rows.find(row => row.status === "added").contactId;
const created = await api.getLead(createdId), updated = await api.getLead(duplicateId);
assert.equal(created.lastTouchDate, undefined);
assert.equal(created.lastContactDate, created.createdDate);
assert.equal(readSampleNotes(createdId)[0].body, "Synthetic new contact row");
assert.equal(updated.editable.company, "Sample Updated Company");
assert.equal(updated.email, before.email); // blank CSV email never clears it
assert.equal(updated.lastTouchDate, before.lastTouchDate);
assert.equal(updated.lastContactDate, before.lastContactDate);
assert.equal(readSampleNotes(duplicateId).length, duplicateNotes[duplicateId].length + 1);
assert.equal(updated.notes, before.notes); // imported notes append to structured notes
assert(getPreviewMetrics().activity.data.some(item => item.kind === "contact_created" && item.subject === created.name)); groups++;

const savedVersion = useDataVersion.getState().version, savedCount = (await api.getLeadSnapshot()).total;
const replays = await Promise.all([api.commitContactImport(batch), api.commitContactImport(batch)]);
assert.deepEqual(replays[0], imported); assert.deepEqual(replays[1], imported);
assert.equal((await api.getLeadSnapshot()).total, savedCount);
assert.equal(useDataVersion.getState().version, savedVersion);
await denied(() => api.commitContactImport({ ...batch, rows: batch.rows.map((row, index) => index === 0 ? { ...row, decision: "skip", createSeparate: undefined } : row) }), 409);
assert.equal(readSampleNotes(duplicateId).length, duplicateNotes[duplicateId].length + 1); groups++;

// A later contact revision refuses the entire proposed batch, including an add.
const staleRows = [{ rowNumber: 10, values: { firstName: "Sample", lastName: "Atomic Add", email: "sample.atomic@example.com" } }, { rowNumber: 11, values: { email: created.email, company: "Synthetic stale update" } }];
const stalePreview = await api.previewContactImport({ rows: staleRows });
const staleCommands = commitRows(stalePreview);
staleCommands[0].decision = "add";
Object.assign(staleCommands[1], { decision: "update", targetId: createdId, expectedUpdatedAt: created.updatedAt });
await api.updateContact(createdId, { about: "Synthetic newer saved version", expectedUpdatedAt: created.updatedAt });
await denied(() => api.commitContactImport({ requestId: crypto.randomUUID(), rows: staleCommands }), 409);
assert.equal((await api.getLeadSnapshot()).total, savedCount);
assert(!(await api.getLeadsPage({ q: "sample.atomic@example.com" })).items.length); groups++;

// Child content can change without advancing the contact revision; review detects it.
review = await api.getContactMergeReview(primaryId, duplicateId);
const staleMerge = mergeInput(review), kept = JSON.stringify(staleMerge);
await api.updateNeed(primaryId, readSampleNeeds(primaryId)[0].id, { additionalRequirements: "Synthetic newer child requirement" });
assert.equal((await api.getLead(primaryId)).updatedAt, review.primary.updatedAt);
await denied(() => api.mergeContacts(staleMerge), 409);
assert.equal(JSON.stringify(staleMerge), kept);
assert.equal((await api.getLead(duplicateId)).id, duplicateId);
assert.equal((await api.getLeadSnapshot()).total, savedCount); groups++;

review = await api.getContactMergeReview(primaryId, duplicateId);
const pNotes = readSampleNotes(primaryId), dNotes = readSampleNotes(duplicateId);
const pNeeds = readSampleNeeds(primaryId), dNeeds = readSampleNeeds(duplicateId);
const pHistory = readSampleTimeline(primaryId), dHistory = readSampleTimeline(duplicateId);
const pOpportunities = readSampleOpportunities(primaryId), dOpportunities = readSampleOpportunities(duplicateId);
const transactionIds = new Set([...readSampleTransactionIds(primaryId), ...readSampleTransactionIds(duplicateId)]);
const primaryBefore = await api.getLead(primaryId), duplicateBefore = await api.getLead(duplicateId);
const request = mergeInput(review, { choices: { ...review.defaults, company: "duplicate", about: "duplicate", legacyNotes: "primary" } });
const [merged, concurrentMerge] = await Promise.all([api.mergeContacts(request), api.mergeContacts(request)]);
assert.deepEqual(concurrentMerge, merged);
assert.equal(merged.primary.id, primaryId);
assert.equal(merged.mergedContactId, duplicateId);
assert.equal(merged.primary.editable.company, duplicateBefore.editable.company);
assert.equal(merged.primary.about, duplicateBefore.about);
assert.equal(merged.primary.nextAction.id, duplicateBefore.nextAction.id);
assert.equal(merged.primary.lastTouchDate, [primaryBefore.lastTouchDate, duplicateBefore.lastTouchDate].sort().at(-1));
assert.notEqual(merged.primary.lastTouchDate, merged.primary.updatedAt);
assert.equal(merged.primary.createdDate, [primaryBefore.createdDate, duplicateBefore.createdDate].sort()[0]);
assert.equal((await api.getLeadSnapshot()).total, savedCount - 1);
assert.equal((await api.getLead(duplicateId)).id, primaryId);
const tombstone = readSampleRawContacts().find(contact => contact.id === duplicateId);
assert.equal(tombstone.stage, "archived"); assert.equal(tombstone.mergedIntoContactId, primaryId);
assert.equal(tombstone.nextAction, null);
await denied(() => api.updateContact(duplicateId, { about: "Should not write an old identity", expectedUpdatedAt: tombstone.updatedAt }), 409);
assert(!(await api.getContactDuplicates()).pairs.some(pair => pair.primary.id === duplicateId || pair.duplicate.id === duplicateId)); groups++;

for (const item of [...pNotes, ...dNotes]) assert(readSampleNotes(primaryId).some(current => current.id === item.id));
for (const item of [...pNeeds, ...dNeeds]) assert(readSampleNeeds(primaryId).some(current => current.id === item.id));
for (const item of [...pHistory, ...dHistory]) assert(readSampleTimeline(primaryId).some(current => current.id === item.id));
for (const item of [...pOpportunities, ...dOpportunities]) assert(readSampleOpportunities(primaryId).some(current => current.id === item.id));
assert(readSampleNotes(primaryId).some(note => note.body === duplicateBefore.notes));
assert.equal(readSampleNotes(duplicateId).length, 0);
assert.equal(readSampleNeeds(duplicateId).length, 0);
assert.equal(readSampleActivities(duplicateId).length, 0);
assert.equal(readSampleOpportunities(duplicateId).length, 0);
assert.equal(readSampleTransactionIds(duplicateId).length, 0);
assert.deepEqual(new Set((await api.getLinkedTransactions(primaryId)).map(deal => deal.id)), transactionIds);
assert.deepEqual(merged.preservedCounts, review.preservedCounts);
assert(readSampleTimeline(primaryId).some(item => item.title === "Next action cancelled" && item.detail.includes("Not selected during the reviewed contact merge.")));
assert(getPreviewMetrics().activity.data.some(item => item.summary === "Contact files merged" && item.kind === "contact_task"));
assert.equal(getPreviewMetrics().contacts.data.activeClients, (await api.getLeadsPage({ stage: ["representation", "active_client", "under_contract"] })).total); groups++;

const notesAfterMerge = readSampleNotes(primaryId).length, historyAfterMerge = readSampleTimeline(primaryId).length;
const replayed = await api.mergeContacts(request);
assert.equal(replayed.primary.id, primaryId);
assert.equal(readSampleNotes(primaryId).length, notesAfterMerge);
assert.equal(readSampleTimeline(primaryId).length, historyAfterMerge);
await denied(() => api.mergeContacts({ ...request, nextActionChoice: "none" }), 409);
installPreviewTransport();
assert.equal((await window.fetch("/api/contacts/import", { method: "POST" })).status, 403);
assert.equal((await window.fetch("https://example.invalid/merge", { method: "POST" })).status, 403);
assert.equal(immutable(), original); groups++;

// Advisory names never force a separate-contact override; exact identifiers do.
const advisoryPreview = await api.previewContactImport({ rows: [{ rowNumber: 20, values: { firstName: "Sample", lastName: "Morgan River", email: "sample.advisory.only@example.com", phone: "+12025550199" } }] });
assert.equal(advisoryPreview.rows[0].recommendedDecision, "add");
assert(advisoryPreview.rows[0].candidates.length > 0);
assert(advisoryPreview.rows[0].candidates.every(match => match.reasons.every(reason => reason === "similar_name")));
const advisoryCommands = commitRows(advisoryPreview); advisoryCommands[0].decision = "add";
assert.equal((await api.commitContactImport({ requestId: crypto.randomUUID(), rows: advisoryCommands })).counts.added, 1); groups++;

const latestCreated = await api.getLead(createdId);
const blankPreview = await api.previewContactImport({ rows: [{ rowNumber: 21, values: { email: latestCreated.email, company: "  ", notes: "" } }] });
const blankCommands = commitRows(blankPreview);
Object.assign(blankCommands[0], { decision: "update", targetId: createdId, expectedUpdatedAt: latestCreated.updatedAt });
assert.equal((await api.commitContactImport({ requestId: crypto.randomUUID(), rows: blankCommands })).counts.skipped, 1);
assert.equal((await api.getLead(createdId)).editable.company, latestCreated.editable.company);
assert.equal((await api.getLead(createdId)).updatedAt, latestCreated.updatedAt); groups++;

const crossOwnerPreview = await api.previewContactImport({ rows: [{ rowNumber: 22, values: { email: "sample.morgan@example.com", company: "Should not cross books" } }] });
const crossOwnerCommands = commitRows(crossOwnerPreview);
Object.assign(crossOwnerCommands[0], { decision: "update", targetId: decoyId, expectedUpdatedAt: allPreviewContacts.find(contact => contact.id === decoyId).updatedAt });
await denied(() => api.commitContactImport({ requestId: crypto.randomUUID(), rows: crossOwnerCommands }), 409);
assert.equal((await api.getLead(decoyId)).editable.company, "Sample Other Book"); groups++;

// Older readable fixture URLs remain usable through valid strict-contract IDs.
const older = await api.getLead("sample-due-today");
const aliasPreview = await api.previewContactImport({ rows: [{ rowNumber: 23, values: { email: older.email, company: "Synthetic alias import update" } }] });
const candidate = aliasPreview.rows[0].candidates.find(match => match.reasons.includes("exact_email")).contact;
assert.match(candidate.id, /^[a-f0-9-]{36}$/);
const aliasCommands = commitRows(aliasPreview);
Object.assign(aliasCommands[0], { decision: "update", targetId: candidate.id, expectedUpdatedAt: candidate.updatedAt });
assert.equal((await api.commitContactImport({ requestId: crypto.randomUUID(), rows: aliasCommands })).counts.updated, 1);
assert.equal((await api.getLead(candidate.id)).id, "sample-due-today");
assert.equal((await api.getLead("sample-due-today")).editable.company, "Synthetic alias import update");
assert.equal((await api.getLead("sample-due-today")).lastTouchDate, older.lastTouchDate); groups++;

mode("conflict");
review = await api.getContactMergeReview(primaryId, duplicateId);
const conflict = mergeInput(review), draftCopy = JSON.stringify(conflict);
await denied(() => api.mergeContacts(conflict), 409);
const refreshed = await api.getContactMergeReview(primaryId, duplicateId);
assert.notEqual(refreshed.primary.updatedAt, review.primary.updatedAt);
assert.notEqual(refreshed.primary.values.company, review.primary.values.company);
assert.equal(JSON.stringify(conflict), draftCopy);
await denied(() => api.mergeContacts(mergeInput(refreshed)), 403);
mode("records");
assert.equal((await api.getLeadSnapshot()).total, allPreviewContacts.length);
assert.equal((await api.getLead(duplicateId)).id, duplicateId);
assert.equal(readSampleNotes(duplicateId).length, duplicateNotes[duplicateId].length);
assert.equal((await api.getLead(createdId)), undefined);
assert.equal(immutable(), original);
mode("interactive");
const fresh = await import("./sample-session.mjs?fresh-import-merge-page");
assert.equal(fresh.readSampleContacts().length, allPreviewContacts.length);
assert.equal(fresh.readSampleReceipt("merge", request.requestId), undefined);
assert.equal(fresh.readSampleRawContacts().find(contact => contact.id === duplicateId).mergedIntoContactId, undefined); groups++;

console.log(`PASS: ${groups} isolated import/merge groups (normalized matching, private-book boundary, explicit rows, atomic stale refusal, idempotent receipts, child preservation, canonical pointers, action/legacy-note review, counts/activity, read-only conflict and reset).`);
