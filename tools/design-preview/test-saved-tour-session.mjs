// Saved plans and signed schedule reviews over isolated synthetic state only.
import assert from "node:assert/strict";
import * as saved from "./saved-tour-model.mjs";
import { sampleSavedTours, SAMPLE_SAVED_TOUR_ID as mainId, SAMPLE_PERSONAL_SAVED_TOUR_ID as personalId, SAMPLE_PRIVATE_SAVED_TOUR_ID as privateId, SAMPLE_ARCHIVED_TOUR_ID as archivedId } from "./saved-tour-fixtures.mjs";
import { SAMPLE_TOUR_LIST_ID, SAMPLE_PERSONAL_TOUR_LIST_ID, SAMPLE_PRIVATE_LIST_ID, samplePropertyCatalog, samplePropertyLists, samplePropertyListRows } from "./property-fixtures.mjs";
import { SAMPLE_COLLEAGUE_ID } from "./contact-fixtures.mjs";
import { SAMPLE_ACTOR, readSampleRawContacts, readSampleContact, readSampleTimeline, readSampleRawPropertyLists, readSampleListPropertyRows, replaceSamplePropertyList, replaceSampleListPropertyRows } from "./sample-session.mjs";
import { readAllSampleShowings, getSampleShowing, createSampleShowing, updateSampleShowing } from "./showing-model.mjs";
import { sampleEndpointOptions, sampleRoadMatrix } from "./tour-fixtures.mjs";
import { optimizeTour } from "../../lib/showings/tour-optimizer.ts";
import { installPreviewTransport, getPreviewMetrics } from "./fixtures.mjs";
import { useDataVersion } from "../../lib/data/store.ts";
import * as contacts from "./contact-adapters.mjs";
import { DUPLICATE_PRIMARY_ID, DUPLICATE_SOURCE_ID } from "./import-merge-fixtures.mjs";

globalThis.window = Object.assign(new EventTarget(), { location: { search: "?scenario=records&view=%2Fshowing-tours", origin: "http://127.0.0.1:4173" } });
installPreviewTransport();
const mode = value => { window.location.search = `?scenario=${value}&view=%2Fshowing-tours`; };
const settings = row => ({ name: row.name, notes: row.notes, contactId: row.contactId, sourceListId: row.sourceListId, startsAt: row.startsAt, bufferMinutes: row.bufferMinutes, firstPropertyId: row.firstPropertyId, originAddress: row.originAddress, endMode: row.endMode, endAddress: row.endAddress, stops: row.stops.map(({ propertyId, visitMinutes, lockTime, linkedShowingId }) => ({ propertyId, visitMinutes, lockTime, linkedShowingId })) });
const update = (row, values = {}) => saved.updateSampleSavedTour(row.id, { ...settings(row), ...values, requestId: crypto.randomUUID(), expectedUpdatedAt: row.updatedAt });
const denied = (fn, status, code) => assert.rejects(async () => fn(), error => error.status === status && (!code || error.code === code));
const review = row => saved.reviewSampleSavedTour(row.id, { expectedUpdatedAt: row.updatedAt });
const confirmation = result => ({ requestId: crypto.randomUUID(), expectedUpdatedAt: result.expectedUpdatedAt, reviewToken: result.reviewToken });
const businessState = () => JSON.stringify({ contacts: readSampleRawContacts(), properties: readSampleRawPropertyLists().flatMap(list => readSampleListPropertyRows(list.id)), timeline: readSampleTimeline("sample-due-today"), activity: getPreviewMetrics(new Date("2026-11-02T12:00:00Z")).activity, version: useDataVersion.getState().version });
const original = JSON.stringify({ sampleSavedTours, samplePropertyCatalog, samplePropertyLists, samplePropertyListRows });
let groups = 0;

let main = saved.getSampleSavedTour(mainId), personal = saved.getSampleSavedTour(personalId);
assert.equal(saved.getSampleSavedTours().total, 2); assert.equal(saved.getSampleSavedTours(new URLSearchParams("archived=true")).total, 1);
assert.equal(main.name, "Saturday buyer tour"); assert.equal(main.stops.length, 6); assert.equal(main.sourceList.name, "Saturday tour"); assert(main.stops.every(stop => stop.available));
assert.equal(personal.sourceListId, SAMPLE_PERSONAL_TOUR_LIST_ID); assert.equal(saved.getSampleSavedTour(archivedId).canReview, false);
assert.equal((await contacts.getLead("sample-due-today")).id, main.contactId); // New from Contacts also projects its readable preview link.
assert(!JSON.stringify(saved.getSampleSavedTours()).includes("colleague private tour")); assert(!Object.hasOwn(main, "ownerUserId"));
assert.throws(() => saved.getSampleSavedTour(privateId), error => error.status === 404);
await denied(() => saved.createSampleSavedTour({ ...settings(main), requestId: crypto.randomUUID() }), 403);
await denied(() => saved.scheduleSampleSavedTour(mainId, { requestId: crypto.randomUUID(), expectedUpdatedAt: main.updatedAt, reviewToken: "x".repeat(40) }), 403); groups++;

