// Run: node --experimental-strip-types --no-warnings tools/design-preview/test-named-property-list-session.mjs
// Actual named-list adapter shapes, synthetic memory only; no account/provider.
import assert from "node:assert/strict";
import * as api from "./contact-adapters.mjs";
import { samplePropertyLists, samplePropertyListRows, SAMPLE_PROPERTY_DATASET, SAMPLE_WATERFRONT_LIST_ID as waterfrontId, SAMPLE_INVESTMENT_LIST_ID as investmentId, SAMPLE_PERSONAL_RESEARCH_LIST_ID as researchId, SAMPLE_PERSONAL_EMPTY_LIST_ID as emptyId, SAMPLE_PRIVATE_LIST_ID as privateId } from "./property-fixtures.mjs";
import { DUPLICATE_PRIMARY_ID as primaryId, DUPLICATE_SOURCE_ID as duplicateId, previewPublicRecordId } from "./import-merge-fixtures.mjs";
import { readSampleRawPropertyLists, readSampleListPropertyRows, readSampleDefaultPropertyList, readSampleContactPropertyLists } from "./sample-session.mjs";
import { getPreviewMetrics, installPreviewTransport } from "./fixtures.mjs";
import { useDataVersion } from "../../lib/data/store.ts";

globalThis.window = Object.assign(new EventTarget(), { location: { search: "?scenario=records", origin: "http://127.0.0.1:4173" } });
const mode = value => { window.location.search = `?scenario=${value}`; };
const denied = (fn, status, code) => assert.rejects(fn, error => error.status === status && (!code || error.code === code));
const immutable = () => JSON.stringify({ samplePropertyLists, samplePropertyListRows });
const original = immutable(), dueId = "sample-due-today";
const input = (mlsNumber = "SAMPLE-002", expectedListingId = "sample-courtyard") => ({ mlsNumber, expectedListingId, expectedDataset: SAMPLE_PROPERTY_DATASET });
function mergeInput(review) { return { requestId: crypto.randomUUID(), primaryId, duplicateId, expectedPrimaryUpdatedAt: review.primary.updatedAt, expectedDuplicateUpdatedAt: review.duplicate.updatedAt, expectedPrimaryHistoryFingerprint: review.primary.historyFingerprint, expectedDuplicateHistoryFingerprint: review.duplicate.historyFingerprint, choices: review.defaults, nextActionChoice: "primary" }; }
let groups = 0;

let index = await api.getPropertyLists();
assert.equal(index.total, 9); assert.equal(index.pageSize, 12);
assert.equal(index.items.filter(list => list.contactId === null).length, 3);
assert(!JSON.stringify(index).includes("Sample colleague private research"));
const dueLists = await api.getPropertyLists({ contactId: dueId });
assert.equal(dueLists.total, 3);
assert.deepEqual(new Set(dueLists.items.map(list => list.name)), new Set(["Waterfront options", "Investment research", "Saturday tour"]));
assert.equal((await api.getPropertyList(waterfrontId)).propertyCount, 3);
assert.equal((await api.getPropertyList(investmentId)).propertyCount, 1);
assert.equal((await api.getPropertyList(emptyId)).propertyCount, 0);
const associated = await api.getPropertyList(waterfrontId);
assert.equal(associated.contactId, previewPublicRecordId(dueId));
assert.equal((await api.getLead(associated.contactId)).requestedContactId, associated.contactId);
assert.equal((await api.getPropertyListProperties(researchId)).items[0].contactId, null);
assert.equal((await api.getPropertyListProperties(researchId)).items[0].listId, researchId);
await denied(() => api.createPropertyList({ requestId: crypto.randomUUID(), name: "Blocked" }), 403);
await denied(() => api.renamePropertyList(waterfrontId, { name: "Blocked", expectedUpdatedAt: associated.updatedAt }), 403); groups++;

mode("interactive");
for (const run of [() => api.getPropertyList(privateId), () => api.getPropertyListProperties(privateId), () => api.lookupPropertyListProperty(privateId, "SAMPLE-002"), () => api.addPropertyListProperty(privateId, input()), () => api.removePropertyListProperty(privateId, samplePropertyListRows[privateId][0].id), () => api.renamePropertyList(privateId, { name: "Should not leak", expectedUpdatedAt: associated.updatedAt })]) await denied(run, 404);
await denied(() => api.removePropertyListProperty(researchId, samplePropertyListRows[privateId][0].id), 404);
await denied(() => api.createPropertyList({ requestId: crypto.randomUUID(), name: "Injected owner", ownerUserId: "other" }), 400);
for (const name of [" ", "x".repeat(121), "line\nbreak"]) await denied(() => api.createPropertyList({ requestId: crypto.randomUUID(), name }), 400, "invalid_property_list");
await denied(() => api.getPropertyLists({ contactId: "invalid" }), 400);
await denied(() => api.getPropertyLists({ page: 0 }), 400); groups++;

