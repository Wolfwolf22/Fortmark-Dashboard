// Read-only route recommendations over explicitly synthetic road data.
import assert from "node:assert/strict";
import { getSampleTourContext, recommendSampleTour } from "./tour-model.mjs";
import { getSampleShowing, readSampleContactShowings, createSampleShowing, updateSampleShowing } from "./showing-model.mjs";
import { SAMPLE_TOUR_SHOWING_ID, SAMPLE_PRIVATE_SHOWING_ID, SAMPLE_UPCOMING_SHOWING_ID, SAMPLE_PAST_PLAN_ID, sampleShowings } from "./showing-fixtures.mjs";
import { SAMPLE_TOUR_LIST_ID, SAMPLE_WATERFRONT_LIST_ID, SAMPLE_PROPERTY_DATASET, samplePropertyLists, samplePropertyListRows, samplePropertyCatalog } from "./property-fixtures.mjs";
import { sampleRoadMatrix } from "./tour-fixtures.mjs";
import { SAMPLE_ACTOR, readSampleContact, readSampleRawContacts, readSampleRawPropertyLists, readSampleListPropertyRows, readSampleTimeline, readSamplePropertyAudits, replaceSampleListPropertyRows, replaceSamplePropertyList } from "./sample-session.mjs";
import { SAMPLE_COLLEAGUE_ID } from "./contact-fixtures.mjs";
import { installPreviewTransport, getPreviewMetrics } from "./fixtures.mjs";
import { useDataVersion } from "../../lib/data/store.ts";
import { businessDayKey } from "../../lib/metrics/business-day.ts";
import { optimizeTour } from "../../lib/showings/tour-optimizer.ts";
import { tourPlanInputSchema } from "../../lib/showings/tour-domain.ts";

globalThis.window = Object.assign(new EventTarget(), { location: { search: "?scenario=records", origin: "http://127.0.0.1:4173" } });
installPreviewTransport();
const mode = value => { window.location.search = `?scenario=${value}&view=%2Fshowings`; };
const denied = (fn, status, code) => assert.rejects(fn, error => error.status === status && (!code || error.code === code));
const plan = (context, values = {}) => ({ selectedPropertyIds: context.stops.map(item => item.propertyId), startPropertyId: context.stops[0].propertyId, startsAt: context.defaultStartsAt, respectAppointments: false, bufferMinutes: 10, returnToStart: false, contextToken: context.contextToken, ...values });
const fixtureSnapshot = JSON.stringify({ sampleShowings, samplePropertyLists, samplePropertyListRows, samplePropertyCatalog });
const state = () => JSON.stringify({ contacts: readSampleRawContacts(), lists: readSampleRawPropertyLists(), properties: readSampleRawPropertyLists().flatMap(list => readSampleListPropertyRows(list.id)), showings: readSampleRawContacts().flatMap(contact => readSampleContactShowings(contact.id)), timeline: readSampleTimeline("sample-due-today"), audits: readSamplePropertyAudits("sample-due-today"), metrics: getPreviewMetrics(new Date("2026-11-02T12:00:00Z")), version: useDataVersion.getState().version });
let groups = 0;

let context = await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID);
assert.equal(context.stops.length, 6); assert.equal(context.totalStops, 6); assert.equal(context.totalScheduledShowings, 6); assert.equal(context.stopsTruncated, false);
assert.equal(context.list.id, SAMPLE_TOUR_LIST_ID); assert.equal(context.list.name, "Saturday tour"); assert.equal(context.map.kind, "sample");
assert.equal(context.availability, "available"); assert.match(context.contextToken, /^[a-f0-9]{64}$/);
assert(context.stops.every(stop => stop.selectable && stop.locationStatus === "available" && stop.coordinates && stop.visitMinutes === 45));
assert(context.stops.every(stop => businessDayKey(new Date(stop.appointment.startsAt)) === context.day));
assert.deepEqual(context.warnings, []); // Map and advisory labels belong to the real UI.
const openedSecond = await getSampleTourContext(context.stops[1].showingId);
assert.equal(openedSecond.defaultStartsAt, context.stops[0].appointment.startsAt); assert.equal(openedSecond.stops[0].showingId, context.stops[0].showingId);
assert(!JSON.stringify(context).includes("Confirm guest parking")); assert(!JSON.stringify(context).includes("feedback")); groups++;