const beforeRecords = businessState(), oldAppointments = JSON.stringify(readAllSampleShowings());
const readonlyReview = await review(main); assert.equal(readonlyReview.slots.length, 6); assert.equal(readonlyReview.map.kind, "sample");
assert.deepEqual(main.stops.map(stop => stop.mlsNumber), ["SAMPLE-TOUR-1", "SAMPLE-TOUR-6", "SAMPLE-TOUR-2", "SAMPLE-TOUR-5", "SAMPLE-TOUR-3", "SAMPLE-TOUR-4"]);
assert.equal(readonlyReview.recommendation.currentDriveSeconds, 103 * 60); assert.equal(readonlyReview.recommendation.totalDriveSeconds, 38 * 60); assert.equal(readonlyReview.recommendation.savedDriveSeconds, 65 * 60);
assert.equal(JSON.stringify(readAllSampleShowings()), oldAppointments); assert.equal(businessState(), beforeRecords);
assert(!readonlyReview.reviewToken.includes("Saturday")); assert(!readonlyReview.reviewToken.includes("parking"));
const endpointReview = await review(personal);
assert(endpointReview.recommendation.originLeg); assert(endpointReview.recommendation.destinationLeg);
assert.equal(endpointReview.recommendation.originLeg.fromPropertyId, "__origin"); assert.equal(endpointReview.recommendation.destinationLeg.toPropertyId, "__destination");
assert(endpointReview.recommendation.originPoint && endpointReview.recommendation.destinationPoint);
assert.equal(endpointReview.recommendation.totalDriveSeconds, endpointReview.recommendation.legs.reduce((sum, leg) => sum + leg.driveSeconds, 0) + endpointReview.recommendation.originLeg.driveSeconds + endpointReview.recommendation.destinationLeg.driveSeconds);
assert(Date.parse(endpointReview.slots[0].startsAt) > Date.parse(personal.startsAt)); assert.equal(businessState(), beforeRecords); groups++;

mode("interactive"); main = saved.getSampleSavedTour(mainId);
const createInput = Object.freeze({ ...settings(main), name: "Private saved comparison <b>plain text</b>", notes: "  Private research\nwith preserved whitespace.  ", requestId: crypto.randomUUID() }), frozenCreate = JSON.stringify(createInput);
const [created, repeated] = await Promise.all([saved.createSampleSavedTour(createInput), saved.createSampleSavedTour(createInput)]);
assert.equal(created.id, repeated.id); assert.equal(created.notes, createInput.notes); assert.equal(JSON.stringify(createInput), frozenCreate);
await denied(() => saved.createSampleSavedTour({ ...createInput, name: "Different same UUID" }), 409, "request_conflict");
assert(!Object.hasOwn(created, "recommendation")); assert(!Object.hasOwn(created.stops[0], "coordinates"));
assert.equal(saved.getSampleSavedTours().total, 3); groups++;

const staleDraft = Object.freeze({ ...settings(created), name: "Kept stale draft", requestId: crypto.randomUUID(), expectedUpdatedAt: created.updatedAt }), keptDraft = JSON.stringify(staleDraft);
const edited = await update(created, { name: "Renamed comparison", originAddress: "Sample client meeting point", endMode: "return_to_start", endAddress: "Discarded hidden address" });
assert.equal(edited.name, "Renamed comparison"); assert.equal(edited.endAddress, ""); assert.equal(saved.getSampleSavedTour(edited.id).originAddress, "Sample client meeting point");
await denied(() => saved.updateSampleSavedTour(created.id, staleDraft), 409, "conflict"); assert.equal(JSON.stringify(staleDraft), keptDraft);
await denied(() => saved.createSampleSavedTour({ ...createInput, requestId: crypto.randomUUID(), sourceListId: SAMPLE_PRIVATE_LIST_ID }), 409, "source_unavailable");
await denied(() => saved.createSampleSavedTour({ ...createInput, requestId: crypto.randomUUID(), coordinates: { lat: 1, lng: 2 } }), 400, "invalid_saved_tour"); groups++;

