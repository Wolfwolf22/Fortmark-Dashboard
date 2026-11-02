// Read-only synthetic route context. No recommendation changes appointments,
// contact history, saved-property research, versions or persistent storage.
import { tourPlanInputSchema, readTourContextQuery, validTourCoordinates, canonicalTourFingerprint, TOUR_CANDIDATE_PAGE_SIZE, TOUR_MAX_STOPS, TOUR_DEFAULT_VISIT_MINUTES } from "../../lib/showings/tour-domain.ts";
import { optimizeTour } from "../../lib/showings/tour-optimizer.ts";
import { businessDayKey } from "../../lib/metrics/business-day.ts";
import { getSampleShowing, readSampleContactShowings, PreviewShowingError } from "./showing-model.mjs";
import { SAMPLE_ACTOR, readSampleContact, readSampleRawPropertyLists, readSampleListPropertyRows } from "./sample-session.mjs";
import { samplePropertyCatalog, samplePropertyProviderStates, SAMPLE_PROPERTY_DATASET } from "./property-fixtures.mjs";
import { sampleRoadMatrix, sampleTourPoints } from "./tour-fixtures.mjs";

const fail = (code, status = 400) => { throw new PreviewShowingError(code, status); };
const copy = value => structuredClone(value);
const memberKey = member => `${member.dataset}\u0000${member.listingId}\u0000${member.mlsNumber}`;
function scope(id) {
  const showing = getSampleShowing(id), person = readSampleContact(showing.contactId);
  const records = readSampleContactShowings(person.id).filter(item => item.ownerUserId === SAMPLE_ACTOR.userId);
  const clicked = records.find(item => item.id === id), day = businessDayKey(new Date(showing.startsAt));
  const lists = readSampleRawPropertyLists();
  const list = lists.find(item => item.ownerUserId === SAMPLE_ACTOR.userId && !item.archivedAt && readSampleListPropertyRows(item.id).some(member => member.id === showing.sourcePropertyId));
  const linkedContact = list?.contactId ? readSampleContact(list.contactId) : null;
  const canReadList = list && (!list.contactId || linkedContact?.recordSource === "db" && (SAMPLE_ACTOR.role === "admin" || linkedContact.assignedAgentId === SAMPLE_ACTOR.userId));
  const members = canReadList ? readSampleListPropertyRows(list.id) : [];
  const source = members.find(member => member.id === showing.sourcePropertyId);
  const available = Boolean(source && canReadList);
  const active = available ? members.filter(member => !member.removedAt) : [];
  const byId = new Map(members.map(member => [member.id, member]));
  const scheduled = available ? records.filter(item => item.status === "scheduled" && businessDayKey(new Date(item.startsAt)) === day && byId.has(item.sourcePropertyId) && memberKey(byId.get(item.sourcePropertyId)) === memberKey(item)).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id)) : [];
  const snapshot = canonicalTourFingerprint({ actorId: SAMPLE_ACTOR.userId, showing: clicked, contact: { id: person.id, updatedAt: person.updatedAt }, list: available ? list : null, members: available ? members : [], scheduled, available });
  return { showing, person, clicked, list: available ? list : null, day, references: members, active, scheduled, available, snapshot };
}
async function token(snapshot) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot)))].map(value => value.toString(16).padStart(2, "0")).join(""); }
function currentScope(context, id) {
  const latest = scope(id);
  if (context.available && !latest.available) fail("source_unavailable", 409);
  if (latest.snapshot !== context.snapshot) fail("stale_context", 409);
  return latest;
}
function stop(member, appointments = []) {
  const configuredState = member.dataset === SAMPLE_PROPERTY_DATASET ? samplePropertyProviderStates[member.mlsNumber] : "not_configured";
  const listing = !member.removedAt && !configuredState ? samplePropertyCatalog.find(item => item.id === member.listingId && item.mlsNumber === member.mlsNumber) : undefined;
  const point = listing?.coordinates ?? (["sample-coastal", "sample-courtyard", "sample-condo"].includes(listing?.id) ? sampleTourPoints[listing.id] : undefined);
  const locationStatus = member.removedAt ? "removed" : listing?.addressWithheld ? "withheld" : configuredState || (!listing ? "not_found" : !validTourCoordinates(point) ? "missing_coordinates" : "available");
  const appointment = appointments[0], multiple = appointments.length > 1;
  return { propertyId: member.id, dataset: member.dataset, mlsNumber: member.mlsNumber, listingId: member.listingId,
    ...(listing && !listing.addressWithheld ? { address: listing.address, city: listing.city } : {}),
    coordinates: locationStatus === "available" ? copy(point) : null, locationStatus,
    selectable: locationStatus === "available" && !multiple,
    ...(multiple ? { selectionIssue: "multiple_appointments" } : {}),
    ...(appointment ? { showingId: appointment.id, appointmentCount: appointments.length, appointment: { startsAt: appointment.startsAt, endsAt: appointment.endsAt, updatedAt: appointment.updatedAt } } : {}),
    visitMinutes: appointment ? Math.round((Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)) / 60000) : TOUR_DEFAULT_VISIT_MINUTES };
}
function stopsOf(context) {
  const appointments = new Map();
  for (const showing of context.scheduled) appointments.set(showing.sourcePropertyId, [...(appointments.get(showing.sourcePropertyId) || []), showing]);
  const byId = new Map(context.references.map(member => [member.id, member]));
  const ordered = [...new Set(context.scheduled.map(showing => showing.sourcePropertyId))];
  // A clicked historical/cancelled membership still anchors the detail map.
  if (context.available && !ordered.includes(context.clicked.sourcePropertyId)) ordered.push(context.clicked.sourcePropertyId);
  const selected = ordered.map(id => {
    const values = appointments.get(id) || [];
    const prioritized = [...values].sort((a, b) => Number(b.id === context.clicked.id) - Number(a.id === context.clicked.id) || a.startsAt.localeCompare(b.startsAt));
    return stop(byId.get(id), prioritized);
  }).sort((a, b) => (a.appointment?.startsAt || context.clicked.startsAt).localeCompare(b.appointment?.startsAt || context.clicked.startsAt) || a.propertyId.localeCompare(b.propertyId));
  return { scheduled: selected, all: context.active.map(member => stop(member, appointments.get(member.id) || [])) };
}
export async function getSampleTourContext(id, params = new URLSearchParams(), now = new Date()) {
  const query = readTourContextQuery(params); if (!query) fail("invalid_tour_query");
  const context = scope(id), contextToken = await token(context.snapshot);
  currentScope(context, id);
  const { scheduled, all } = stopsOf(context), clicked = scheduled.find(item => item.propertyId === context.clicked.sourcePropertyId);
  const initial = [...scheduled.filter(item => item.propertyId !== context.clicked.sourcePropertyId).slice(0, TOUR_MAX_STOPS - 1), ...(clicked ? [clicked] : [])].sort((a, b) => (a.appointment?.startsAt || context.clicked.startsAt).localeCompare(b.appointment?.startsAt || context.clicked.startsAt) || a.propertyId.localeCompare(b.propertyId));
  const scheduledIds = new Set(context.scheduled.map(item => item.sourcePropertyId));
  const members = new Map(context.active.map(member => [member.id, member]));
  const candidates = all.filter(item => item.propertyId !== context.clicked.sourcePropertyId && !scheduledIds.has(item.propertyId)).sort((a, b) => members.get(a.propertyId).addedAt.localeCompare(members.get(b.propertyId).addedAt) || a.propertyId.localeCompare(b.propertyId));
  const page = Math.min(query.page, Math.max(1, Math.ceil(candidates.length / TOUR_CANDIDATE_PAGE_SIZE)));
  const availability = !context.available ? "source_unavailable" : context.day < businessDayKey(now) ? "past_day" : "available";
  const earliest = initial.filter(item => item.selectable && item.appointment).map(item => item.appointment.startsAt).sort()[0];
  const fallback = { propertyId: context.clicked.sourcePropertyId, showingId: id, dataset: context.clicked.dataset, mlsNumber: context.clicked.mlsNumber, listingId: context.clicked.listingId, coordinates: null, locationStatus: "source_unavailable", selectable: false, visitMinutes: Math.round((Date.parse(context.clicked.endsAt) - Date.parse(context.clicked.startsAt)) / 60000) };
  // Match asynchronous location resolution, then refuse a context whose source
  // scope or stored facts changed while its displayable locations were read.
  await Promise.resolve();
  currentScope(context, id);
  return { showingId: id, contactId: context.showing.contactId, contactName: context.person.name, list: context.list ? { id: context.list.id, name: context.list.name } : null, day: context.day,
    stops: context.available ? initial : [fallback], totalStops: context.available ? scheduled.length : 1, totalScheduledShowings: context.scheduled.length, stopsTruncated: scheduled.length > TOUR_MAX_STOPS,
    candidates: { items: candidates.slice((page - 1) * TOUR_CANDIDATE_PAGE_SIZE, page * TOUR_CANDIDATE_PAGE_SIZE), total: candidates.length, page, pageSize: TOUR_CANDIDATE_PAGE_SIZE },
    availability, contextToken, generatedAt: now.toISOString(), defaultStartsAt: earliest && Date.parse(earliest) > now.getTime() ? earliest : null,
    warnings: [
      ...(initial.some(item => item.selectionIssue === "multiple_appointments") ? ["A property has multiple appointments on this day. Review those appointments separately."] : []),
      ...(scheduled.length > TOUR_MAX_STOPS ? ["Only eight showing properties are displayed. Choose a smaller tour explicitly."] : []),
    ], map: { kind: "sample" } };
}
export async function recommendSampleTour(id, input, now = new Date()) {
  const parsed = tourPlanInputSchema.safeParse(input); if (!parsed.success) fail("invalid_tour_plan");
  const value = parsed.data, context = scope(id);
  if (!context.available) fail("source_unavailable", 409);
  const currentToken = await token(context.snapshot);
  currentScope(context, id);
  if (value.contextToken !== currentToken) fail("stale_context", 409);
  if (context.day < businessDayKey(now) || businessDayKey(new Date(value.startsAt)) !== context.day || Date.parse(value.startsAt) <= now.getTime()) fail("invalid_tour_plan");
  const { all } = stopsOf(context), byId = new Map(all.map(item => [item.propertyId, item]));
  const selected = value.selectedPropertyIds.map(propertyId => byId.get(propertyId));
  if (selected.some(item => !item)) fail("invalid_tour_plan");
  if (selected.some(item => !item.selectable || !item.coordinates)) fail("unresolved_stops", 409);
  const matrix = sampleRoadMatrix(selected.map(item => item.listingId));
  const result = optimizeTour(selected.map(item => ({ propertyId: item.propertyId, visitMinutes: item.visitMinutes, ...(item.appointment ? { fixedStartsAt: item.appointment.startsAt } : {}) })), matrix, value);
  if (!result.ok) fail(result.reason, result.reason === "infeasible" || result.reason === "unreachable" ? 422 : 400);
  // Match the production provider's asynchronous return boundary, then check
  // current scope again before exposing a calculated result.
  await Promise.resolve();
  currentScope(context, id);
  // The UI draws a local illustrative path from authorized stop coordinates.
  // It receives no fabricated road geometry or live traffic claim.
  return { ...result.value, computedAt: now.toISOString(), trafficAsOf: null, trafficLabel: "Sample drive times · no live traffic", source: "sample", resolvedStops: copy(selected) };
}