const before = state(), input = Object.freeze(plan(context)), frozen = JSON.stringify(input);
assert(tourPlanInputSchema.safeParse(input).success);
const result = await recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, input);
assert.equal(result.source, "sample"); assert.equal(result.trafficAsOf, null); assert.match(result.trafficLabel, /Sample drive times/);
assert.deepEqual(result.resolvedStops, context.stops);
assert.equal(result.currentDriveSeconds, 103 * 60); assert.equal(result.totalDriveSeconds, 38 * 60); assert.equal(result.savedDriveSeconds, 65 * 60);
assert.deepEqual(result.orderedPropertyIds, [401, 402, 403, 404, 405, 406].map(number => `82000000-0000-4000-8000-${String(number).padStart(12, "0")}`));
assert.equal(JSON.stringify(input), frozen); assert.equal(state(), before); groups++;

const matrix = sampleRoadMatrix(context.stops.map(stop => stop.listingId));
assert.notEqual(matrix[0][1].durationSeconds, matrix[1][0].durationSeconds);
const exact = optimizeTour(context.stops.map(stop => ({ propertyId: stop.propertyId, visitMinutes: stop.visitMinutes, fixedStartsAt: stop.appointment.startsAt })), matrix, input);
assert(exact.ok); assert.deepEqual(result.orderedPropertyIds, exact.value.orderedPropertyIds); assert.equal(result.totalDistanceMeters, exact.value.totalDistanceMeters);
const fixed = await recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, plan(context, { respectAppointments: true }));
assert.deepEqual(fixed.orderedPropertyIds, context.stops.map(stop => stop.propertyId)); assert.equal(fixed.savedDriveSeconds, 0);
assert(fixed.visits.every((visit, index) => visit.fixed && visit.startsAt === context.stops[index].appointment.startsAt));
await denied(() => recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, plan(context, { respectAppointments: true, bufferMinutes: 60 })), 422, "infeasible");
assert.equal(state(), before); groups++;

const automaticOrder = [context.stops[4], context.stops[0], context.stops[1]];
const automaticInput = Object.freeze(plan(context, { selectedPropertyIds: automaticOrder.map(stop => stop.propertyId), startPropertyId: "auto" })), keptAutomatic = JSON.stringify(automaticInput);
const automatic = await recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, automaticInput);
assert.equal(automatic.orderedPropertyIds[0], context.stops[0].propertyId);
assert.notEqual(automatic.orderedPropertyIds[0], automaticInput.selectedPropertyIds[0]);
const automaticExact = optimizeTour(automaticOrder.map(stop => ({ propertyId: stop.propertyId, visitMinutes: stop.visitMinutes, fixedStartsAt: stop.appointment.startsAt })), sampleRoadMatrix(automaticOrder.map(stop => stop.listingId)), automaticInput);
assert(automaticExact.ok); assert.deepEqual(automatic.orderedPropertyIds, automaticExact.value.orderedPropertyIds); assert.equal(automatic.totalDriveSeconds, automaticExact.value.totalDriveSeconds);
const rotated = [...context.stops.slice(2), ...context.stops.slice(0, 2)];
const automaticFixed = await recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, plan(context, { selectedPropertyIds: rotated.map(stop => stop.propertyId), startPropertyId: "auto", respectAppointments: true }));
assert.deepEqual(automaticFixed.orderedPropertyIds, context.stops.map(stop => stop.propertyId));
for (const field of ["currentDriveSeconds", "currentDistanceMeters", "savedDriveSeconds", "savedDistanceMeters"]) assert.equal(automaticFixed[field], null, field);
assert(automaticFixed.warnings.some(text => /savings comparison is unavailable/i.test(text)));
assert.equal(JSON.stringify(automaticInput), keptAutomatic); assert.equal(state(), before); groups++;