const unknown = await update(edited, { originAddress: "Unverified real-world address" }); await denied(() => review(unknown), 422, "unresolved_endpoint");
const endpointTour = await update(unknown, { originAddress: "Sample FortMark office", endMode: "address", endAddress: "Sample coastal meeting point", stops: unknown.stops.map(stop => ({ propertyId: stop.propertyId, visitMinutes: stop.visitMinutes, lockTime: false, linkedShowingId: stop.linkedShowingId })) });
const endpoints = await review(endpointTour), resolved = endpoints.recommendation.resolvedStops, endpointOptions = sampleEndpointOptions(endpointTour, resolved.map(stop => stop.listingId));
const exact = optimizeTour(resolved.map(stop => ({ propertyId: stop.propertyId, visitMinutes: stop.visitMinutes })), sampleRoadMatrix(resolved.map(stop => stop.listingId)), { startPropertyId: endpointTour.firstPropertyId, startsAt: endpointTour.startsAt, bufferMinutes: endpointTour.bufferMinutes, respectAppointments: true, ...endpointOptions.options });
assert(exact.ok); assert.equal(endpoints.recommendation.totalDriveSeconds, exact.value.totalDriveSeconds); assert.deepEqual(endpoints.recommendation.orderedPropertyIds, exact.value.orderedPropertyIds); groups++;

// Locking uses each recorded appointment's real duration, preserving it even
// when the saved draft contains another prospective duration.
const locked = await update(main, { stops: settings(main).stops.map(stop => ({ ...stop, lockTime: true, visitMinutes: 30 })) });
const lockedReview = await review(locked); assert(lockedReview.slots.every(slot => slot.kept));
assert(lockedReview.slots.every(slot => slot.startsAt === slot.currentStartsAt && slot.endsAt === slot.currentEndsAt));
const beforeLocked = JSON.stringify(readAllSampleShowings()), lockedResult = await saved.scheduleSampleSavedTour(locked.id, confirmation(lockedReview));
assert.equal(JSON.stringify(readAllSampleShowings()), beforeLocked); assert(lockedResult.tour.lastScheduledAt); groups++;

main = await update(lockedResult.tour, { stops: settings(lockedResult.tour).stops.map(stop => ({ ...stop, lockTime: false, visitMinutes: 45 })) });
const unlockedReview = await review(main), scheduleInput = Object.freeze(confirmation(unlockedReview)), noTouch = businessState(), beforeCount = readAllSampleShowings().length;
const [scheduled, scheduleReplay] = await Promise.all([saved.scheduleSampleSavedTour(main.id, scheduleInput), saved.scheduleSampleSavedTour(main.id, scheduleInput)]);
assert.deepEqual(scheduled.showingIds, scheduleReplay.showingIds); assert.equal(readAllSampleShowings().length, beforeCount);
for (const slot of unlockedReview.slots) { const current = getSampleShowing(slot.showingId); assert.equal(current.startsAt, slot.startsAt); assert.equal(current.endsAt, slot.endsAt); }
assert.equal(businessState(), noTouch); assert.deepEqual(readSampleContact("sample-due-today").nextAction, readSampleRawContacts().find(contact => contact.id === "sample-due-today").nextAction);
const afterExpiry = new Date(Date.parse(unlockedReview.expiresAt) + 60000);
assert.deepEqual((await saved.scheduleSampleSavedTour(main.id, scheduleInput, afterExpiry)).showingIds, scheduled.showingIds);
await denied(() => saved.scheduleSampleSavedTour(main.id, { ...scheduleInput, reviewToken: `${scheduleInput.reviewToken}tampered` }), 409, "request_conflict"); groups++;

personal = saved.getSampleSavedTour(personalId); const beforeNew = readAllSampleShowings().length, personalReview = await review(personal);
const personalScheduled = await saved.scheduleSampleSavedTour(personal.id, confirmation(personalReview));
assert.equal(readAllSampleShowings().length, beforeNew + 2); assert(personalScheduled.tour.stops.every(stop => stop.linkedShowingId));
const selectedIds = new Set(personalScheduled.showingIds); assert.equal(readAllSampleShowings().filter(showing => selectedIds.has(showing.id)).length, 2); groups++;

main = scheduled.tour; const expires = await review(main), expiredCommand = confirmation(expires), expiryState = JSON.stringify(readAllSampleShowings());
await denied(() => saved.scheduleSampleSavedTour(main.id, expiredCommand, new Date(Date.parse(expires.expiresAt) + 1)), 409, "review_expired");
await denied(() => saved.scheduleSampleSavedTour(main.id, { ...expiredCommand, reviewToken: `${expires.reviewToken.slice(0, -1)}!` }), 409, "stale_review");
assert.equal(JSON.stringify(readAllSampleShowings()), expiryState); groups++;