const create = Object.freeze({ requestId: crypto.randomUUID(), name: "  Synthetic personal research  " });
const version = useDataVersion.getState().version;
const [personal, replay] = await Promise.all([api.createPropertyList(create), api.createPropertyList(create)]);
assert.equal(personal.id, replay.id); assert.equal(personal.name, "Synthetic personal research");
assert.equal(personal.contactId, null); assert.equal(personal.propertyCount, 0);
assert.equal(useDataVersion.getState().version, version + 1);
assert.equal((await api.getPropertyLists()).total, 10);
assert.equal((await api.createPropertyList({ ...create, name: "Synthetic personal research" })).id, personal.id);
await denied(() => api.createPropertyList({ ...create, name: "Changed receipt payload" }), 409, "request_conflict"); groups++;

const parentBefore = await api.getLead(dueId), historyBefore = await api.getTimeline(dueId), activityBefore = JSON.stringify(getPreviewMetrics().activity.data);
const linkedCreate = { requestId: crypto.randomUUID(), name: "Synthetic additional contact list", contactId: dueId };
const linked = await api.createPropertyList(linkedCreate);
assert.equal(linked.contactId, previewPublicRecordId(dueId));
assert.equal((await api.getPropertyLists({ contactId: dueId })).total, 4);
assert.equal((await api.getPropertyLists({ contactId: linked.contactId })).total, 4);
assert.equal((await api.getLead(dueId)).lastTouchDate, parentBefore.lastTouchDate);
assert.equal((await api.getLead(dueId)).updatedAt, parentBefore.updatedAt);
assert.deepEqual(await api.getTimeline(dueId), historyBefore);
assert.equal(JSON.stringify(getPreviewMetrics().activity.data), activityBefore);
await denied(() => api.createPropertyList({ requestId: crypto.randomUUID(), name: "No contact", contactId: "90000000-0000-4000-8000-000000000999" }), 404); groups++;

// The same MLS reference can appear in different named lists, never twice in one.
const [one, same] = await Promise.all([api.addPropertyListProperty(personal.id, input()), api.addPropertyListProperty(personal.id, input())]);
const another = await api.addPropertyListProperty(linked.id, input());
assert.equal(one.id, same.id); assert.notEqual(one.id, another.id);
assert.equal(one.listId, personal.id); assert.equal(another.listId, linked.id);
assert.equal(one.contactId, null); assert.equal(another.contactId, previewPublicRecordId(dueId));
assert.equal((await api.getPropertyList(personal.id)).propertyCount, 1);
assert.equal((await api.getPropertyList(linked.id)).propertyCount, 1);
assert.equal((await api.lookupPropertyListProperty(personal.id, "sample-002")).alreadySaved, true);
await denied(() => api.addPropertyListProperty(personal.id, { ...input(), expectedDataset: "other-source" }), 409, "listing_changed");
assert.equal((await api.getPropertyList(personal.id)).propertyCount, 1); groups++;

let renameOpening = await api.getPropertyList(personal.id);
await api.addPropertyListProperty(personal.id, input("SAMPLE-003", "sample-condo"));
await denied(() => api.renamePropertyList(personal.id, { name: "Kept name draft", expectedUpdatedAt: renameOpening.updatedAt }), 409);
renameOpening = await api.getPropertyList(personal.id);
const renamed = await api.renamePropertyList(personal.id, { name: "  Synthetic renamed research  ", expectedUpdatedAt: renameOpening.updatedAt });
assert.equal(renamed.name, "Synthetic renamed research"); assert.equal(renamed.propertyCount, 2);
const noOpVersion = useDataVersion.getState().version;
assert.equal((await api.renamePropertyList(personal.id, { name: renamed.name, expectedUpdatedAt: renamed.updatedAt })).updatedAt, renamed.updatedAt);
assert.equal(useDataVersion.getState().version, noOpVersion);
await api.removePropertyListProperty(personal.id, one.id);
const removedStamp = (await api.getPropertyList(personal.id)).updatedAt;
await api.removePropertyListProperty(personal.id, one.id);
assert.equal((await api.getPropertyList(personal.id)).updatedAt, removedStamp);
assert(readSampleListPropertyRows(personal.id).find(row => row.id === one.id).removedAt); groups++;

// Compatibility remains confined to its original default list.
assert.equal((await api.getPropertyLists({ contactId: "sample-quiet" })).total, 0);
assert.equal((await api.getContactProperties("sample-quiet")).total, 0);
await denied(() => api.addContactProperty("sample-quiet", { mlsNumber: "SAMPLE-002", expectedListingId: "sample-courtyard" }), 400);
await denied(() => api.removeContactProperty("sample-quiet", "missing"), 404);
assert.equal((await api.getPropertyLists({ contactId: "sample-quiet" })).total, 0);
const compat = await api.addContactProperty("sample-quiet", input());
assert.equal((await api.getPropertyLists({ contactId: "sample-quiet" })).total, 1);
assert.equal(readSampleDefaultPropertyList("sample-quiet").id, compat.listId);
assert.equal((await api.getContactProperties(dueId)).total, 3);
assert.equal((await api.getPropertyListProperties(investmentId)).total, 1); groups++;

