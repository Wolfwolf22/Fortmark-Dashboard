// Run: node --experimental-strip-types --no-warnings tools/design-preview/test-property-research-session.mjs
// Research and transfers are synthetic, metadata-only and never call a provider.
import assert from "node:assert/strict";
import * as api from "./contact-adapters.mjs";
import { samplePropertyListRows, samplePropertyLists, samplePropertyCatalog, SAMPLE_WATERFRONT_LIST_ID as waterfrontId, SAMPLE_INVESTMENT_LIST_ID as investmentId, SAMPLE_PERSONAL_RESEARCH_LIST_ID as researchId, SAMPLE_PERSONAL_EMPTY_LIST_ID as emptyId, SAMPLE_PRIVATE_LIST_ID as privateId, SAMPLE_PROPERTY_DATASET } from "./property-fixtures.mjs";
import { readSampleListPropertyRows, readSampleRawPropertyLists, replaceSamplePropertyList } from "./sample-session.mjs";
import { DUPLICATE_PRIMARY_ID as primaryId, DUPLICATE_SOURCE_ID as duplicateId } from "./import-merge-fixtures.mjs";
import { SAMPLE_COLLEAGUE_ID } from "./contact-fixtures.mjs";
import { getPreviewMetrics, installPreviewTransport } from "./fixtures.mjs";
import { useDataVersion } from "../../lib/data/store.ts";

globalThis.window = Object.assign(new EventTarget(), { location: { search: "?scenario=records", origin: "http://127.0.0.1:4173" } });
const mode = value => { window.location.search = `?scenario=${value}`; };
const denied = (fn, status, code) => assert.rejects(fn, error => error.status === status && (!code || error.code === code));
const original = JSON.stringify({ samplePropertyListRows, samplePropertyLists, samplePropertyCatalog });
const waterfront = samplePropertyListRows[waterfrontId], coastalId = waterfront[0].id, offlineId = waterfront[2].id;
const longId = "83000000-0000-4000-8000-000000000006";
const research = (row, notes, reviewStatus = "shortlisted") => ({ notes, reviewStatus, expectedUpdatedAt: row.updatedAt });
const transfer = (row, targetListId, mode = "copy") => ({ requestId: crypto.randomUUID(), mode, targetListId, expectedUpdatedAt: row.updatedAt });
function mergeInput(review) { return { requestId: crypto.randomUUID(), primaryId, duplicateId, expectedPrimaryUpdatedAt: review.primary.updatedAt, expectedDuplicateUpdatedAt: review.duplicate.updatedAt, expectedPrimaryHistoryFingerprint: review.primary.historyFingerprint, expectedDuplicateHistoryFingerprint: review.duplicate.historyFingerprint, choices: review.defaults, nextActionChoice: "primary" }; }
let groups = 0;

let coastal = await api.getPropertyListProperty(waterfrontId, coastalId);
assert.equal(coastal.listing, null); assert.equal(coastal.checkedAt, null); assert.equal(coastal.syncStatus, "unavailable");
assert.equal(coastal.reviewStatus, "shortlisted"); assert(coastal.notes); assert(Number.isFinite(Date.parse(coastal.updatedAt)));
const independent = await api.getPropertyListProperty(researchId, samplePropertyListRows[researchId][0].id);
assert.notEqual(independent.notes, coastal.notes); assert.equal(independent.reviewStatus, "ruled_out");
await denied(() => api.updatePropertyResearch(waterfrontId, coastalId, research(coastal, "Blocked")), 403);
await denied(() => api.transferProperty(waterfrontId, coastalId, transfer(coastal, emptyId)), 403); groups++;