const staleReview = await review(main), sourceMember = readSampleListPropertyRows(SAMPLE_TOUR_LIST_ID)[0];
replaceSampleListPropertyRows(SAMPLE_TOUR_LIST_ID, readSampleListPropertyRows(SAMPLE_TOUR_LIST_ID).map(member => member.id === sourceMember.id ? { ...member, updatedAt: new Date(Date.parse(member.updatedAt) + 1).toISOString() } : member));
const noPartial = JSON.stringify(readAllSampleShowings()); await denied(() => saved.scheduleSampleSavedTour(main.id, confirmation(staleReview)), 409, "stale_review"); assert.equal(JSON.stringify(readAllSampleShowings()), noPartial);
replaceSampleListPropertyRows(SAMPLE_TOUR_LIST_ID, readSampleListPropertyRows(SAMPLE_TOUR_LIST_ID).map(member => member.id === sourceMember.id ? sourceMember : member)); groups++;

// A new unselected appointment can invalidate the reviewed schedule. The
// failed confirmation must leave every selected appointment untouched.
const conflictReview = await review(main), firstSlot = conflictReview.slots[0];
const conflictStart = new Date(Date.parse(firstSlot.startsAt) - 60000).toISOString();
const outsider = createSampleShowing({ requestId: crypto.randomUUID(), propertyId: sourceMember.id, contactId: main.contactId, startsAt: new Date(Date.parse(main.startsAt) + 86400000 * 3).toISOString(), endsAt: new Date(Date.parse(main.startsAt) + 86400000 * 3 + 1800000).toISOString(), meetingDetails: "", notes: "" });
// Rescheduling the outsider into an occupied selected slot is correctly
// refused by the ordinary showing contract before it can enter the plan.
await denied(() => updateSampleShowing(outsider.id, { requestId: crypto.randomUUID(), action: "reschedule", expectedUpdatedAt: outsider.updatedAt, startsAt: conflictStart, endsAt: firstSlot.endsAt, meetingDetails: "", notes: "" }), 409, "time_conflict");
assert.equal(JSON.stringify(readAllSampleShowings().filter(row => row.id !== outsider.id)), noPartial);
await saved.scheduleSampleSavedTour(main.id, confirmation(conflictReview)); groups++;

const sourceList = readSampleRawPropertyLists().find(list => list.id === SAMPLE_TOUR_LIST_ID);
replaceSamplePropertyList({ ...sourceList, ownerUserId: SAMPLE_COLLEAGUE_ID });
const hidden = saved.getSampleSavedTour(main.id); assert.equal(hidden.sourceList, null); assert(hidden.stops.every(stop => !stop.available && stop.mlsNumber === null)); assert(!JSON.stringify(hidden).includes("Saturday tour"));
await denied(() => saved.scheduleSampleSavedTour(main.id, scheduleInput), 409, "source_unavailable");
replaceSamplePropertyList(sourceList); groups++;

const futureDraft = await saved.createSampleSavedTour({ ...settings(saved.getSampleSavedTour(mainId)), requestId: crypto.randomUUID(), name: "Atomic new visits", startsAt: new Date(Date.parse(main.startsAt) + 10 * 86400000).toISOString(), stops: settings(main).stops.slice(0, 2).map(stop => ({ ...stop, linkedShowingId: null, lockTime: false })) });
const futureReview = await review(futureDraft), blockedSlot = futureReview.slots[0];
const blocking = createSampleShowing({ requestId: crypto.randomUUID(), propertyId: sourceMember.id, contactId: futureDraft.contactId, startsAt: blockedSlot.startsAt, endsAt: blockedSlot.endsAt, meetingDetails: "", notes: "" });
const afterOutsideChange = JSON.stringify(readAllSampleShowings());
await denied(() => saved.scheduleSampleSavedTour(futureDraft.id, confirmation(futureReview)), 409, "time_conflict");
assert.equal(JSON.stringify(readAllSampleShowings()), afterOutsideChange); assert(futureDraft.stops.every(stop => !stop.linkedShowingId));
updateSampleShowing(blocking.id, { requestId: crypto.randomUUID(), expectedUpdatedAt: blocking.updatedAt, action: "cancel", reason: "Release the synthetic conflicting slot." });
const freshFutureReview = await review(futureDraft), countBeforeRace = readAllSampleShowings().length;
const race = await Promise.allSettled([saved.scheduleSampleSavedTour(futureDraft.id, confirmation(freshFutureReview)), saved.scheduleSampleSavedTour(futureDraft.id, confirmation(freshFutureReview))]);
assert.equal(race.filter(item => item.status === "fulfilled").length, 1); assert.equal(race.filter(item => item.status === "rejected" && item.reason.status === 409).length, 1);
assert.equal(readAllSampleShowings().length, countBeforeRace + 2); groups++;

