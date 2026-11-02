// Memory-only showing plans. The real client adapter calls this through the
// isolated fetch transport; there is no service or persistence fallback.
import { createShowingInputSchema, showingMutationSchema, readShowingQuery, checkShowingSchedule, checkShowingVisit, showingsOverlap } from "../../lib/showings/domain.ts";
import { sampleShowings, sampleShowingTimelineItem } from "./showing-fixtures.mjs";
import { samplePropertyCatalog, samplePropertyProviderStates, SAMPLE_PROPERTY_DATASET } from "./property-fixtures.mjs";
import { previewPublicRecordId, previewRecordId } from "./import-merge-fixtures.mjs";
import { SAMPLE_ACTOR, interactiveSamples, readSampleContact, readSampleContacts, readSampleRawPropertyLists, readSampleListPropertyRows, replaceSampleListPropertyRows, replaceSamplePropertyList, replaceSampleContact, appendSampleTimeline, appendSamplePropertyAudit, nextSampleRevision } from "./sample-session.mjs";

const copy = value => structuredClone(value);
const records = new Map(sampleShowings.map(value => [value.id, copy(value)]));
const receipts = new Map();
export class PreviewShowingError extends Error { constructor(code, status = 400, fields = []) { super(code); this.code = code; this.status = status; this.fields = fields; } }
const fail = (code, status = 400, fields) => { throw new PreviewShowingError(code, status, fields); };
const all = () => interactiveSamples() ? [...records.values()] : sampleShowings;
const visible = value => value?.recordSource === "db" && (SAMPLE_ACTOR.role === "admin" || value.assignedAgentId === SAMPLE_ACTOR.userId);
function contact(id) { const value = readSampleContact(id); if (!visible(value)) fail("not_found", 404); return value; }
function own(id) { const value = all().find(item => item.id === id && item.ownerUserId === SAMPLE_ACTOR.userId); if (!value) fail("not_found", 404); contact(value.contactId); return value; }
function source(id) {
  for (const list of readSampleRawPropertyLists()) {
    const member = readSampleListPropertyRows(list.id).find(item => item.id === id);
    if (member) return { list, member };
  }
  return null;
}
function accessibleSource(id) {
  const result = source(id);
  if (!result || result.list.ownerUserId !== SAMPLE_ACTOR.userId || result.list.archivedAt) return null;
  if (result.list.contactId && !visible(readSampleContact(result.list.contactId))) return null;
  return result;
}
function dto(record) {
  const person = contact(record.contactId), linked = accessibleSource(record.sourcePropertyId);
  const configuredState = record.dataset === SAMPLE_PROPERTY_DATASET ? samplePropertyProviderStates[record.mlsNumber] : "not_configured";
  const listing = !configuredState ? samplePropertyCatalog.find(item => item.id === record.listingId && item.mlsNumber === record.mlsNumber) || null : null;
  const { ownerUserId, completionActivityId, ...value } = record;
  const pending = record.status === "scheduled" && SAMPLE_ACTOR.role !== "member";
  return copy({ ...value, contactId: previewPublicRecordId(person.id), contactName: person.name,
    sourceProperty: linked ? { id: linked.member.id, listId: linked.list.id, listName: linked.list.name, removed: Boolean(linked.member.removedAt), reviewStatus: linked.member.reviewStatus, updatedAt: linked.member.updatedAt } : null,
    canEdit: pending, canComplete: pending, canCancel: pending, canUpdatePropertyReview: pending && Boolean(linked && !linked.member.removedAt),
    listing, syncStatus: configuredState || (listing ? "available" : "not_found"), checkedAt: new Date().toISOString() });
}
export function getSampleShowing(id) { return dto(own(id)); }
const ownVisible = () => all().filter(item => item.ownerUserId === SAMPLE_ACTOR.userId && visible(readSampleContact(item.contactId)));
function page(items, query, preservePage = true) { const pageSize = query.pageSize || 12, requested = query.page || 1, number = preservePage ? requested : Math.min(requested, Math.max(1, Math.ceil(items.length / pageSize))); return { items: items.slice((number - 1) * pageSize, number * pageSize), total: items.length, page: number, pageSize }; }
function queryOf(params) {
  const normalized = new URLSearchParams(params), rawId = normalized.get("contactId");
  // Contacts retains readable fixture links. Bridge only a known fixture ID at
  // this preview boundary before applying the unchanged UUID query contract.
  if (rawId && readSampleContact(rawId)) normalized.set("contactId", previewPublicRecordId(readSampleContact(rawId).id));
  const query = readShowingQuery(normalized); if (!query) fail("invalid_showing_query"); if (query.contactId) contact(query.contactId); return query;
}
function inWindow(at, query) { return Date.parse(at) >= Date.parse(query.from) && Date.parse(at) < Date.parse(query.to); }
export function getSampleShowings(params, preservePage = false) {
  const query = queryOf(params), rawId = query.contactId ? previewRecordId(query.contactId) : null;
  return page(ownVisible().filter(item => (!rawId || readSampleContact(item.contactId)?.id === readSampleContact(rawId)?.id) && (query.status === "all" || item.status === query.status) && Date.parse(item.startsAt) < Date.parse(query.to) && Date.parse(item.endsAt) > Date.parse(query.from)).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id)).map(dto), query, preservePage);
}
export function getSampleShowingAgenda(params) {
  const query = queryOf(params), rawId = query.contactId ? previewRecordId(query.contactId) : null;
  const actions = readSampleContacts().filter(person => person.recordSource === "db" && person.assignedAgentId === SAMPLE_ACTOR.userId && (!rawId || person.id === readSampleContact(rawId)?.id) && person.nextAction && inWindow(person.nextAction.dueAt, query))
    .map(person => ({ contactId: previewPublicRecordId(person.id), contactName: person.name, action: copy(person.nextAction) })).sort((a, b) => a.action.dueAt.localeCompare(b.action.dueAt) || a.contactId.localeCompare(b.contactId));
  return { showings: getSampleShowings(params, true), nextActions: page(actions, query) };
}
export function getSampleShowingSummary(limit = 3, now = new Date()) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 12) fail("invalid_showing_query");
  const items = ownVisible().filter(item => item.status === "scheduled" && Date.parse(item.endsAt) > now.getTime() && Date.parse(item.startsAt) < now.getTime() + 30 * 86400000).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
  return { items: items.slice(0, limit).map(dto), total: items.length };
}
function writable() { if (!interactiveSamples()) fail("preview_read_only", 403); if (SAMPLE_ACTOR.role === "member") fail("forbidden", 403); }
function parse(schema, input) { const parsed = schema.safeParse(input); if (!parsed.success) fail("invalid_showing", 400, [...new Set(parsed.error.issues.map(issue => String(issue.path[0] || "input")))]); return parsed.data; }
function overlap(schedule, exceptId) { if (ownVisible().some(item => item.id !== exceptId && item.status === "scheduled" && showingsOverlap(item, schedule))) fail("time_conflict", 409); }
function replay(input, operation) {
  const prior = receipts.get(input.requestId); if (!prior) return null;
  // Scope is checked again before exposing a saved receipt or payload conflict.
  own(prior.showingId);
  if (operation !== prior.operation || JSON.stringify(input) !== prior.payload) fail("request_conflict", 409);
  return getSampleShowing(prior.showingId);
}
function remember(input, operation, record) { records.set(record.id, copy(record)); receipts.set(input.requestId, { operation, payload: JSON.stringify(input), showingId: record.id }); return dto(record); }
export function createSampleShowing(input, now = new Date()) {
  writable(); const value = parse(createShowingInputSchema, input);
  const repeated = replay(value, "create"); if (repeated) return repeated;
  const person = contact(value.contactId), linked = accessibleSource(value.propertyId);
  if (!linked || linked.member.removedAt) fail("not_found", 404);
  if (!checkShowingSchedule(value, now)) fail("invalid_date");
  overlap(value);
  const at = now.toISOString();
  return remember(value, "create", { id: crypto.randomUUID(), ownerUserId: SAMPLE_ACTOR.userId, contactId: person.id, sourcePropertyId: linked.member.id, dataset: linked.member.dataset, listingId: linked.member.listingId, mlsNumber: linked.member.mlsNumber,
    startsAt: new Date(value.startsAt).toISOString(), endsAt: new Date(value.endsAt).toISOString(), meetingDetails: value.meetingDetails, notes: value.notes, status: "scheduled", feedbackLikes: "", feedbackConcerns: "", feedbackSummary: "", visitedAt: null, cancelReason: "", createdAt: at, updatedAt: at });
}
export function updateSampleShowing(id, input, now = new Date()) {
  writable(); const value = parse(showingMutationSchema, input), current = own(id);
  const repeated = replay(value, `update:${id}`); if (repeated) return repeated;
  if (Date.parse(value.expectedUpdatedAt) !== Date.parse(current.updatedAt)) fail("conflict", 409);
  if (current.status !== "scheduled") fail("invalid_transition", 409);
  const at = nextSampleRevision(current.updatedAt); let next = { ...current, updatedAt: at };
  if (value.action === "update" || value.action === "reschedule") {
    if (!checkShowingSchedule(value, now, value.action === "update" ? current : undefined)) fail("invalid_date");
    overlap(value, id);
    next = { ...next, startsAt: new Date(value.startsAt).toISOString(), endsAt: new Date(value.endsAt).toISOString(), meetingDetails: value.meetingDetails, notes: value.notes };
  } else if (value.action === "cancel") next = { ...next, status: "cancelled", cancelReason: value.reason };
  else {
    if (!checkShowingVisit(value.visitedAt, now)) fail("invalid_date");
    const person = contact(current.contactId), linked = accessibleSource(current.sourcePropertyId);
    if (value.reviewStatus !== undefined) {
      if (!linked || linked.member.removedAt || linked.member.dataset !== current.dataset || linked.member.listingId !== current.listingId) fail("property_conflict", 409);
      if (Date.parse(linked.member.updatedAt) !== Date.parse(value.expectedPropertyUpdatedAt)) fail("property_conflict", 409);
      const member = { ...linked.member, reviewStatus: value.reviewStatus, updatedAt: nextSampleRevision(linked.member.updatedAt) };
      replaceSampleListPropertyRows(linked.list.id, readSampleListPropertyRows(linked.list.id).map(item => item.id === member.id ? member : item));
      replaceSamplePropertyList({ ...linked.list, updatedAt: nextSampleRevision(linked.list.updatedAt) });
      appendSamplePropertyAudit(linked.list, member.id, "research", ["reviewStatus"]);
    }
    const visitedAt = new Date(value.visitedAt).toISOString(), activityId = crypto.randomUUID();
    const lastTouchDate = [person.lastTouchDate, visitedAt].filter(Boolean).sort().at(-1);
    replaceSampleContact({ ...person, lastTouchDate, lastContactDate: lastTouchDate, updatedAt: nextSampleRevision(person.updatedAt) });
    appendSampleTimeline(person.id, sampleShowingTimelineItem(activityId, current.id, current.sourcePropertyId, visitedAt));
    next = { ...next, status: "completed", visitedAt, feedbackLikes: value.likes, feedbackConcerns: value.concerns, feedbackSummary: value.summary, completionActivityId: activityId };
  }
  return remember(value, `update:${id}`, next);
}
export function getSampleShowingActivity() {
  return ownVisible().filter(item => item.status === "completed" && item.visitedAt).map(item => ({ id: `contact:${item.completionActivityId}`, kind: "contact_touch", summary: "Showing completed", subject: contact(item.contactId).name, at: item.visitedAt, href: `/contacts?open=${encodeURIComponent(contact(item.contactId).id)}` }));
}
export function readSampleContactShowings(id) { return copy(all().filter(item => item.contactId === id)); }
export function reparentSampleShowings(from, to) { for (const value of records.values()) if (value.contactId === from) records.set(value.id, { ...value, contactId: to }); }
export function readAllSampleShowings() { return copy(all()); }
/** Validate every reviewed slot before changing any synthetic appointment. */
export function checkSampleShowingSchedule(contactId, slots, now = new Date()) {
  const person = contact(contactId), existingIds = new Set(slots.flatMap(slot => slot.showingId ? [slot.showingId] : []));
  const planned = slots.map(slot => {
    const linked = accessibleSource(slot.propertyId);
    if (!linked || linked.member.removedAt) fail("source_unavailable", 409);
    const current = slot.showingId ? own(slot.showingId) : null;
    if (current && (current.contactId !== person.id || current.sourcePropertyId !== slot.propertyId || current.dataset !== linked.member.dataset || current.listingId !== linked.member.listingId)) fail("stale_review", 409);
    if (current && current.status !== "scheduled") fail("invalid_transition", 409);
    if (current && Date.parse(current.updatedAt) !== Date.parse(slot.expectedShowingUpdatedAt)) fail("stale_review", 409);
    if (slot.kept && (!current || current.startsAt !== slot.startsAt || current.endsAt !== slot.endsAt)) fail("stale_review", 409);
    if (!checkShowingSchedule(slot, now, slot.kept ? current : undefined)) fail("invalid_date");
    return { slot, current, linked };
  });
  for (const [index, value] of planned.entries()) {
    if (planned.slice(index + 1).some(other => showingsOverlap(value.slot, other.slot)) || all().some(other => other.ownerUserId === SAMPLE_ACTOR.userId && other.status === "scheduled" && !existingIds.has(other.id) && showingsOverlap(value.slot, other))) fail("time_conflict", 409);
  }
  return { person, planned };
}
export function applySampleShowingSchedule(contactId, slots, now = new Date()) {
  writable(); const { person, planned } = checkSampleShowingSchedule(contactId, slots, now);
  const next = planned.map(({ slot, current, linked }) => {
    if (slot.kept) return current;
    const stamp = current ? nextSampleRevision(current.updatedAt) : now.toISOString();
    return current ? { ...current, startsAt: slot.startsAt, endsAt: slot.endsAt, updatedAt: stamp } : { id: crypto.randomUUID(), ownerUserId: SAMPLE_ACTOR.userId, contactId: person.id, sourcePropertyId: linked.member.id, dataset: linked.member.dataset, listingId: linked.member.listingId, mlsNumber: linked.member.mlsNumber, startsAt: slot.startsAt, endsAt: slot.endsAt, meetingDetails: "", notes: "", status: "scheduled", feedbackLikes: "", feedbackConcerns: "", feedbackSummary: "", visitedAt: null, cancelReason: "", createdAt: stamp, updatedAt: stamp };
  });
  next.forEach(item => records.set(item.id, copy(item)));
  return next.map(item => ({ id: item.id, propertyId: item.sourcePropertyId, updatedAt: item.updatedAt }));
}