const subset = await recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, plan(context, { selectedPropertyIds: context.stops.slice(0, 3).map(stop => stop.propertyId), returnToStart: true }));
assert.equal(subset.orderedPropertyIds.length, 3); assert.equal(subset.legs.length, 3);
assert.equal(subset.legs.at(-1).toPropertyId, context.stops[0].propertyId);
assert.equal(state(), before); groups++;

for (const patch of [{ selectedPropertyIds: [context.stops[0].propertyId] }, { selectedPropertyIds: Array(9).fill(context.stops[0].propertyId) }, { selectedPropertyIds: [context.stops[0].propertyId, context.stops[0].propertyId] }, { startPropertyId: crypto.randomUUID() }, { selectedPropertyIds: [context.stops[0].propertyId, "sample-id"] }, { contextToken: "bad" }, { bufferMinutes: 61 }, { privateField: "forbidden" }]) await denied(() => recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, plan(context, patch)), 400, "invalid_tour_plan");
await denied(() => recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, plan(context, { startsAt: new Date(Date.parse(context.defaultStartsAt) + 86400000).toISOString() })), 400, "invalid_tour_plan");
await denied(() => recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, plan(context, { selectedPropertyIds: [context.stops[0].propertyId, samplePropertyListRows[SAMPLE_WATERFRONT_LIST_ID][0].id] })), 400, "invalid_tour_plan");
assert.equal(state(), before); groups++;

await denied(() => getSampleTourContext(SAMPLE_PRIVATE_SHOWING_ID), 404);
await denied(() => getSampleTourContext(SAMPLE_TOUR_SHOWING_ID, new URLSearchParams("page=0")), 400);
await denied(() => getSampleTourContext(SAMPLE_TOUR_SHOWING_ID, new URLSearchParams("page=1&page=2")), 400);
await denied(() => getSampleTourContext(SAMPLE_TOUR_SHOWING_ID, new URLSearchParams("name=private")), 400);
const one = await getSampleTourContext(SAMPLE_UPCOMING_SHOWING_ID);
assert.equal(one.stops.length, 1); assert.equal(one.stops[0].locationStatus, "available");
assert.equal(one.candidates.total, 2); assert(one.candidates.items.every(stop => !stop.selectable && stop.coordinates === null));
const past = await getSampleTourContext(SAMPLE_PAST_PLAN_ID); assert.equal(past.availability, "past_day"); groups++;

// Recommendation POST is an explicitly requested read even in Records mode.
const http = async (path, method = "GET", value) => { const response = await window.fetch(path, { method, ...(value === undefined ? {} : { body: typeof value === "string" ? value : JSON.stringify(value) }) }); return { status: response.status, body: await response.json() }; };
const httpContext = await http(`/api/showings/${SAMPLE_TOUR_SHOWING_ID}/tour?page=1`); assert.equal(httpContext.status, 200);
const httpPlan = await http(`/api/showings/${SAMPLE_TOUR_SHOWING_ID}/tour`, "POST", plan(httpContext.body)); assert.equal(httpPlan.status, 200); assert.equal(httpPlan.body.source, "sample");
const httpAutomatic = await http(`/api/showings/${SAMPLE_TOUR_SHOWING_ID}/tour`, "POST", automaticInput);
assert.equal(httpAutomatic.status, 200); assert.deepEqual(httpAutomatic.body.orderedPropertyIds, automatic.orderedPropertyIds);
assert.equal((await http(`/dashboard/api/showings/${SAMPLE_TOUR_SHOWING_ID}/tour`)).status, 200);
assert.equal((await http(`/api/showings/${SAMPLE_TOUR_SHOWING_ID}/tour`, "PATCH", {})).status, 405);
assert.equal((await http(`/api/showings/${SAMPLE_TOUR_SHOWING_ID}/tour`, "POST", "{bad")).status, 400);
assert.equal((await http(`/api/showings/${SAMPLE_TOUR_SHOWING_ID}/tour`, "POST", "x".repeat(16385))).status, 400);
assert.equal((await http(`/api/showings/${SAMPLE_TOUR_SHOWING_ID}/tour?unexpected=1`, "POST", input)).status, 400);
assert.equal((await http(`/api/showings/${SAMPLE_PRIVATE_SHOWING_ID}/tour`)).status, 404);
assert.equal((await window.fetch("https://maps.googleapis.com/maps/api/js")).status, 403); assert.equal(state(), before); groups++;

