// Run: node --experimental-strip-types --no-warnings tools/design-preview/test-property-session.mjs
// Real UI adapter shapes, isolated fictional references, no provider/network.
import assert from "node:assert/strict";
import * as api from "./contact-adapters.mjs";
import { sampleContactProperties, samplePropertyCatalog, SAMPLE_PROPERTY_DATASET } from "./property-fixtures.mjs";
import { DUPLICATE_PRIMARY_ID as primaryId, DUPLICATE_SOURCE_ID as duplicateId } from "./import-merge-fixtures.mjs";
import { readSamplePropertyRows, readSampleProperties, readSampleContactListRows } from "./sample-session.mjs";
import { installPreviewTransport, getPreviewMetrics } from "./fixtures.mjs";
import { useDataVersion } from "../../lib/data/store.ts";

globalThis.window = Object.assign(new EventTarget(), { location: { search: "?scenario=records", origin: "http://127.0.0.1:4173" } });
const mode = value => { window.location.search = `?scenario=${value}`; };
const denied = (fn, status, code) => assert.rejects(fn, error => error.status === status && (!code || error.code === code));
const baseline = JSON.stringify({ sampleContactProperties, samplePropertyCatalog });
const id = "sample-due-today";
let groups = 0;
function command(review) { return { requestId: crypto.randomUUID(), primaryId, duplicateId, expectedPrimaryUpdatedAt: review.primary.updatedAt, expectedDuplicateUpdatedAt: review.duplicate.updatedAt, expectedPrimaryHistoryFingerprint: review.primary.historyFingerprint, expectedDuplicateHistoryFingerprint: review.duplicate.historyFingerprint, choices: review.defaults, nextActionChoice: "primary" }; }

let page = await api.getContactProperties(id);
assert.equal(page.total, 3); assert.equal(page.page, 1); assert.equal(page.pageSize, 12);
assert.deepEqual(page.items.map(item => item.syncStatus), ["available", "not_found", "unavailable"]);
assert.equal(page.items[0].listing.mlsNumber, "SAMPLE-001");
assert(page.items.slice(1).every(item => item.listing === null && item.id && item.listingId && item.mlsNumber));
assert(page.items.every(item => item.checkedAt === page.items[0].checkedAt));
assert.equal((await api.lookupContactProperty(id, "  sample-001  ")).alreadySaved, true);
assert.equal((await api.lookupContactProperty(id, "SAMPLE-002")).alreadySaved, false);
await denied(() => api.addContactProperty(id, { mlsNumber: "SAMPLE-002", expectedListingId: "sample-courtyard", expectedDataset: SAMPLE_PROPERTY_DATASET }), 403);
await denied(() => api.removeContactProperty(id, page.items[0].id), 403);
await denied(() => api.getContactProperties("missing-contact"), 404);
await denied(() => api.getContactProperties("sample-labeled-fallback"), 403);
for (const invalid of [0, -1, 1.5, 1_000_001]) await denied(() => api.getContactProperties(id, invalid), 400, "invalid_property"); groups++;

mode("interactive");
const before = await api.getLead(id), beforeHistory = await api.getTimeline(id);
const activityBefore = JSON.stringify(getPreviewMetrics().activity.data);
await denied(() => api.lookupContactProperty(id, "https://example.invalid/listing"), 400, "invalid_property");
await denied(() => api.lookupContactProperty(id, "SAMPLE-999"), 404, "listing_not_found");
await denied(() => api.lookupContactProperty(id, "SAMPLE-OFFLINE-902"), 503, "unavailable");
await denied(() => api.lookupContactProperty(id, "SAMPLE-NOT-CONFIGURED-903"), 503, "not_configured");
await denied(() => api.addContactProperty(id, { mlsNumber: "SAMPLE-002", expectedListingId: "wrong-listing", expectedDataset: SAMPLE_PROPERTY_DATASET }), 409, "listing_changed");
await denied(() => api.addContactProperty(id, { mlsNumber: "SAMPLE-002", expectedListingId: "sample-courtyard", expectedDataset: "different-source" }), 409, "listing_changed");
await denied(() => api.addContactProperty(id, { mlsNumber: "SAMPLE-002", expectedListingId: "sample-courtyard" }), 400, "invalid_property");
await denied(() => api.addContactProperty(id, { mlsNumber: "SAMPLE-002", expectedListingId: "sample-courtyard", expectedDataset: SAMPLE_PROPERTY_DATASET, listing: { address: "Client supplied data" } }), 400, "invalid_property");
assert.equal((await api.getContactProperties(id)).total, 3); groups++;