mode("interactive");
for (const invalid of [{ notes: "x".repeat(5001) }, { notes: "nul\u0000" }, { reviewStatus: "unknown" }, { expectedUpdatedAt: "invalid" }, { extra: true }]) await denied(() => api.updatePropertyResearch(waterfrontId, coastalId, { ...research(coastal, "Valid"), ...invalid }), 400, "invalid_property_research");
await denied(() => api.updatePropertyResearch(privateId, samplePropertyListRows[privateId][0].id, research(coastal, "Cannot read this")), 404);
await denied(() => api.getPropertyListProperty(privateId, samplePropertyListRows[privateId][0].id), 404);
await denied(() => api.getPropertyListProperty(investmentId, coastalId), 404);
await denied(() => api.transferProperty(waterfrontId, coastalId, transfer(coastal, waterfrontId)), 400, "invalid_property_transfer");
await denied(() => api.transferProperty(waterfrontId, coastalId, transfer(coastal, privateId)), 404);
await denied(() => api.transferProperty(waterfrontId, coastalId, { ...transfer(coastal, emptyId), notes: "Client cannot supply copied research" }), 400, "invalid_property_transfer"); groups++;

const parentBefore = await api.getLead("sample-due-today"), activityBefore = JSON.stringify(getPreviewMetrics().activity.data);
const plainText = "  <script>kept as plain text</script>\n<b>Research only</b>  ";
const firstOpening = coastal, firstVersion = useDataVersion.getState().version;
coastal = await api.updatePropertyResearch(waterfrontId, coastalId, research(coastal, plainText));
assert.equal(coastal.notes, plainText); assert.equal(coastal.reviewStatus, "shortlisted");
assert(Date.parse(coastal.updatedAt) > Date.parse(firstOpening.updatedAt));
assert.equal(coastal.addedAt, firstOpening.addedAt);
assert.equal(coastal.listingId, firstOpening.listingId);
assert.equal(useDataVersion.getState().version, firstVersion + 1);
assert.deepEqual(await api.getPropertyListProperty(researchId, independent.id), independent);
assert.equal((await api.getLead("sample-due-today")).updatedAt, parentBefore.updatedAt);
assert.equal((await api.getLead("sample-due-today")).lastTouchDate, parentBefore.lastTouchDate);
assert.equal(JSON.stringify(getPreviewMetrics().activity.data), activityBefore); groups++;

const frozen = Object.freeze(research(firstOpening, "Kept stale draft", "ruled_out")), frozenCopy = JSON.stringify(frozen);
await denied(() => api.updatePropertyResearch(waterfrontId, coastalId, frozen), 409);
assert.equal(JSON.stringify(frozen), frozenCopy);
const fresh = await api.getPropertyListProperty(waterfrontId, coastalId);
assert.equal(fresh.notes, plainText);
coastal = await api.updatePropertyResearch(waterfrontId, coastalId, { ...frozen, expectedUpdatedAt: fresh.updatedAt });
const lostResponseVersion = useDataVersion.getState().version;
const acknowledged = await api.updatePropertyResearch(waterfrontId, coastalId, { ...frozen, expectedUpdatedAt: fresh.updatedAt });
assert.equal(acknowledged.updatedAt, coastal.updatedAt);
assert.equal(useDataVersion.getState().version, lostResponseVersion);
assert.equal((await api.updatePropertyResearch(waterfrontId, coastalId, research(coastal, coastal.notes, coastal.reviewStatus))).updatedAt, coastal.updatedAt); groups++;
const fullLength = "🧭".repeat(2500);
assert.equal((await api.updatePropertyResearch(researchId, independent.id, research(independent, fullLength, "ruled_out"))).notes, fullLength);