mode("interactive"); context = await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID);
const member = readSampleListPropertyRows(SAMPLE_TOUR_LIST_ID)[0];
replaceSampleListPropertyRows(SAMPLE_TOUR_LIST_ID, readSampleListPropertyRows(SAMPLE_TOUR_LIST_ID).map(row => row.id === member.id ? { ...row, notes: "New private research", updatedAt: new Date(Date.parse(row.updatedAt) + 1).toISOString() } : row));
await denied(() => recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, plan(context)), 409, "stale_context");
const refreshed = await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID); assert.notEqual(refreshed.contextToken, context.contextToken);
assert(!JSON.stringify(refreshed).includes("New private research"));
await recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, plan(refreshed));
replaceSampleListPropertyRows(SAMPLE_TOUR_LIST_ID, readSampleListPropertyRows(SAMPLE_TOUR_LIST_ID).map(row => row.id === member.id ? member : row)); groups++;

context = await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID);
const another = getSampleShowing(context.stops[1].showingId);
updateSampleShowing(another.id, { requestId: crypto.randomUUID(), expectedUpdatedAt: another.updatedAt, action: "update", startsAt: another.startsAt, endsAt: another.endsAt, meetingDetails: "Revised private instruction", notes: another.notes });
await denied(() => recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, plan(context)), 409, "stale_context");
context = await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID); assert(!JSON.stringify(context).includes("Revised private instruction")); groups++;

// Geometry is rechecked but is not a stale snapshot token input.
const listing = samplePropertyCatalog.find(item => item.id === context.stops[1].listingId), point = listing.coordinates;
try {
  listing.addressWithheld = true;
  const withheld = await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID);
  assert.equal(withheld.contextToken, context.contextToken); assert.equal(withheld.stops[1].coordinates, null); assert.equal(withheld.stops[1].locationStatus, "withheld"); assert(!withheld.stops[1].address);
  await denied(() => recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, plan(context)), 409, "unresolved_stops");
} finally { delete listing.addressWithheld; listing.coordinates = point; }
try {
  delete listing.coordinates;
  const unlocated = await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID);
  assert.equal(unlocated.stops[1].locationStatus, "missing_coordinates"); assert.equal(unlocated.stops[1].coordinates, null);
  await denied(() => recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, plan(context)), 409, "unresolved_stops");
} finally { listing.coordinates = point; }
try {
  listing.coordinates = { lat: point.lat + 0.001, lng: point.lng + 0.001 };
  const relocated = await recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, plan(context));
  assert.deepEqual(relocated.resolvedStops.find(stop => stop.listingId === listing.id).coordinates, listing.coordinates);
  assert.equal((await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID)).contextToken, context.contextToken);
} finally { listing.coordinates = point; }
groups++;

