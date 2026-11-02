// Synthetic memory and real HTTP DTO contracts only. No database or provider.
import assert from "node:assert/strict";
import * as contacts from "./contact-adapters.mjs";
import { installPreviewTransport, getPreviewMetrics, metrics } from "./fixtures.mjs";
import { getSampleShowing, getSampleShowings, getSampleShowingAgenda, getSampleShowingSummary, createSampleShowing, updateSampleShowing, readSampleContactShowings } from "./showing-model.mjs";
import { sampleShowings, SAMPLE_UPCOMING_SHOWING_ID, SAMPLE_PAST_PLAN_ID, SAMPLE_PRIVATE_SHOWING_ID } from "./showing-fixtures.mjs";
import { samplePropertyLists, samplePropertyListRows, SAMPLE_WATERFRONT_LIST_ID, SAMPLE_PERSONAL_RESEARCH_LIST_ID, SAMPLE_PRIVATE_LIST_ID } from "./property-fixtures.mjs";
import { previewPublicRecordId, DUPLICATE_PRIMARY_ID, DUPLICATE_SOURCE_ID } from "./import-merge-fixtures.mjs";
import { SAMPLE_AGENT_ID, SAMPLE_COLLEAGUE_ID } from "./contact-fixtures.mjs";
import { SAMPLE_ACTOR, readSampleContact, readSampleTimeline, readSampleListPropertyRows, readSampleRawPropertyLists, replaceSampleListPropertyRows, replaceSamplePropertyList, replaceSampleContact } from "./sample-session.mjs";
import { createShowingInputSchema } from "../../lib/showings/domain.ts";
import { businessDayKey } from "../../lib/metrics/business-day.ts";
import { businessLocalToUtc, nextActionLocalParts } from "../../lib/contacts/next-action.ts";