const lookup = await api.lookupContactProperty(id, "sample-002");
assert.equal(lookup.dataset, SAMPLE_PROPERTY_DATASET);
const draft = Object.freeze({ mlsNumber: "sample-002", expectedListingId: lookup.listing.id, expectedDataset: lookup.dataset });
const version = useDataVersion.getState().version;
const [saved, repeated] = await Promise.all([api.addContactProperty(id, draft), api.addContactProperty(id, draft)]);
assert.equal(saved.id, repeated.id);
assert.equal(saved.mlsNumber, "SAMPLE-002");
assert.equal(saved.syncStatus, "available");
assert.equal(saved.listing.source, "sample");
assert.equal((await api.getContactProperties(id)).total, 4);
assert.equal(useDataVersion.getState().version, version + 1);
assert.equal((await api.lookupContactProperty(id, "SAMPLE-002")).alreadySaved, true);
await denied(() => api.addContactProperty(id, { ...draft, expectedDataset: "different-source" }), 409, "listing_changed");
assert.equal((await api.getContactProperties(id)).total, 4);
const after = await api.getLead(id);
assert.equal(after.updatedAt, before.updatedAt);
assert.equal(after.lastTouchDate, before.lastTouchDate);
assert.equal(after.lastContactDate, before.lastContactDate);
assert.equal(after.stage, before.stage);
assert.deepEqual(await api.getTimeline(id), beforeHistory);
assert.equal(JSON.stringify(getPreviewMetrics().activity.data), activityBefore); groups++;

assert.deepEqual(await api.removeContactProperty(id, saved.id), { removed: true });
assert.deepEqual(await api.removeContactProperty(id, saved.id), { removed: true });
assert(readSamplePropertyRows(id).find(item => item.id === saved.id).removedAt);
assert.equal((await api.lookupContactProperty(id, "SAMPLE-002")).alreadySaved, false);
const readded = await api.addContactProperty(id, draft);
assert.notEqual(readded.id, saved.id);
assert(readSamplePropertyRows(id).some(item => item.id === saved.id && item.removedAt));
await denied(() => api.removeContactProperty(id, "not-a-record-id"), 404);
await denied(() => api.removeContactProperty(id, sampleContactProperties[primaryId][0].id), 404);
const offline = (await api.getContactProperties(id)).items.find(item => item.syncStatus === "unavailable");
await api.removeContactProperty(id, offline.id);
assert(!readSampleProperties(id).some(item => item.id === offline.id)); groups++;

const first = await api.getContactProperties("sample-long-history", 1), second = await api.getContactProperties("sample-long-history", 2);
assert.equal(first.total, 13); assert.equal(first.items.length, 12); assert.equal(second.items.length, 1);
assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 13);
assert.equal((await api.getContactProperties("sample-long-history", 99)).page, 2);
await api.removeContactProperty("sample-long-history", second.items[0].id);
const clamped = await api.getContactProperties("sample-long-history", 2);
assert.equal(clamped.total, 12); assert.equal(clamped.page, 1); assert.equal(clamped.items.length, 12); groups++;

// Each refresh resolves the saved reference again, rather than storing a stale DTO.
const coastal = samplePropertyCatalog.find(listing => listing.id === "sample-coastal");
const originalPrice = coastal.listPrice, originalId = coastal.id;
try {
  coastal.listPrice += 5000;
  const fresh = (await api.getContactProperties(id)).items.find(item => item.mlsNumber === "SAMPLE-001");
  assert.equal(fresh.listing.listPrice, originalPrice + 5000);
  fresh.listing.listPrice = 1;
  assert.equal((await api.lookupContactProperty(id, "SAMPLE-001")).listing.listPrice, originalPrice + 5000);
  coastal.id = "sample-coastal-replaced-reference";
  const missing = (await api.getContactProperties(id)).items.find(item => item.mlsNumber === "SAMPLE-001");
  assert.equal(missing.syncStatus, "not_found"); assert.equal(missing.listing, null); assert.equal(missing.listingId, originalId);
  await denied(() => api.addContactProperty(id, { mlsNumber: "SAMPLE-001", expectedListingId: originalId, expectedDataset: SAMPLE_PROPERTY_DATASET }), 409, "listing_changed");
} finally { coastal.listPrice = originalPrice; coastal.id = originalId; }
assert.equal((await api.getContactProperties(id)).items.find(item => item.mlsNumber === "SAMPLE-001").syncStatus, "available"); groups++;