// None of these metadata operations may reach the listing catalog/provider.
let offline = await api.getPropertyListProperty(waterfrontId, offlineId), copied, copyRequest;
const originalFind = samplePropertyCatalog.find;
const sourceListBeforeCopy = await api.getPropertyList(waterfrontId);
try {
  samplePropertyCatalog.find = () => { throw new Error("Metadata operations must not query MLS"); };
  offline = await api.updatePropertyResearch(waterfrontId, offlineId, research(offline, "  Confirm availability.\nKeep the research while the feed is unavailable.  ", "ruled_out"));
  const sourceBeforeCopy = await api.getPropertyListProperty(waterfrontId, offlineId);
  const copyOpeningList = await api.getPropertyList(waterfrontId);
  copyRequest = transfer(offline, emptyId);
  copied = await api.transferProperty(waterfrontId, offlineId, copyRequest);
  assert.equal(copied.sourceRemoved, false); assert.equal(copied.targetListId, emptyId);
  assert.equal(copied.property.notes, offline.notes); assert.equal(copied.property.reviewStatus, offline.reviewStatus);
  assert.notEqual(copied.property.id, offline.id); assert.equal(copied.property.listing, null); assert.equal(copied.property.checkedAt, null);
  assert.deepEqual(await api.getPropertyListProperty(waterfrontId, offlineId), sourceBeforeCopy);
  assert.equal((await api.getPropertyList(waterfrontId)).updatedAt, copyOpeningList.updatedAt);
} finally { samplePropertyCatalog.find = originalFind; }
assert.equal((await api.getPropertyList(emptyId)).propertyCount, 1);
const sourceAfterCopy = await api.getPropertyList(waterfrontId);
assert(Date.parse(sourceAfterCopy.updatedAt) > Date.parse(sourceListBeforeCopy.updatedAt)); // research changed it
const copyTarget = await api.updatePropertyResearch(emptyId, copied.property.id, research(copied.property, "Independent destination research", "shortlisted"));
assert.equal((await api.getPropertyListProperty(waterfrontId, offlineId)).notes, offline.notes);
assert.notEqual(copyTarget.notes, offline.notes); groups++;

// Existing target research never gets overwritten, and a failed move never deletes the source.
const sourceSnapshot = JSON.stringify(readSampleListPropertyRows(waterfrontId));
const targetSnapshot = JSON.stringify(readSampleListPropertyRows(researchId));
for (const kind of ["copy", "move"]) await denied(() => api.transferProperty(waterfrontId, coastalId, transfer(coastal, researchId, kind)), 409, "target_has_property");
assert.equal(JSON.stringify(readSampleListPropertyRows(waterfrontId)), sourceSnapshot);
assert.equal(JSON.stringify(readSampleListPropertyRows(researchId)), targetSnapshot); groups++;

const moveRequest = Object.freeze(transfer(offline, investmentId, "move"));
const beforeMoveVersion = useDataVersion.getState().version;
let moved, repeatedMove;
try {
  samplePropertyCatalog.find = () => { throw new Error("Offline move must not query MLS"); };
  [moved, repeatedMove] = await Promise.all([api.transferProperty(waterfrontId, offlineId, moveRequest), api.transferProperty(waterfrontId, offlineId, moveRequest)]);
} finally { samplePropertyCatalog.find = originalFind; }
assert.equal(moved.property.id, repeatedMove.property.id); assert.equal(moved.sourceRemoved, true);
assert.equal(moved.property.notes, offline.notes); assert.equal(moved.property.reviewStatus, offline.reviewStatus);
assert.equal(useDataVersion.getState().version, beforeMoveVersion + 1);
const retired = readSampleListPropertyRows(waterfrontId).find(row => row.id === offlineId);
assert(retired.removedAt); assert(Date.parse(retired.updatedAt) > Date.parse(offline.updatedAt));
await denied(() => api.getPropertyListProperty(waterfrontId, offlineId), 404);
assert.equal((await api.getPropertyList(waterfrontId)).propertyCount, 2);
assert.equal((await api.getPropertyList(investmentId)).propertyCount, 2); groups++;