const list = readSampleRawPropertyLists().find(item => item.id === SAMPLE_TOUR_LIST_ID);
replaceSamplePropertyList({ ...list, ownerUserId: SAMPLE_COLLEAGUE_ID });
const unavailable = await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID);
assert.equal(unavailable.availability, "source_unavailable"); assert.equal(unavailable.list, null); assert.equal(unavailable.stops.length, 1); assert.equal(unavailable.candidates.total, 0); assert.equal(unavailable.stops[0].selectable, false);
assert(!JSON.stringify(unavailable).includes("Saturday tour")); assert(!JSON.stringify(unavailable).includes("Sample West Garden"));
await denied(() => recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, plan(context)), 409, "source_unavailable");
await denied(() => recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, { ...plan(context), contextToken: unavailable.contextToken }), 409, "source_unavailable");
replaceSamplePropertyList(list); groups++;

for (const loss of ["revision", "owner"]) {
  const openingList = readSampleRawPropertyLists().find(item => item.id === SAMPLE_TOUR_LIST_ID);
  const firstListing = samplePropertyCatalog.find(item => item.id === "sample-tour-property-1"), coordinates = firstListing.coordinates;
  let reads = 0, queued = false;
  Object.defineProperty(firstListing, "coordinates", { configurable: true, enumerable: true, get() {
    if (++reads >= 2 && !queued) { queued = true; queueMicrotask(() => replaceSamplePropertyList({ ...openingList, ...(loss === "owner" ? { ownerUserId: SAMPLE_COLLEAGUE_ID } : { updatedAt: new Date(Date.parse(openingList.updatedAt) + 1).toISOString() }) })); }
    return coordinates;
  } });
  try { await denied(() => getSampleTourContext(SAMPLE_TOUR_SHOWING_ID), 409, loss === "owner" ? "source_unavailable" : "stale_context"); }
  finally { Object.defineProperty(firstListing, "coordinates", { value: coordinates, configurable: true, enumerable: true, writable: true }); replaceSamplePropertyList(openingList); }
}
groups++;

// A provider may finish after scope changes. The final read guard refuses that
// result instead of exposing a recommendation based on its opening snapshot.
for (const loss of ["revision", "owner"]) {
  context = await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID);
  const currentList = readSampleRawPropertyLists().find(item => item.id === SAMPLE_TOUR_LIST_ID);
  const firstListing = samplePropertyCatalog.find(item => item.id === context.stops[0].listingId), coordinates = firstListing.coordinates;
  let reads = 0, queued = false;
  Object.defineProperty(firstListing, "coordinates", { configurable: true, enumerable: true, get() {
    if (++reads >= 2 && !queued) { queued = true; queueMicrotask(() => replaceSamplePropertyList({ ...currentList, ...(loss === "owner" ? { ownerUserId: SAMPLE_COLLEAGUE_ID } : { updatedAt: new Date(Date.parse(currentList.updatedAt) + 1).toISOString() }) })); }
    return coordinates;
  } });
  try { await denied(() => recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, plan(context)), 409, loss === "owner" ? "source_unavailable" : "stale_context"); }
  finally { Object.defineProperty(firstListing, "coordinates", { value: coordinates, configurable: true, enumerable: true, writable: true }); replaceSamplePropertyList(currentList); }
}
groups++;

context = await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID);
const sourceMember = readSampleListPropertyRows(SAMPLE_TOUR_LIST_ID)[0];
replaceSampleListPropertyRows(SAMPLE_TOUR_LIST_ID, readSampleListPropertyRows(SAMPLE_TOUR_LIST_ID).map(row => row.id === sourceMember.id ? { ...row, removedAt: new Date().toISOString() } : row));
const removed = await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID); assert.equal(removed.availability, "available"); assert.equal(removed.stops[0].locationStatus, "removed"); assert.equal(removed.stops[0].selectable, false);
await denied(() => recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, plan(context)), 409, "stale_context");
replaceSampleListPropertyRows(SAMPLE_TOUR_LIST_ID, readSampleListPropertyRows(SAMPLE_TOUR_LIST_ID).map(row => row.id === sourceMember.id ? sourceMember : row)); groups++;