for (let index = 0; index < 13; index++) await api.createPropertyList({ requestId: crypto.randomUUID(), name: `Synthetic paging list ${index + 1}` });
const firstPage = await api.getPropertyLists({ page: 1 }), secondPage = await api.getPropertyLists({ page: 2 });
assert.equal(firstPage.items.length, 12); assert(firstPage.total > 12);
const pageCount = Math.ceil(firstPage.total / firstPage.pageSize), remainingPages = await Promise.all(Array.from({ length: pageCount - 2 }, (_, index) => api.getPropertyLists({ page: index + 3 })));
assert.equal(new Set([...firstPage.items, ...secondPage.items, ...remainingPages.flatMap(page => page.items)].map(list => list.id)).size, firstPage.total);
assert.equal((await api.getPropertyLists({ page: 99 })).page, pageCount);
const historyList = readSampleDefaultPropertyList("sample-long-history");
assert.equal((await api.getPropertyListProperties(historyList.id, 1)).items.length, 12);
assert.equal((await api.getPropertyListProperties(historyList.id, 2)).items.length, 1); groups++;

let review = await api.getContactMergeReview(primaryId, duplicateId), staleMerge = mergeInput(review);
const sourceNewCreate = { requestId: crypto.randomUUID(), name: "Separate source research", contactId: duplicateId };
const sourceNew = await api.createPropertyList(sourceNewCreate);
assert.equal((await api.getLead(duplicateId)).updatedAt, review.duplicate.updatedAt);
await denied(() => api.mergeContacts(staleMerge), 409);
review = await api.getContactMergeReview(primaryId, duplicateId); staleMerge = mergeInput(review);
const additional = await api.addPropertyListProperty(sourceNew.id, input("SAMPLE-003", "sample-condo"));
await denied(() => api.mergeContacts(staleMerge), 409);
await api.removePropertyListProperty(sourceNew.id, additional.id);
await api.addPropertyListProperty(sourceNew.id, input("SAMPLE-003", "sample-condo"));
const beforeLists = [...readSampleContactPropertyLists(primaryId), ...readSampleContactPropertyLists(duplicateId)];
const beforeRows = beforeLists.flatMap(list => readSampleListPropertyRows(list.id));
const personalSnapshot = JSON.stringify(readSampleListPropertyRows(personal.id));
review = await api.getContactMergeReview(primaryId, duplicateId);
assert.equal(review.preservedCounts.propertyLists, 3); assert.equal(review.preservedCounts.properties, 4);
const mergeCommand = mergeInput(review), merged = await api.mergeContacts(mergeCommand);
assert.equal(merged.preservedCounts.propertyLists, 3); assert.equal(merged.preservedCounts.properties, 4);
const afterLists = readSampleContactPropertyLists(primaryId), afterRows = afterLists.flatMap(list => readSampleListPropertyRows(list.id));
assert.deepEqual(new Set(afterLists.map(list => list.id)), new Set(beforeLists.map(list => list.id)));
assert.deepEqual(new Set(afterRows.map(row => row.id)), new Set(beforeRows.map(row => row.id)));
for (const list of beforeLists) assert.equal((await api.getPropertyList(list.id)).name, list.name);
assert.equal((await api.getPropertyList(sourceNew.id)).contactId, primaryId);
assert.equal((await api.createPropertyList(sourceNewCreate)).id, sourceNew.id);
assert.equal((await api.createPropertyList(sourceNewCreate)).contactId, primaryId);
assert.equal(afterRows.filter(row => !row.removedAt && row.mlsNumber === "SAMPLE-001").length, 2);
assert(afterRows.every(row => row.contactId === primaryId && beforeRows.some(old => old.id === row.id && old.listId === row.listId)));
assert.equal(JSON.stringify(readSampleListPropertyRows(personal.id)), personalSnapshot);
assert.equal(readSampleRawPropertyLists().find(list => list.id === privateId).contactId, null);
assert.equal((await api.getContactProperties(primaryId)).total, 1);
assert.equal((await api.getPropertyLists({ contactId: primaryId })).total, 3); groups++;

installPreviewTransport();
assert.equal((await window.fetch("/api/property-lists", { method: "POST" })).status, 403);
assert.equal((await window.fetch("https://example.invalid/property-lists")).status, 403);
assert.equal(immutable(), original);
mode("records");
assert.equal((await api.getPropertyLists()).total, 9);
assert.equal((await api.getPropertyLists({ contactId: dueId })).total, 3);
await denied(() => api.getPropertyList(personal.id), 404);
mode("interactive");
const fresh = await import("./sample-session.mjs?fresh-named-list-page");
assert.equal(fresh.readSampleRawPropertyLists().length, samplePropertyLists.length);
assert.equal(fresh.readSampleReceipt("property-list", create.requestId), undefined);
assert.equal(immutable(), original); groups++;

console.log(`PASS: ${groups} isolated named-list groups (personal/contact scopes, owner privacy, create receipts, cross-list MLS membership, rename revisions, compatibility defaults, index/card paging, distinct-list merge retention, no touch and reset).`);