const replayVersion = useDataVersion.getState().version;
const replayCopy = await api.transferProperty(waterfrontId, offlineId, copyRequest);
assert.equal(replayCopy.property.id, copied.property.id); assert.equal(replayCopy.property.notes, copyTarget.notes);
assert.equal(useDataVersion.getState().version, replayVersion);
await denied(() => api.transferProperty(waterfrontId, offlineId, { ...copyRequest, mode: "move" }), 409, "request_conflict");
const targetList = readSampleRawPropertyLists().find(list => list.id === emptyId);
try { replaceSamplePropertyList({ ...targetList, ownerUserId: SAMPLE_COLLEAGUE_ID }); await denied(() => api.transferProperty(waterfrontId, offlineId, copyRequest), 404); await denied(() => api.transferProperty(waterfrontId, offlineId, { ...copyRequest, targetListId: investmentId }), 404); }
finally { replaceSamplePropertyList(targetList); }
await api.removePropertyListProperty(investmentId, moved.property.id, moved.property.updatedAt);
const beforeRemovedReplay = JSON.stringify(readSampleListPropertyRows(investmentId));
await denied(() => api.transferProperty(waterfrontId, offlineId, moveRequest), 409, "conflict");
assert.equal(JSON.stringify(readSampleListPropertyRows(investmentId)), beforeRemovedReplay); groups++;

const added = await api.addPropertyListProperty(researchId, { mlsNumber: "SAMPLE-002", expectedListingId: "sample-courtyard", expectedDataset: SAMPLE_PROPERTY_DATASET });
const changed = await api.updatePropertyResearch(researchId, added.id, research(added, "Updated after the removal dialog opened", "ruled_out"));
await denied(() => api.removePropertyListProperty(researchId, added.id, added.updatedAt), 409);
assert.equal((await api.getPropertyListProperty(researchId, added.id)).notes, changed.notes);
await api.removePropertyListProperty(researchId, added.id, changed.updatedAt);
const removedRevision = readSampleListPropertyRows(researchId).find(row => row.id === added.id).updatedAt;
await api.removePropertyListProperty(researchId, added.id, changed.updatedAt);
assert.equal(readSampleListPropertyRows(researchId).find(row => row.id === added.id).updatedAt, removedRevision); groups++;

// Global filter/price order precedes pagination; the cheapest is absent from the old first page.
const addedAsc = await api.getPropertyListProperties(longId, 1, { sort: "added_asc" });
assert(!addedAsc.items.some(row => row.mlsNumber === "SAMPLE-113"));
const priceAsc = await api.getPropertyListProperties(longId, 1, { sort: "price_asc" });
assert.equal(priceAsc.items[0].mlsNumber, "SAMPLE-113"); assert.equal(priceAsc.total, 13); assert.equal(priceAsc.totalAll, 13);
assert(priceAsc.items.every((row, index) => index === 0 || priceAsc.items[index - 1].listing.listPrice <= row.listing.listPrice));
const unknownAsc = await api.getPropertyListProperties(longId, 2, { sort: "price_asc" });
const unknownDesc = await api.getPropertyListProperties(longId, 2, { sort: "price_desc" });
assert.equal(unknownAsc.items[0].mlsNumber, "SAMPLE-109"); assert.equal(unknownAsc.items[0].listing, null);
assert.equal(unknownDesc.items[0].id, unknownAsc.items[0].id);
assert.equal((await api.getPropertyListProperties(longId, 1, { sort: "price_desc" })).items[0].mlsNumber, "SAMPLE-111");
const shortlisted = await api.getPropertyListProperties(longId, 2, { reviewStatus: "shortlisted", sort: "added_desc" });
assert.equal(shortlisted.total, 4); assert.equal(shortlisted.totalAll, 13); assert.equal(shortlisted.page, 1);
assert(shortlisted.items.every(row => row.reviewStatus === "shortlisted"));
const earliest = addedAsc.items[0], newestBefore = (await api.getPropertyListProperties(longId)).items[0].id;
await api.updatePropertyResearch(longId, earliest.id, research(earliest, "Saved research does not change when this property was added.", "shortlisted"));
assert.equal((await api.getPropertyListProperties(longId)).items[0].id, newestBefore);
assert.equal((await api.getPropertyListProperties(longId, 1, { reviewStatus: "shortlisted" })).total, 5);
await denied(() => api.getPropertyListProperties(longId, 1, { reviewStatus: "wrong" }), 400);
await denied(() => api.getPropertyListProperties(longId, 1, { sort: "notes" }), 400); groups++;