globalThis.window = Object.assign(new EventTarget(), { location: { search: "?scenario=records", origin: "http://127.0.0.1:4173" } });
installPreviewTransport();
const mode = value => { window.location.search = `?scenario=${value}&view=${encodeURIComponent("/property-lists")}`; };
const now = new Date(), day = days => new Date(Date.parse(`${businessDayKey(now)}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const at = (days, time = "10:00") => { const value = businessLocalToUtc(day(days), time); assert(value.ok); return value.dueAt; };
const range = extras => new URLSearchParams({ from: at(-5), to: at(35), status: "all", ...extras });
const denied = (fn, status, code) => assert.throws(fn, error => error.status === status && (!code || error.code === code));
const body = (days, extra = {}) => ({ requestId: crypto.randomUUID(), propertyId: samplePropertyListRows[SAMPLE_WATERFRONT_LIST_ID][0].id, contactId: previewPublicRecordId("sample-due-today"), startsAt: at(days), endsAt: new Date(Date.parse(at(days)) + 3600000).toISOString(), meetingDetails: "Meet at the entrance.", notes: "Private planning notes.", ...extra });
const command = (record, action, extra = {}) => ({ requestId: crypto.randomUUID(), expectedUpdatedAt: record.updatedAt, action, ...extra });
const change = (record, days, extra = {}) => command(record, "reschedule", { startsAt: at(days), endsAt: new Date(Date.parse(at(days)) + 3600000).toISOString(), meetingDetails: record.meetingDetails, notes: record.notes, ...extra });
const snapshot = JSON.stringify({ sampleShowings, samplePropertyLists, samplePropertyListRows });
let groups = 0;

const base = getSampleShowings(range());
assert.equal(base.total, 5); assert(!base.items.some(item => item.id === SAMPLE_PRIVATE_SHOWING_ID));
assert.equal(getSampleShowingSummary().total, 2);
assert.equal(getSampleShowing(SAMPLE_UPCOMING_SHOWING_ID).listing.source, "sample");
assert.equal(nextActionLocalParts(getSampleShowing(SAMPLE_UPCOMING_SHOWING_ID).startsAt).time, "10:00");
assert.equal(getSampleShowing(SAMPLE_PAST_PLAN_ID).listing, null);
assert.equal(getSampleShowing(SAMPLE_PAST_PLAN_ID).syncStatus, "unavailable");
assert(!JSON.stringify(base).includes("Private colleague appointment"));
assert(!Object.hasOwn(base.items[0], "ownerUserId"));
assert(!Object.hasOwn(base.items[0].sourceProperty, "notes")); groups++;

denied(() => createSampleShowing(body(5)), 403);
denied(() => updateSampleShowing(SAMPLE_PAST_PLAN_ID, command(getSampleShowing(SAMPLE_PAST_PLAN_ID), "cancel", { reason: "Sample reason" })), 403);
denied(() => getSampleShowing(SAMPLE_PRIVATE_SHOWING_ID), 404);
assert.equal((await window.fetch("https://example.com/api/showings")).status, 403);
assert.equal((await window.fetch("/api/contacts/source")).status, 200);
assert.equal((await window.fetch("/api/private-service", { method: "POST", body: "{}" })).status, 403); groups++;

mode("interactive");
const linked = await contacts.getLead(previewPublicRecordId("sample-due-today"));
assert.equal(linked.id, previewPublicRecordId("sample-due-today"));
const picker = await contacts.getLeadsPage({ page: 1, pageSize: 100, sort: "name", dir: "asc" });
assert(picker.items.every(person => /^[a-f0-9-]{36}$/i.test(person.id) && person.recordSource === "db"));
const linkedPlan = body(5, { contactId: linked.id }); assert(createShowingInputSchema.safeParse(linkedPlan).success);
const personBefore = readSampleContact("sample-due-today"), timelineBefore = readSampleTimeline(personBefore.id).length, activityBefore = JSON.stringify(getPreviewMetrics().activity.data);
const planned = createSampleShowing(linkedPlan);
assert.equal(planned.contactId, linked.id); assert.equal(planned.status, "scheduled");
assert.deepEqual(readSampleContact(personBefore.id), personBefore);
assert.equal(readSampleTimeline(personBefore.id).length, timelineBefore);
assert.equal(JSON.stringify(getPreviewMetrics().activity.data), activityBefore);
assert.equal(getSampleShowingSummary().total, 3); groups++;

const frozen = Object.freeze({ ...linkedPlan });
assert.equal(createSampleShowing(frozen).id, planned.id);
denied(() => createSampleShowing({ ...linkedPlan, notes: "Different request payload" }), 409, "request_conflict");
denied(() => createSampleShowing(body(5)), 409, "time_conflict");
const adjacent = createSampleShowing(body(5, { startsAt: planned.endsAt, endsAt: new Date(Date.parse(planned.endsAt) + 900000).toISOString() }));
assert.notEqual(adjacent.id, planned.id); groups++;

denied(() => createSampleShowing(body(6, { contactId: "sample-due-today" })), 400, "invalid_showing");
denied(() => createSampleShowing(body(6, { contactId: previewPublicRecordId("sample-labeled-fallback") })), 404);
denied(() => createSampleShowing(body(6, { propertyId: samplePropertyListRows[SAMPLE_PRIVATE_LIST_ID][0].id })), 404);
for (const extra of [{ endsAt: new Date(Date.parse(at(6)) + 14 * 60000).toISOString() }, { endsAt: new Date(Date.parse(at(6)) + 241 * 60000).toISOString() }, { startsAt: at(-1), endsAt: at(-1, "11:00") }, { startsAt: at(731), endsAt: at(731, "11:00") }]) denied(() => createSampleShowing(body(6, extra)), 400, "invalid_date");
denied(() => createSampleShowing(body(6, { notes: "x\0" })), 400); groups++;

const rescheduledInput = change(planned, 7), keptDraft = JSON.stringify(rescheduledInput);
const moved = updateSampleShowing(planned.id, rescheduledInput);
assert.equal(moved.startsAt, at(7)); assert.equal(updateSampleShowing(planned.id, rescheduledInput).updatedAt, moved.updatedAt);
denied(() => updateSampleShowing(planned.id, change(planned, 8)), 409, "conflict");
denied(() => updateSampleShowing(planned.id, { ...rescheduledInput, notes: "changed under same receipt" }), 409, "request_conflict");
assert.equal(JSON.stringify(rescheduledInput), keptDraft);
denied(() => updateSampleShowing(planned.id, change(moved, 5, { startsAt: adjacent.startsAt, endsAt: adjacent.endsAt })), 409, "time_conflict");
assert.deepEqual(readSampleContact(personBefore.id), personBefore); groups++;

let past = getSampleShowing(SAMPLE_PAST_PLAN_ID);
past = updateSampleShowing(past.id, command(past, "update", { startsAt: past.startsAt, endsAt: past.endsAt, meetingDetails: "Updated meeting instruction.", notes: "Keep an unrecorded past plan." }));
denied(() => updateSampleShowing(past.id, command(past, "reschedule", { startsAt: past.startsAt, endsAt: past.endsAt, meetingDetails: "", notes: "" })), 400, "invalid_date");
assert.equal(past.status, "scheduled"); assert.equal(readSampleContact(personBefore.id).lastTouchDate, personBefore.lastTouchDate); groups++;

const cancelledInput = command(adjacent, "cancel", { reason: "Client chose another time." });
const cancelled = updateSampleShowing(adjacent.id, cancelledInput);
assert.equal(cancelled.status, "cancelled"); assert.equal(updateSampleShowing(adjacent.id, cancelledInput).updatedAt, cancelled.updatedAt);
denied(() => updateSampleShowing(cancelled.id, command(cancelled, "complete", { visitedAt: now.toISOString(), likes: "", concerns: "", summary: "" })), 409, "invalid_transition");
assert.equal(readSampleTimeline(personBefore.id).length, timelineBefore); groups++;

const sourceOpening = getSampleShowing(moved.id).sourceProperty;
const memberBefore = readSampleListPropertyRows(sourceOpening.listId).find(item => item.id === sourceOpening.id);
replaceSampleListPropertyRows(sourceOpening.listId, readSampleListPropertyRows(sourceOpening.listId).map(item => item.id === sourceOpening.id ? { ...item, updatedAt: new Date(Date.parse(item.updatedAt) + 1).toISOString() } : item));
const completeDraft = command(moved, "complete", { visitedAt: now.toISOString(), likes: "Private likes <strong>plain text</strong>", concerns: "Private concerns", summary: "Private visit summary", reviewStatus: "ruled_out", expectedPropertyUpdatedAt: sourceOpening.updatedAt });
denied(() => updateSampleShowing(moved.id, completeDraft), 409, "property_conflict");
assert.equal(getSampleShowing(moved.id).status, "scheduled"); assert.equal(readSampleTimeline(personBefore.id).length, timelineBefore);
assert.equal(readSampleContact(personBefore.id).lastTouchDate, personBefore.lastTouchDate);
const freshSource = getSampleShowing(moved.id).sourceProperty;
const completeInput = { ...completeDraft, expectedPropertyUpdatedAt: freshSource.updatedAt };
const completed = updateSampleShowing(moved.id, completeInput);
assert.equal(completed.status, "completed"); assert.equal(completed.feedbackLikes, completeDraft.likes);
const memberAfter = readSampleListPropertyRows(freshSource.listId).find(item => item.id === freshSource.id);
assert.equal(memberAfter.reviewStatus, "ruled_out"); assert.equal(memberAfter.notes, memberBefore.notes);
const afterVisit = readSampleContact(personBefore.id);
assert.equal(afterVisit.lastTouchDate, now.toISOString());
assert.deepEqual(afterVisit.nextAction, personBefore.nextAction); assert.equal(afterVisit.nextFollowUpDate, personBefore.nextFollowUpDate); groups++;

assert.equal(updateSampleShowing(moved.id, completeInput).updatedAt, completed.updatedAt);
const visitEvents = readSampleTimeline(personBefore.id).filter(item => item.type === "showing" && item.at === now.toISOString());
assert.equal(visitEvents.length, 1); assert.equal(visitEvents[0].title, "Showing"); assert.equal(visitEvents[0].detail, "Showing completed");
const feed = getPreviewMetrics().activity.data.find(item => item.at === now.toISOString() && item.summary === "Showing completed");
assert(feed); assert.equal(feed.kind, "contact_touch"); assert.equal(feed.subject, personBefore.name);
assert(!JSON.stringify(feed).includes("Private")); assert(!JSON.stringify(feed).includes("SAMPLE-001"));
assert.equal(getSampleShowingSummary().total, 2); groups++;

const offlineBefore = getSampleShowing(past.id), offlineSource = offlineBefore.sourceProperty;
replaceSampleListPropertyRows(offlineSource.listId, readSampleListPropertyRows(offlineSource.listId).map(item => item.id === offlineSource.id ? { ...item, removedAt: now.toISOString(), updatedAt: now.toISOString() } : item));
assert.equal(getSampleShowing(past.id).sourceProperty.removed, true); assert.equal(getSampleShowing(past.id).canUpdatePropertyReview, false);
denied(() => updateSampleShowing(past.id, command(offlineBefore, "complete", { visitedAt: at(-2), likes: "", concerns: "", summary: "", reviewStatus: "shortlisted", expectedPropertyUpdatedAt: offlineSource.updatedAt })), 409, "property_conflict");
const offlineDone = updateSampleShowing(past.id, command(offlineBefore, "complete", { visitedAt: at(-2), likes: "Useful storage", concerns: "", summary: "Private offline feedback" }));
assert.equal(offlineDone.status, "completed"); assert.equal(offlineDone.listing, null);
assert.equal(readSampleContact(personBefore.id).lastTouchDate, now.toISOString()); groups++;

const hiddenPlan = createSampleShowing(body(9, { propertyId: samplePropertyListRows[SAMPLE_PERSONAL_RESEARCH_LIST_ID][0].id }));
const list = readSampleRawPropertyLists().find(item => item.id === SAMPLE_PERSONAL_RESEARCH_LIST_ID);
replaceSamplePropertyList({ ...list, ownerUserId: SAMPLE_COLLEAGUE_ID });
assert.equal(getSampleShowing(hiddenPlan.id).sourceProperty, null);
const hiddenEdited = updateSampleShowing(hiddenPlan.id, change(hiddenPlan, 10));
assert.equal(hiddenEdited.sourceProperty, null);
updateSampleShowing(hiddenPlan.id, command(hiddenEdited, "complete", { visitedAt: at(-3), likes: "", concerns: "", summary: "Still private" }));
replaceSamplePropertyList(list); groups++;

const ownPerson = readSampleContact("sample-quiet"), otherPerson = readSampleContact("sample-colleague-contact");
replaceSampleContact({ ...ownPerson, nextAction: { ...personBefore.nextAction, id: crypto.randomUUID(), assigneeId: SAMPLE_COLLEAGUE_ID, dueAt: at(2) } });
replaceSampleContact({ ...otherPerson, nextAction: { ...otherPerson.nextAction, assigneeId: SAMPLE_AGENT_ID, dueAt: at(2) } });
const agenda = getSampleShowingAgenda(range({ status: "cancelled", pageSize: "1", page: "2" }));
assert.equal(agenda.showings.page, 2); assert.equal(agenda.nextActions.page, 2); assert(agenda.nextActions.total > agenda.showings.total);
const allAgenda = getSampleShowingAgenda(range({ status: "cancelled", pageSize: "24" }));
assert(allAgenda.nextActions.items.some(item => item.contactId === previewPublicRecordId(ownPerson.id) && item.action.assigneeId === SAMPLE_COLLEAGUE_ID));
assert(!allAgenda.nextActions.items.some(item => item.contactId === previewPublicRecordId(otherPerson.id)));
assert.equal(getSampleShowingAgenda(range({ contactId: personBefore.id })).showings.total, getSampleShowingAgenda(range({ contactId: previewPublicRecordId(personBefore.id) })).showings.total);
assert.equal(getSampleShowings(range({ page: "9999" })).page, 1);
replaceSampleContact(ownPerson); replaceSampleContact(otherPerson); groups++;

for (const params of [new URLSearchParams(), range({ from: "bad" }), range({ to: at(100) }), range({ pageSize: "25" }), range({ contactId: "not-a-contact" }), range({ private: "x" })]) denied(() => getSampleShowings(params), 400, "invalid_showing_query");
for (const limit of [0, 13, 1.5]) denied(() => getSampleShowingSummary(limit), 400);
denied(() => updateSampleShowing(SAMPLE_UPCOMING_SHOWING_ID, command(getSampleShowing(SAMPLE_UPCOMING_SHOWING_ID), "complete", { visitedAt: at(1), likes: "", concerns: "", summary: "" })), 400, "invalid_date");
const priorRole = SAMPLE_ACTOR.role; SAMPLE_ACTOR.role = "member";
denied(() => createSampleShowing(body(11)), 403, "forbidden"); SAMPLE_ACTOR.role = priorRole; groups++;

// The same real JSON endpoint shape is used by the unaliased app adapter.
const http = async (path, method = "GET", value) => { const response = await window.fetch(path, { method, ...(value === undefined ? {} : { body: typeof value === "string" ? value : JSON.stringify(value) }) }); return { status: response.status, body: await response.json() }; };
const httpInput = body(12), [first, replayed] = await Promise.all([http("/api/showings", "POST", httpInput), http("/api/showings", "POST", httpInput)]);
assert.equal(first.status, 201); assert.equal(first.body.showing.id, replayed.body.showing.id);
assert.equal((await http(`/dashboard/api/showings/${first.body.showing.id}`)).body.showing.id, first.body.showing.id);
assert.equal((await http(`/api/showings/agenda?${range()}`)).body.nextActions.pageSize, 12);
assert.equal((await http("/api/showings/summary")).status, 200);
assert.equal((await http("/api/showings/summary?limit=03")).status, 400);
assert.equal((await http("/api/showings/summary?limit=1&limit=2")).status, 400);
assert.equal((await http("/api/showings", "POST", "{bad")).status, 400);
assert.equal((await http("/api/showings", "POST", "x".repeat(65537))).status, 400);
assert.equal((await http(`/api/showings/${SAMPLE_PRIVATE_SHOWING_ID}`)).status, 404); groups++;

const firstHttp = first.body.showing, cancel = command(firstHttp, "cancel", { reason: "No longer needed." });
const response = await http(`/api/showings/${firstHttp.id}`, "PATCH", cancel);
assert.equal(response.status, 200); assert.equal(response.body.showing.status, "cancelled");
const frozenHttp = Object.freeze(command(firstHttp, "cancel", { reason: "Kept stale cancellation" })), beforeFrozen = JSON.stringify(frozenHttp);
assert.equal((await http(`/api/showings/${firstHttp.id}`, "PATCH", frozenHttp)).status, 409); assert.equal(JSON.stringify(frozenHttp), beforeFrozen); groups++;

// Showing children participate in merge review and move with canonical contact.
const duplicateList = readSampleRawPropertyLists().find(item => item.contactId === DUPLICATE_SOURCE_ID);
const reviewOpening = await contacts.getContactMergeReview(DUPLICATE_PRIMARY_ID, DUPLICATE_SOURCE_ID);
const mergeInput = review => ({ requestId: crypto.randomUUID(), primaryId: DUPLICATE_PRIMARY_ID, duplicateId: DUPLICATE_SOURCE_ID, expectedPrimaryUpdatedAt: review.primary.updatedAt, expectedDuplicateUpdatedAt: review.duplicate.updatedAt, expectedPrimaryHistoryFingerprint: review.primary.historyFingerprint, expectedDuplicateHistoryFingerprint: review.duplicate.historyFingerprint, choices: review.defaults, nextActionChoice: "primary" });
const duplicatePlan = createSampleShowing(body(14, { propertyId: readSampleListPropertyRows(duplicateList.id)[0].id, contactId: DUPLICATE_SOURCE_ID }));
await assert.rejects(() => contacts.mergeContacts(mergeInput(reviewOpening)), error => error.status === 409);
const reviewed = await contacts.getContactMergeReview(DUPLICATE_PRIMARY_ID, DUPLICATE_SOURCE_ID); assert.equal(reviewed.preservedCounts.showings, 1);
await contacts.mergeContacts(mergeInput(reviewed));
assert.equal(getSampleShowing(duplicatePlan.id).contactId, DUPLICATE_PRIMARY_ID);
assert.equal(readSampleContactShowings(DUPLICATE_SOURCE_ID).length, 0);
assert.equal(getSampleShowingAgenda(range({ contactId: DUPLICATE_PRIMARY_ID })).showings.total, 1); groups++;

mode("records");
assert.equal(getSampleShowings(range()).total, 5); assert.equal(getSampleShowingSummary().total, 2);
assert.equal(JSON.stringify(getPreviewMetrics().activity.data), JSON.stringify(metrics.activity.data));
assert.equal(JSON.stringify({ sampleShowings, samplePropertyLists, samplePropertyListRows }), snapshot);
denied(() => getSampleShowing(planned.id), 404);
assert.equal((await http("/api/showings", "POST", body(15))).status, 403); groups++;

console.log(`PASS: ${groups} isolated showing groups (real DTO transport, UUID linked/picker contacts, owner privacy, dynamic NY schedule, overlap/CAS/receipts, source retention, actual-visit history and touch, optional research atomicity, unchanged next action, independent agenda pagination, Home summary/activity, canonical merge and reset).`);