// Multiple appointments for one property remain visible but cannot be silently
// converted into an ambiguous single route visit.
context = await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID);
const last = getSampleShowing(context.stops.at(-1).showingId), startsAt = new Date(Date.parse(last.endsAt) + 3600000).toISOString();
createSampleShowing({ requestId: crypto.randomUUID(), propertyId: context.stops[0].propertyId, contactId: context.contactId, startsAt, endsAt: new Date(Date.parse(startsAt) + 1800000).toISOString(), meetingDetails: "", notes: "" });
const ambiguous = await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID); assert.equal(ambiguous.stops[0].selectionIssue, "multiple_appointments"); assert.equal(ambiguous.stops[0].appointmentCount, 2); assert.equal(ambiguous.stops[0].selectable, false);
await denied(() => recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, plan(ambiguous)), 409, "unresolved_stops"); groups++;

// The context token covers the complete candidate/source set, not a page. A
// bounded initial itinerary still exposes the remaining choices explicitly.
const extraMembers = Array.from({ length: 30 }, (_, index) => ({ ...member, id: crypto.randomUUID(), listingId: `sample-paging-tour-${index + 1}`, mlsNumber: `SAMPLE-PAGING-${index + 1}`, notes: "", removedAt: null }));
replaceSampleListPropertyRows(SAMPLE_TOUR_LIST_ID, [...readSampleListPropertyRows(SAMPLE_TOUR_LIST_ID), ...extraMembers]);
const candidateFirst = await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID), candidateSecond = await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID, new URLSearchParams("page=2"));
assert.equal(candidateFirst.candidates.total, 30); assert.equal(candidateFirst.candidates.items.length, 24); assert.equal(candidateSecond.candidates.items.length, 6);
assert.equal(candidateFirst.contextToken, candidateSecond.contextToken);
assert.equal(new Set([...candidateFirst.candidates.items, ...candidateSecond.candidates.items].map(stop => stop.propertyId)).size, 30);
samplePropertyCatalog.push({ ...samplePropertyCatalog.find(listing => listing.id === context.stops[1].listingId), id: extraMembers[0].listingId, mlsNumber: extraMembers[0].mlsNumber });
try {
  const reachablePoint = await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID);
  await denied(() => recommendSampleTour(SAMPLE_TOUR_SHOWING_ID, plan(reachablePoint, { selectedPropertyIds: [reachablePoint.stops[1].propertyId, extraMembers[0].id], startPropertyId: reachablePoint.stops[1].propertyId })), 422, "unreachable");
} finally { samplePropertyCatalog.pop(); }
for (const [index, membership] of extraMembers.slice(0, 3).entries()) {
  // Derive the next slots from the last appointment instead of depending on
  // the daylight-saving offset used by the test's current calendar date.
  const start = new Date(Date.parse(last.endsAt) + (2 + index) * 3600000).toISOString();
  createSampleShowing({ requestId: crypto.randomUUID(), propertyId: membership.id, contactId: context.contactId, startsAt: start, endsAt: new Date(Date.parse(start) + 900000).toISOString(), meetingDetails: "", notes: "" });
}
const truncated = await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID);
assert.equal(truncated.stops.length, 8); assert.equal(truncated.totalStops, 9); assert.equal(truncated.totalScheduledShowings, 10); assert.equal(truncated.stopsTruncated, true);
assert.equal(truncated.candidates.total, 27); groups++;

mode("records");
assert.equal((await getSampleTourContext(SAMPLE_TOUR_SHOWING_ID)).totalScheduledShowings, 6);
assert.equal(JSON.stringify({ sampleShowings, samplePropertyLists, samplePropertyListRows, samplePropertyCatalog }), fixtureSnapshot);
assert.equal(readSampleContact("sample-due-today").nextAction.purpose.includes("showing"), true); groups++;

console.log(`PASS: ${groups} isolated tour groups (sample map/road matrix, real optimizer, fixed/flexible/open/return route, read-only HTTP, privacy, source/current-snapshot validation, stale drafts, withheld locations, appointment ambiguity and reset).`);