let mergeReview = await api.getContactMergeReview(primaryId, duplicateId), staleMerge = mergeInput(mergeReview);
const primaryList = readSampleRawPropertyLists().find(list => list.contactId === primaryId);
const duplicateList = readSampleRawPropertyLists().find(list => list.contactId === duplicateId);
const p = await api.getPropertyListProperty(primaryList.id, readSampleListPropertyRows(primaryList.id)[0].id);
const pSaved = await api.updatePropertyResearch(primaryList.id, p.id, research(p, "Research preserved through contact merge", "shortlisted"));
await denied(() => api.mergeContacts(staleMerge), 409);
mergeReview = await api.getContactMergeReview(primaryId, duplicateId); staleMerge = mergeInput(mergeReview);
await api.transferProperty(primaryList.id, p.id, transfer(pSaved, emptyId, "copy"));
assert.equal((await api.getPropertyListProperty(primaryList.id, p.id)).updatedAt, pSaved.updatedAt);
await denied(() => api.mergeContacts(staleMerge), 409);
mergeReview = await api.getContactMergeReview(primaryId, duplicateId); staleMerge = mergeInput(mergeReview);
const d = await api.getPropertyListProperty(duplicateList.id, readSampleListPropertyRows(duplicateList.id).find(row => row.mlsNumber === "SAMPLE-002").id);
await api.transferProperty(duplicateList.id, d.id, transfer(d, researchId, "move"));
await denied(() => api.mergeContacts(staleMerge), 409);
mergeReview = await api.getContactMergeReview(primaryId, duplicateId);
await api.mergeContacts(mergeInput(mergeReview));
assert.equal((await api.getPropertyListProperty(primaryList.id, p.id)).notes, pSaved.notes);
assert.equal((await api.getPropertyListProperty(primaryList.id, p.id)).reviewStatus, pSaved.reviewStatus);
assert.equal((await api.getPropertyList(duplicateList.id)).contactId, primaryId); groups++;

mode("conflict");
const base = await api.getPropertyListProperty(waterfrontId, coastalId), rehearsal = Object.freeze(research(base, "Kept browser rehearsal draft", "to_review"));
const keptRehearsal = JSON.stringify(rehearsal);
await denied(() => api.updatePropertyResearch(waterfrontId, coastalId, rehearsal), 409);
const remote = await api.getPropertyListProperty(waterfrontId, coastalId);
assert.notEqual(remote.notes, base.notes); assert.notEqual(remote.updatedAt, base.updatedAt);
assert.equal(JSON.stringify(rehearsal), keptRehearsal);
await denied(() => api.updatePropertyResearch(waterfrontId, coastalId, { ...rehearsal, expectedUpdatedAt: remote.updatedAt }), 403);
mode("records"); assert.deepEqual(await api.getPropertyListProperty(waterfrontId, coastalId), base);
mode("interactive");
installPreviewTransport();
assert.equal((await window.fetch("/api/property-lists/x/properties/y", { method: "PATCH" })).status, 403);
assert.equal((await window.fetch("https://example.invalid/research", { method: "POST" })).status, 403);
const freshSession = await import("./sample-session.mjs?fresh-research-page");
assert.equal(freshSession.readSampleListPropertyRows(waterfrontId).find(row => row.id === coastalId).notes, base.notes);
assert.equal(JSON.stringify({ samplePropertyListRows, samplePropertyLists, samplePropertyCatalog }), original); groups++;

console.log(`PASS: ${groups} isolated research groups (independent metadata, whitespace/XSS text, CAS/replay, no-MLS research/copy/move, duplicate targets, receipts/reauthorization, removal CAS, global filter/price pagination, merge retention, read-only conflict and reset).`);