const ownPlan = saved.getSampleSavedTour(personalId), cancelled = getSampleShowing(personalScheduled.showingIds[0]);
updateSampleShowing(cancelled.id, { requestId: crypto.randomUUID(), action: "cancel", expectedUpdatedAt: cancelled.updatedAt, reason: "Sample cancellation." });
await denied(() => review(ownPlan), 409, "invalid_transition");
const archiveInput = { requestId: crypto.randomUUID(), expectedUpdatedAt: ownPlan.updatedAt }, archived = await saved.archiveSampleSavedTour(personalId, archiveInput);
assert(archived.archivedAt); assert.equal((await saved.archiveSampleSavedTour(personalId, archiveInput)).updatedAt, archived.updatedAt);
assert(!saved.getSampleSavedTours().items.some(row => row.id === personalId)); assert(saved.getSampleSavedTours(new URLSearchParams("archived=true")).items.some(row => row.id === personalId)); groups++;

// Draft children require a fresh contact merge review and move without losing
// their private settings or stable saved-tour identity.
const duplicateList = readSampleRawPropertyLists().find(list => list.contactId === DUPLICATE_SOURCE_ID);
const duplicateBase = { ...settings(saved.getSampleSavedTour(mainId)), contactId: DUPLICATE_SOURCE_ID, sourceListId: duplicateList.id, stops: readSampleListPropertyRows(duplicateList.id).map(member => ({ propertyId: member.id, visitMinutes: 30, lockTime: false, linkedShowingId: null })) };
const mergeBefore = await contacts.getContactMergeReview(DUPLICATE_PRIMARY_ID, DUPLICATE_SOURCE_ID);
const mergeInput = row => ({ requestId: crypto.randomUUID(), primaryId: DUPLICATE_PRIMARY_ID, duplicateId: DUPLICATE_SOURCE_ID, expectedPrimaryUpdatedAt: row.primary.updatedAt, expectedDuplicateUpdatedAt: row.duplicate.updatedAt, expectedPrimaryHistoryFingerprint: row.primary.historyFingerprint, expectedDuplicateHistoryFingerprint: row.duplicate.historyFingerprint, choices: row.defaults, nextActionChoice: "primary" });
const mergedDraft = await saved.createSampleSavedTour({ ...duplicateBase, requestId: crypto.randomUUID(), name: "Private draft retained through merge" });
await denied(() => contacts.mergeContacts(mergeInput(mergeBefore)), 409);
const currentMerge = await contacts.getContactMergeReview(DUPLICATE_PRIMARY_ID, DUPLICATE_SOURCE_ID); assert.equal(currentMerge.preservedCounts.savedTours, 1);
await contacts.mergeContacts(mergeInput(currentMerge)); assert.equal(saved.getSampleSavedTour(mergedDraft.id).contactId, DUPLICATE_PRIMARY_ID); groups++;

const http = async (path, method = "GET", value) => { const response = await window.fetch(path, { method, ...(value === undefined ? {} : { body: JSON.stringify(value) }) }); return { status: response.status, body: await response.json() }; };
assert.equal((await http("/api/showing-tours")).status, 200); assert.equal((await http(`/api/showing-tours/${mainId}`)).body.tour.id, mainId);
assert.equal((await http(`/api/showing-tours/${privateId}`)).status, 404);
assert.equal((await http(`/api/showing-tours/${mainId}/review`, "POST", { expectedUpdatedAt: saved.getSampleSavedTour(mainId).updatedAt })).status, 200);
assert.equal((await http("/api/showing-tours?privateName=secret")).status, 400); groups++;

mode("records"); assert.equal(saved.getSampleSavedTours().total, 2); assert.equal(saved.getSampleSavedTour(mainId).name, "Saturday buyer tour");
assert.equal(JSON.stringify({ sampleSavedTours, samplePropertyCatalog, samplePropertyLists, samplePropertyListRows }), original);
assert.throws(() => saved.getSampleSavedTour(created.id), error => error.status === 404);
console.log(`PASS: ${groups} isolated saved-tour groups (private CRUD/reopen, receipts/CAS, sample origin/end road legs, reviewed locked/flexible scheduling, atomic refusal, replay/expiry, source withdrawal, contact merge, transport and reset).`);
