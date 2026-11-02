// In-memory saved plans and reviewed atomic scheduling. No account, database,
// localStorage, MLS snapshots or provider results are persisted by this harness.
import { createSavedShowingTourInputSchema, updateSavedShowingTourInputSchema, archiveSavedShowingTourInputSchema, reviewSavedShowingTourInputSchema, scheduleSavedShowingTourInputSchema, readSavedShowingToursQuery, SAVED_TOUR_REVIEW_TTL_MS } from "../../lib/showings/saved-tour-domain.ts";
import { canonicalTourFingerprint, validTourCoordinates } from "../../lib/showings/tour-domain.ts";
import { optimizeTour } from "../../lib/showings/tour-optimizer.ts";
import { businessDayKey } from "../../lib/metrics/business-day.ts";
import { sampleSavedTours } from "./saved-tour-fixtures.mjs";
import { SAMPLE_ACTOR, interactiveSamples, readSampleContact, readSampleRawPropertyLists, readSampleListPropertyRows, nextSampleRevision } from "./sample-session.mjs";
import { readAllSampleShowings, checkSampleShowingSchedule, applySampleShowingSchedule, PreviewShowingError } from "./showing-model.mjs";
import { samplePropertyCatalog, samplePropertyProviderStates, SAMPLE_PROPERTY_DATASET } from "./property-fixtures.mjs";
import { sampleRoadMatrix, sampleTourPoints, sampleEndpointOptions } from "./tour-fixtures.mjs";
import { previewPublicRecordId, previewRecordId } from "./import-merge-fixtures.mjs";