// Both added and soft-removed property children invalidate an old merge review.
let review = await api.getContactMergeReview(primaryId, duplicateId);
assert.equal(review.primary.counts.properties, 1); assert.equal(review.duplicate.counts.properties, 2); assert.equal(review.preservedCounts.properties, 3);
let stale = command(review);
await api.addContactProperty(duplicateId, { mlsNumber: "SAMPLE-003", expectedListingId: "sample-condo", expectedDataset: SAMPLE_PROPERTY_DATASET });
assert.equal((await api.getLead(duplicateId)).updatedAt, review.duplicate.updatedAt);
await denied(() => api.mergeContacts(stale), 409);
review = await api.getContactMergeReview(primaryId, duplicateId); stale = command(review);
const courtyard = readSampleProperties(duplicateId).find(item => item.mlsNumber === "SAMPLE-002");
await api.removeContactProperty(duplicateId, courtyard.id);
await denied(() => api.mergeContacts(stale), 409);
await api.addContactProperty(duplicateId, { mlsNumber: "SAMPLE-002", expectedListingId: "sample-courtyard", expectedDataset: SAMPLE_PROPERTY_DATASET }); groups++;

review = await api.getContactMergeReview(primaryId, duplicateId);
assert.equal(review.preservedCounts.properties, 4);
const allRows = [...readSamplePropertyRows(primaryId), ...readSamplePropertyRows(duplicateId)];
const sourceDuplicate = readSampleProperties(duplicateId).find(item => item.mlsNumber === "SAMPLE-001");
const mergeCommand = command(review), merged = await api.mergeContacts(mergeCommand);
assert.equal(merged.preservedCounts.properties, 4);
const mergedRows = readSampleContactListRows(primaryId);
assert.deepEqual(new Set(mergedRows.map(item => item.id)), new Set(allRows.map(item => item.id)));
assert(mergedRows.every(item => item.contactId === primaryId));
assert.equal(mergedRows.find(item => item.id === sourceDuplicate.id).removedAt, null);
assert(mergedRows.find(item => item.id === courtyard.id).removedAt);
assert.equal(readSamplePropertyRows(duplicateId).length, 0);
assert.equal((await api.getContactProperties(primaryId)).total, 1);
assert.equal((await api.getContactProperties(duplicateId)).total, 1);
assert.equal((await api.getLead(duplicateId)).id, primaryId);
await denied(() => api.addContactProperty(duplicateId, { mlsNumber: "SAMPLE-004", expectedListingId: "sample-empty-photo", expectedDataset: SAMPLE_PROPERTY_DATASET }), 409, "merged_contact");
const replaySnapshot = JSON.stringify(mergedRows);
await api.mergeContacts(mergeCommand);
assert.equal(JSON.stringify(readSampleContactListRows(primaryId)), replaySnapshot); groups++;

installPreviewTransport();
assert.equal((await window.fetch("/api/contacts/x/properties", { method: "POST" })).status, 403);
assert.equal((await window.fetch("https://example.invalid/mls", { method: "POST" })).status, 403);
assert.equal(JSON.stringify({ sampleContactProperties, samplePropertyCatalog }), baseline);
mode("records");
assert.equal((await api.getContactProperties(id)).total, 3);
assert.equal((await api.getContactProperties("sample-long-history")).total, 13);
assert.equal(readSamplePropertyRows(duplicateId).length, 2);
mode("conflict"); await denied(() => api.addContactProperty(id, draft), 403);
mode("interactive");
const freshSession = await import("./sample-session.mjs?fresh-property-page");
assert.equal(freshSession.readSampleProperties(id).length, 3);
assert(freshSession.readSamplePropertyRows(id).every(item => item.removedAt === null));
assert.equal(JSON.stringify({ sampleContactProperties, samplePropertyCatalog }), baseline); groups++;

console.log(`PASS: ${groups} isolated property-list groups (manual exact lookup, retained feed failures, read-only guards, idempotent add/remove, paging, fresh identity, merge fingerprints/list retention/history, no touch/activity and reset).`);