const copy = value => structuredClone(value);
const rows = new Map(sampleSavedTours.map(row => [row.id, copy(row)])), receipts = new Map();
let pending = Promise.resolve();
const serialized = work => { const next = pending.then(work, work); pending = next.catch(() => {}); return next; };
const fail = (code, status = 400) => { throw new PreviewShowingError(code, status); };
const all = () => interactiveSamples() ? [...rows.values()] : sampleSavedTours;
const canReadContact = person => person?.recordSource === "db" && (SAMPLE_ACTOR.role === "admin" || person.assignedAgentId === SAMPLE_ACTOR.userId);
function person(id) { const value = readSampleContact(id); if (!canReadContact(value)) fail("not_found", 404); return value; }
function own(id) { const row = all().find(item => item.id === id && item.ownerUserId === SAMPLE_ACTOR.userId); if (!row) fail("not_found", 404); person(row.contactId); return row; }
function source(row, required = false) {
  const list = readSampleRawPropertyLists().find(item => item.id === row.sourceListId && item.ownerUserId === SAMPLE_ACTOR.userId && !item.archivedAt);
  const valid = list && (!list.contactId || canReadContact(readSampleContact(list.contactId)));
  if (!valid && required) fail("source_unavailable", 409);
  return valid ? { list, members: readSampleListPropertyRows(list.id) } : null;
}
function linked(row, stop) { return stop.linkedShowingId ? readAllSampleShowings().find(showing => showing.id === stop.linkedShowingId && showing.ownerUserId === SAMPLE_ACTOR.userId && showing.contactId === person(row.contactId).id && showing.sourcePropertyId === stop.propertyId) : undefined; }
function dto(row) {
  const contact = person(row.contactId), binding = source(row), { ownerUserId, ...value } = row;
  return copy({ ...value, contactId: previewPublicRecordId(contact.id), contactName: contact.name, sourceList: binding ? { id: binding.list.id, name: binding.list.name } : null, day: businessDayKey(new Date(row.startsAt)), canEdit: !row.archivedAt && SAMPLE_ACTOR.role !== "member", canReview: !row.archivedAt && SAMPLE_ACTOR.role !== "member" && Boolean(binding && row.stops.every(stop => binding.members.some(member => member.id === stop.propertyId && !member.removedAt))),
    stops: row.stops.map(stop => { const member = binding?.members.find(item => item.id === stop.propertyId), appointment = binding ? linked(row, stop) : undefined; return { ...stop, available: Boolean(member && !member.removedAt), mlsNumber: member?.mlsNumber || null, listingId: member?.listingId || null, appointment: appointment ? { id: appointment.id, startsAt: appointment.startsAt, endsAt: appointment.endsAt, updatedAt: appointment.updatedAt, status: appointment.status } : null }; }) });
}
export function getSampleSavedTour(id) { return dto(own(id)); }
export function getSampleSavedTours(params = new URLSearchParams()) {
  const normalized = new URLSearchParams(params), contactId = normalized.get("contactId");
  if (contactId && readSampleContact(contactId)) normalized.set("contactId", previewPublicRecordId(readSampleContact(contactId).id));
  const query = readSavedShowingToursQuery(normalized); if (!query) fail("invalid_saved_tour_query");
  if (query.contactId) person(query.contactId);
  const items = all().filter(row => row.ownerUserId === SAMPLE_ACTOR.userId && canReadContact(readSampleContact(row.contactId)) && Boolean(row.archivedAt) === Boolean(query.archived) && (!query.contactId || person(row.contactId).id === person(query.contactId).id) && (!query.sourceListId || row.sourceListId === query.sourceListId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  const pageSize = query.pageSize || 12, page = Math.min(query.page || 1, Math.max(1, Math.ceil(items.length / pageSize)));
  return { items: items.slice((page - 1) * pageSize, page * pageSize).map(dto), total: items.length, page, pageSize };
}
function parse(schema, input) { const value = schema.safeParse(input); if (!value.success) fail("invalid_saved_tour"); return "endMode" in value.data ? { ...value.data, endAddress: value.data.endMode === "address" ? value.data.endAddress : "" } : value.data; }
function writable() { if (!interactiveSamples()) fail("preview_read_only", 403); if (SAMPLE_ACTOR.role === "member") fail("forbidden", 403); }
function revision(row, expected) { if (Date.parse(row.updatedAt) !== Date.parse(expected)) fail("conflict", 409); }
function validateSettings(value) {
  const contact = person(value.contactId), binding = source(value, true);
  for (const stop of value.stops) {
    if (!binding.members.some(member => member.id === stop.propertyId && !member.removedAt)) fail("source_unavailable", 409);
    if (stop.linkedShowingId && !linked({ ...value, contactId: contact.id }, stop)) fail("not_found", 404);
  }
  return { ...value, contactId: contact.id };
}
async function hash(value) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalTourFingerprint(value))))].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
async function replay(input, operation) {
  const receipt = receipts.get(`${SAMPLE_ACTOR.userId}:${input.requestId}`); if (!receipt) return null;
  const row = own(receipt.tourId); if (receipt.showingIds) validateSettings(row);
  if (receipt.operation !== operation || receipt.hash !== await hash(input)) fail("request_conflict", 409);
  const fresh = own(receipt.tourId); if (receipt.showingIds) validateSettings(fresh);
  return receipt.showingIds ? { tour: dto(fresh), showingIds: [...receipt.showingIds] } : dto(fresh);
}
function remember(input, operation, row, payloadHash, showingIds) { receipts.set(`${SAMPLE_ACTOR.userId}:${input.requestId}`, { operation, hash: payloadHash, tourId: row.id, ...(showingIds ? { showingIds } : {}) }); }
function settingsRow(data, current) {
  const { requestId, expectedUpdatedAt, ...value } = data, stamp = current ? nextSampleRevision(current.updatedAt) : new Date().toISOString();
  return { ...current, ...value, id: current?.id || crypto.randomUUID(), ownerUserId: SAMPLE_ACTOR.userId, createdAt: current?.createdAt || stamp, updatedAt: stamp, archivedAt: current?.archivedAt || null, lastScheduledAt: current?.lastScheduledAt || null,
    stops: value.stops.map((stop, position) => ({ ...stop, id: current?.stops.find(item => item.propertyId === stop.propertyId)?.id || crypto.randomUUID(), linkedShowingId: stop.linkedShowingId || null, position, updatedAt: stamp })) };
}
export function createSampleSavedTour(input) { writable(); const value = parse(createSavedShowingTourInputSchema, input); return serialized(async () => { const repeated = await replay(value, "create"); if (repeated) return repeated; const payloadHash = await hash(value), valid = validateSettings(value), row = settingsRow(valid); remember(value, "create", row, payloadHash); rows.set(row.id, row); return dto(row); }); }
export function updateSampleSavedTour(id, input) { writable(); const value = parse(updateSavedShowingTourInputSchema, input); return serialized(async () => { const repeated = await replay(value, `update:${id}`); if (repeated) return repeated; const payloadHash = await hash(value), row = own(id); if (row.archivedAt) fail("invalid_transition", 409); revision(row, value.expectedUpdatedAt); const next = settingsRow(validateSettings(value), row); remember(value, `update:${id}`, next, payloadHash); rows.set(id, next); return dto(next); }); }
export function archiveSampleSavedTour(id, input) { writable(); const value = parse(archiveSavedShowingTourInputSchema, input); return serialized(async () => { const repeated = await replay(value, `archive:${id}`); if (repeated) return repeated; const payloadHash = await hash(value), row = own(id); if (row.archivedAt) fail("conflict", 409); revision(row, value.expectedUpdatedAt); const next = { ...row, archivedAt: new Date().toISOString(), updatedAt: nextSampleRevision(row.updatedAt) }; remember(value, `archive:${id}`, next, payloadHash); rows.set(id, next); return dto(next); }); }
function snapshot(row) { const binding = source(row, true), contact = person(row.contactId); return canonicalTourFingerprint({ row, contact: { id: contact.id, updatedAt: contact.updatedAt }, list: binding.list, members: binding.members, appointments: row.stops.map(stop => linked(row, stop) || null) }); }
const bytes = value => new TextEncoder().encode(value);
const encode = value => btoa(String.fromCharCode(...bytes(JSON.stringify(value)))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const decode = value => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0))));
async function key(id) { return crypto.subtle.importKey("raw", bytes(`synthetic-preview-review-only:${id}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }
async function sign(id, payload) { const value = encode(payload), signature = new Uint8Array(await crypto.subtle.sign("HMAC", await key(id), bytes(value))); return `${value}.${btoa(String.fromCharCode(...signature)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`; }
async function verify(id, value) {
  try { const [payload, signature, extra] = value.split("."); if (!payload || !signature || extra) fail("stale_review", 409); const raw = Uint8Array.from(atob(signature.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0)); if (!await crypto.subtle.verify("HMAC", await key(id), raw, bytes(payload))) fail("stale_review", 409); return decode(payload); } catch { fail("stale_review", 409); }
}
function located(row, stop) {
  const binding = source(row, true), member = binding.members.find(item => item.id === stop.propertyId && !item.removedAt);
  if (!member) fail("source_unavailable", 409);
  const appointment = linked(row, stop);
  if (stop.linkedShowingId && !appointment) fail("stale_review", 409);
  if (appointment && appointment.status !== "scheduled") fail("invalid_transition", 409);
  const state = member.dataset === SAMPLE_PROPERTY_DATASET ? samplePropertyProviderStates[member.mlsNumber] : "not_configured";
  const listing = !state ? samplePropertyCatalog.find(item => item.id === member.listingId && item.mlsNumber === member.mlsNumber) : undefined;
  const coordinates = listing?.coordinates || (["sample-coastal", "sample-courtyard", "sample-condo"].includes(listing?.id) ? sampleTourPoints[listing.id] : null);
  if (!listing || listing.addressWithheld || !validTourCoordinates(coordinates)) fail("unresolved_stops", 409);
  return { propertyId: stop.propertyId, dataset: member.dataset, mlsNumber: member.mlsNumber, listingId: member.listingId, address: listing.address, city: listing.city, coordinates: copy(coordinates), locationStatus: "available", selectable: true,
    ...(appointment ? { showingId: appointment.id, appointment: { startsAt: appointment.startsAt, endsAt: appointment.endsAt, updatedAt: appointment.updatedAt } } : {}), visitMinutes: stop.lockTime && appointment ? (Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)) / 60000 : stop.visitMinutes };
}
function validSlots(row, slots) {
  if (slots.length !== row.stops.length || new Set(slots.map(slot => slot.stopId)).size !== slots.length) return false;
  return slots.every(slot => {
    const stop = row.stops.find(item => item.id === slot.stopId), appointment = stop ? linked(row, stop) : null;
    return stop && slot.propertyId === stop.propertyId && slot.showingId === (stop.linkedShowingId || null) && slot.expectedShowingUpdatedAt === (appointment?.updatedAt || null) && slot.currentStartsAt === (appointment?.startsAt || null) && slot.currentEndsAt === (appointment?.endsAt || null) && slot.kept === stop.lockTime && (!appointment || appointment.status === "scheduled") && businessDayKey(new Date(slot.startsAt)) === businessDayKey(new Date(row.startsAt)) && (stop.lockTime ? appointment && slot.startsAt === appointment.startsAt && slot.endsAt === appointment.endsAt : Date.parse(slot.endsAt) - Date.parse(slot.startsAt) === stop.visitMinutes * 60000);
  });
}
export async function reviewSampleSavedTour(id, input, now = new Date()) {
  if (SAMPLE_ACTOR.role === "member") fail("forbidden", 403);
  const value = parse(reviewSavedShowingTourInputSchema, input), row = own(id); validateSettings(row); revision(row, value.expectedUpdatedAt);
  if (row.archivedAt) fail("invalid_transition", 409);
  if (Date.parse(row.startsAt) <= now.getTime() || Date.parse(row.startsAt) > now.getTime() + 730 * 86400000) fail("invalid_date");
  const opening = snapshot(row), resolved = row.stops.map(stop => located(row, stop));
  const endpoints = sampleEndpointOptions(row, resolved.map(stop => stop.listingId));
  const options = { startPropertyId: row.firstPropertyId, startsAt: row.startsAt, bufferMinutes: row.bufferMinutes, respectAppointments: true, ...endpoints.options };
  const result = optimizeTour(resolved.map((stop, index) => ({ propertyId: stop.propertyId, visitMinutes: stop.visitMinutes, ...(row.stops[index].lockTime ? { fixedStartsAt: stop.appointment.startsAt } : {}) })), sampleRoadMatrix(resolved.map(stop => stop.listingId)), options);
  if (!result.ok) fail(result.reason, result.reason === "invalid_route" ? 400 : 422);
  const slots = result.value.visits.map(visit => { const stop = row.stops.find(item => item.propertyId === visit.propertyId), appointment = linked(row, stop); return { stopId: stop.id, propertyId: stop.propertyId, showingId: appointment?.id || null, expectedShowingUpdatedAt: appointment?.updatedAt || null, currentStartsAt: appointment?.startsAt || null, currentEndsAt: appointment?.endsAt || null, startsAt: visit.startsAt, endsAt: visit.endsAt, kept: Boolean(stop.lockTime) }; });
  if (!validSlots(row, slots)) fail("invalid_route");
  checkSampleShowingSchedule(row.contactId, slots, now);
  const expiresAt = new Date(now.getTime() + SAVED_TOUR_REVIEW_TTL_MS).toISOString(), fingerprint = await hash(opening);
  const reviewToken = await sign(id, { actorId: SAMPLE_ACTOR.userId, tourId: id, expectedUpdatedAt: row.updatedAt, fingerprint, expiresAt, slots });
  if (snapshot(own(id)) !== opening) fail("stale_review", 409);
  return { tourId: id, expectedUpdatedAt: row.updatedAt, reviewToken, expiresAt, slots, map: { kind: "sample" }, recommendation: { ...result.value, ...(endpoints.originPoint ? { originPoint: endpoints.originPoint } : {}), ...(endpoints.destinationPoint ? { destinationPoint: endpoints.destinationPoint } : {}), resolvedStops: resolved, source: "sample", computedAt: now.toISOString(), trafficAsOf: null, trafficLabel: "Sample drive times · no live traffic" } };
}
export function scheduleSampleSavedTour(id, input, now = new Date()) {
  writable(); const value = parse(scheduleSavedShowingTourInputSchema, input);
  return serialized(async () => {
    const repeated = await replay(value, `schedule:${id}`); if (repeated) return repeated;
    const row = own(id); validateSettings(row); if (row.archivedAt) fail("invalid_transition", 409); revision(row, value.expectedUpdatedAt);
    const claims = await verify(id, value.reviewToken);
    if (claims.actorId !== SAMPLE_ACTOR.userId || claims.tourId !== id || claims.expectedUpdatedAt !== row.updatedAt || !Array.isArray(claims.slots)) fail("stale_review", 409);
    if (Date.parse(claims.expiresAt) <= now.getTime()) fail("review_expired", 409);
    if (!validSlots(row, claims.slots)) fail("stale_review", 409);
    const opening = snapshot(row);
    if (await hash(opening) !== claims.fingerprint) fail("stale_review", 409);
    // All awaited work ends before the final snapshot check and the atomic
    // appointment commit. A failed guard never leaves partial synthetic rows.
    const payloadHash = await hash(value);
    if (snapshot(own(id)) !== opening) fail("stale_review", 409);
    const applied = applySampleShowingSchedule(row.contactId, claims.slots, now), byProperty = new Map(applied.map(item => [item.propertyId, item.id]));
    const stamp = nextSampleRevision(row.updatedAt), next = { ...row, updatedAt: stamp, lastScheduledAt: now.toISOString(), stops: row.stops.map(stop => ({ ...stop, linkedShowingId: byProperty.get(stop.propertyId), updatedAt: stamp })) };
    rows.set(id, next); const showingIds = applied.map(item => item.id);
    receipts.set(`${SAMPLE_ACTOR.userId}:${value.requestId}`, { operation: `schedule:${id}`, hash: payloadHash, tourId: id, showingIds });
    return { tour: dto(next), showingIds };
  });
}
export function readSampleContactSavedTours(id) { return copy(all().filter(row => row.contactId === id)); }
export function reparentSampleSavedTours(from, to) { for (const row of rows.values()) if (row.contactId === from) rows.set(row.id, { ...row, contactId: to, updatedAt: nextSampleRevision(row.updatedAt) }); }
