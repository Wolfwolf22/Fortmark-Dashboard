import { applyQuery, snapshotOf } from "../../lib/contacts/windows.ts";
import { contactAgents } from "./contact-fixtures.mjs";
import { allPreviewContacts, previewPublicRecordId, previewRecordId } from "./import-merge-fixtures.mjs";
import { visualTransactions } from "./visual-fixtures.mjs";
import { announceReadOnly } from "./read-only.mjs";
import { HISTORY_PAGE_SIZE, decodeHistoryCursor, historyPage } from "../../lib/contacts/history.ts";
import { NEED_STATUS_RANK, decodeNeedCursor, needHistoryPage } from "../../lib/contacts/needs-pagination.ts";
import { clientInfoValuesSchema } from "../../lib/contacts/client-info.ts";
import { createNeedSchema, updateNeedSchema, planNeedUpdate } from "../../lib/contacts/needs.ts";
import { canTransition, isContactStage, CONTACT_STAGE_LABELS, OPEN_PIPELINE_STAGES } from "../../lib/contacts/stages.ts";
import { nextActionMutationSchema, nextActionDayMirror, nextActionSetEvent, checkNextActionDueAt } from "../../lib/contacts/next-action.ts";
import { toTimeline } from "../../lib/contacts/timeline.ts";
import { bumpDataVersion } from "../../lib/data/store.ts";
import { z } from "zod";
import { LeadsError } from "./contact-errors.mjs";
export { LeadsError } from "./contact-errors.mjs";
export { previewContactImport, commitContactImport, getContactDuplicates, getContactMergeReview, mergeContacts } from "./import-merge-adapters.mjs";
export { getContactProperties, lookupContactProperty, addContactProperty, removeContactProperty, getPropertyLists, createPropertyList, getPropertyList, renamePropertyList, getPropertyListProperties, getPropertyListProperty, updatePropertyResearch, transferProperty, lookupPropertyListProperty, addPropertyListProperty, removePropertyListProperty } from "./property-adapters.mjs";
import { SAMPLE_ACTOR, getPreviewScenario, interactiveSamples, canWriteSample, readSampleContacts, readSampleContact, readSampleRawContacts, readSampleNeeds, readSampleNotes, readSampleTransactionIds, readSampleTimeline, replaceSampleContact, replaceSampleNeeds, appendSampleTimeline, nextSampleRevision } from "./sample-session.mjs";

const copy = value => value === undefined ? undefined : structuredClone(value);
const scenario = getPreviewScenario;
const remoteReads = new Set();
const remoteActionReads = new Set();
const remoteProjection = contact => {
  if (scenario() !== "conflict") return contact;
  const companyChanged = remoteReads.has(contact.id);
  const actionChanged = remoteActionReads.has(contact.id);
  if (!companyChanged && !actionChanged) return contact;
  const nextAction = actionChanged ? {
    id: contact.id === "sample-upcoming" ? "50000000-0000-4000-8000-000000000002" : contact.nextAction?.id || "50000000-0000-4000-8000-000000000001",
    kind: contact.nextAction?.kind || "call", purpose: "Synthetic newer action: confirm the revised property shortlist before the next conversation.",
    dueAt: new Date(Date.parse(contact.nextAction?.dueAt || contact.updatedAt) + 3_600_000).toISOString(),
    assigneeId: contact.nextAction?.assigneeId || contact.assignedAgentId,
    assigneeName: contact.nextAction?.assigneeName || contact.assignedAgentName,
  } : contact.nextAction;
  return { ...contact,
    updatedAt: new Date(Date.parse(contact.updatedAt) + 60_000 * (Number(companyChanged) + Number(actionChanged))).toISOString(),
    ...(companyChanged ? { email: "sample.remote-version@example.com", editable: { ...contact.editable, company: "Sample Company - remote version" } } : {}),
    ...(actionChanged ? { nextAction, nextFollowUpDate: nextActionDayMirror(nextAction.dueAt) } : {}),
  };
};
const rows = () => readSampleContacts().map(remoteProjection);
let failedOnce = false;
const readOnly = () => { announceReadOnly(); return Promise.reject(new LeadsError("preview_read_only", 403)); };
export const createLead = readOnly;
export const markContacted = readOnly;
export const logTouch = readOnly;
export const changeFollowUp = readOnly;
export async function updateContact(id, patch) {
  const contact = allPreviewContacts.find(item => item.id === id);
  if (scenario() === "conflict" && contact?.recordSource === "db" && !remoteReads.has(id)) {
    // Select a predefined newer read projection. No draft field is written and
    // the base fixture remains immutable; this only exercises a refused save.
    remoteReads.add(id);
    throw new LeadsError("conflict", 409);
  }
  if (!interactiveSamples()) return readOnly();
  const stored = writable(id);
  const allowed = new Set(["about", "personalDetails", "expectedUpdatedAt"]);
  if (!patch || Object.keys(patch).some(key => !allowed.has(key))) return readOnly();
  if (patch.about === undefined && patch.personalDetails === undefined) throw new LeadsError("invalid", 400);
  revision(stored, patch.expectedUpdatedAt);
  const parsed = clientInfoValuesSchema.safeParse({ about: patch.about === undefined ? stored.about ?? "" : patch.about, personalDetails: patch.personalDetails === undefined ? stored.personalDetails ?? [] : patch.personalDetails });
  if (!parsed.success) throw invalid(parsed.error);
  const changed = ["about", "personalDetails"].filter(key => JSON.stringify(parsed.data[key]) !== JSON.stringify(stored[key] ?? (key === "about" ? "" : [])));
  if (changed.length) {
    replaceSampleContact({ ...stored, ...parsed.data, updatedAt: nextSampleRevision(stored.updatedAt) });
    bumpDataVersion();
  }
  return { lead: copy(readSampleContact(id)), changed };
}
export const addNote = readOnly;
export const deleteNote = readOnly;
function invalid(error) { return new LeadsError("invalid", 400, [...new Set(error.issues.map(issue => String(issue.path[0] || "input")))]); }
function writable(id) {
  if (readSampleRawContacts().find(item => item.id === id)?.mergedIntoContactId) throw new LeadsError("merged_contact", 409);
  const contact = readSampleContact(id);
  if (!contact) throw new LeadsError("not_found", 404);
  if (!canWriteSample(contact)) throw new LeadsError("preview_read_only", 403);
  return contact;
}
function revision(contact, expected) {
  if (!z.string().datetime().safeParse(expected).success) throw new LeadsError("invalid_revision", 400, ["expectedUpdatedAt"]);
  if (Date.parse(expected) !== Date.parse(contact.updatedAt)) throw new LeadsError("conflict", 409);
}
function event(id, type, title, at) { appendSampleTimeline(id, { id: crypto.randomUUID(), type, title, at, by: "Sample Agent" }, undefined, type !== "need"); }
function actionAssignees(contact) {
  if (!contact || contact.recordSource !== "db") return [];
  // The fixture actor is an eligible active Admin; the only other eligible
  // fixture is this contact's active owner. This never grants contact access.
  const eligible = new Set([contact.assignedAgentId, SAMPLE_ACTOR.userId]);
  return copy(contactAgents.filter(agent => eligible.has(agent.id)));
}
export async function getNextActionAssignees(id) { return actionAssignees(readSampleContact(id)); }
function actionEvent(id, eventName, action, at, summary = "") {
  const safeMetadata = { event: eventName, actionId: action.id, kind: action.kind, purpose: action.purpose, dueAt: action.dueAt, assigneeId: action.assigneeId,
    ...(eventName === "next_action_completed" ? { outcome: summary } : {}),
    ...(eventName === "next_action_cancelled" ? { reason: summary } : {}) };
  const items = toTimeline({ activities: [{ id: crypto.randomUUID(), kind: "task", summary, occurredAt: new Date(at), actorUserId: SAMPLE_ACTOR.userId, safeMetadata }], followUpEvents: [], names: new Map(contactAgents.map(agent => [agent.id, agent.name])) });
  items.forEach(item => appendSampleTimeline(id, item));
}
export async function updateNextAction(id, input) {
  id = previewRecordId(id);
  const fixture = allPreviewContacts.find(item => item.id === id);
  if (scenario() === "conflict" && fixture?.recordSource === "db" && !remoteActionReads.has(id)) {
    remoteActionReads.add(id);
    throw new LeadsError("conflict", 409);
  }
  if (!interactiveSamples()) return readOnly();
  const contact = writable(id);
  const parsed = nextActionMutationSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error);
  const command = parsed.data;
  if (Date.parse(command.expectedUpdatedAt) !== Date.parse(contact.updatedAt)) throw new LeadsError("conflict", 409);
  const current = contact.nextAction ?? null;
  const expectedId = command.action === "set" ? command.expectedActionId : command.actionId;
  if (expectedId !== (current?.id ?? null)) throw new LeadsError("conflict", 409);
  const draft = command.action === "cancel" ? undefined : command.next;
  if (draft && !OPEN_PIPELINE_STAGES.includes(contact.stage)) throw new LeadsError("invalid_transition", 409);
  if (draft && !checkNextActionDueAt(draft.dueAt, new Date(), command.action === "set" ? current?.dueAt : undefined).ok) throw new LeadsError("invalid_date", 400, ["dueAt"]);
  const assignees = actionAssignees(contact);
  if (draft && !assignees.some(agent => agent.id === draft.assigneeId)) throw new LeadsError("invalid_assignee", 400, ["assigneeId"]);
  if (command.action !== "set" && !current) throw new LeadsError("conflict", 409);
  const setEvent = command.action === "set" ? nextActionSetEvent(current, command.next) : null;
  if (command.action === "set" && !setEvent) return copy(contact);
  const at = nextSampleRevision(contact.updatedAt);
  const next = draft ? { ...draft, dueAt: new Date(draft.dueAt).toISOString(), id: command.action === "set" && current ? current.id : crypto.randomUUID(), assigneeName: assignees.find(agent => agent.id === draft.assigneeId).name } : null;
  replaceSampleContact({ ...contact, nextAction: next, nextFollowUpDate: next ? nextActionDayMirror(next.dueAt) : undefined, updatedAt: at });
  if (command.action === "set") actionEvent(id, setEvent, next, at);
  if (command.action === "complete") {
    actionEvent(id, "next_action_completed", current, at, command.outcome);
    if (next) actionEvent(id, "next_action_created", next, at);
  }
  if (command.action === "cancel") actionEvent(id, "next_action_cancelled", current, at, command.reason);
  bumpDataVersion();
  return copy(readSampleContact(id));
}
export async function updateLeadStage(id, to, options = {}) {
  if (!interactiveSamples()) return readOnly();
  const contact = writable(id);
  if (!isContactStage(to) || (options.expectedStage !== undefined && !isContactStage(options.expectedStage))) throw new LeadsError("invalid", 400, [!isContactStage(to) ? "stage" : "expectedStage"]);
  if (options.expectedStage !== undefined && contact.stage !== options.expectedStage) throw new LeadsError("conflict", 409);
  if (!canTransition(contact.stage, to)) throw new LeadsError("invalid_transition", 409);
  const updatedAt = nextSampleRevision(contact.updatedAt);
  replaceSampleContact({ ...contact, stage: to, updatedAt });
  event(id, "stage", `Stage changed to ${CONTACT_STAGE_LABELS[to]}`, updatedAt);
  bumpDataVersion();
  return copy(readSampleContact(id));
}
export async function createNeed(id, input) {
  if (!interactiveSamples()) return readOnly();
  writable(id);
  const parsed = createNeedSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error);
  const data = parsed.data;
  const at = new Date().toISOString();
  const need = {
    id: crypto.randomUUID(), kind: data.kind, kindOther: data.kindOther ?? null, status: data.status ?? "active",
    propertyTypes: data.propertyTypes ?? [], propertyTypeOther: data.propertyTypeOther ?? null, areas: data.areas ?? [],
    priceMinCents: data.priceMinCents ?? null, priceMaxCents: data.priceMaxCents ?? null,
    minBeds: data.minBeds ?? null, minBaths: data.minBaths ?? null, minSqft: data.minSqft ?? null,
    targetDate: data.targetDate ?? null, timelineNote: data.timelineNote ?? null, financing: data.financing ?? null,
    financingOther: data.financingOther ?? null, mustHaves: data.mustHaves ?? [], avoid: data.avoid ?? [],
    additionalRequirements: data.additionalRequirements ?? null, createdAt: at, updatedAt: at,
  };
  replaceSampleNeeds(id, [...readSampleNeeds(id), need]);
  event(id, "need", "Client need added", at);
  bumpDataVersion();
  return copy(need);
}
export async function updateNeed(id, needId, patch) {
  if (!interactiveSamples()) return readOnly();
  writable(id);
  const needs = readSampleNeeds(id);
  const current = needs.find(need => need.id === needId);
  if (!current) throw new LeadsError("not_found", 404);
  const parsed = updateNeedSchema.safeParse(patch);
  if (!parsed.success) throw invalid(parsed.error);
  const plan = planNeedUpdate(current, parsed.data);
  if (!plan.ok) throw new LeadsError("invalid_need", 400, [plan.reason === "price" ? "priceMaxCents" : "kindOther", ...(plan.reason === "other" ? ["propertyTypeOther", "financingOther"] : [])]);
  const need = plan.changed.length ? { ...current, ...plan.set, updatedAt: nextSampleRevision(current.updatedAt) } : current;
  if (plan.changed.length) {
    replaceSampleNeeds(id, needs.map(item => item.id === needId ? need : item));
    event(id, "need", plan.status ? `Client need ${plan.status.to}` : "Client need updated", need.updatedAt);
    bumpDataVersion();
  }
  return { need: copy(need), changed: plan.changed };
}
export async function getLeadSource() { return "db"; }
export async function getLead(id) {
  const contact = readSampleContact(id);
  const route = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("view") || "";
  const pickerAlias = contact && previewRecordId(id) !== id && /^\/(showings|property-lists)(\?|$)/.test(route);
  return copy(contact ? { ...remoteProjection(contact), ...(pickerAlias ? { id: previewPublicRecordId(contact.id) } : contact.id !== id ? { requestedContactId: id } : {}) } : undefined);
}
export async function getLeads(filters = {}, range) {
  const result = rows().filter(contact => {
    if (filters.stage?.length && !filters.stage.includes(contact.stage)) return false;
    if (filters.source?.length && !filters.source.includes(contact.source)) return false;
    if (filters.agentId && contact.assignedAgentId !== filters.agentId) return false;
    if (filters.query && !`${contact.name} ${contact.email}`.toLowerCase().includes(filters.query.toLowerCase())) return false;
    return !range || new Date(contact.createdDate) >= range.from && new Date(contact.createdDate) <= range.to;
  });
  return copy(result);
}
export async function getLeadAgents() { return copy(contactAgents); }
export function queryFields(query) {
  const fields = {};
  for (const key of ["stage", "source", "intent"]) if (query[key]?.length) fields[key] = query[key].join(",");
  if (query.agentId) fields.agent = query.agentId;
  for (const key of ["mine", "active"]) if (query[key]) fields[key] = "1";
  for (const key of ["followUp", "lastTouch", "created", "sort", "dir", "page", "pageSize"]) if (query[key]) fields[key] = String(query[key]);
  return fields;
}
export async function getLeadsPage(query) {
  if (scenario() === "unavailable" && !failedOnce) {
    failedOnce = true;
    throw new LeadsError("preview_first_read_unavailable", 503);
  }
  // Production showing forms validate UUIDs before their adapter is called.
  // Project the existing stable aliases only in these isolated picker routes;
  // contact pages and old readable sample links keep their original identity.
  const route = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("view") || "";
  const picker = /^\/(showings|property-lists)(\?|$)/.test(route);
  const contacts = picker ? rows().filter(person => person.recordSource === "db").map(person => ({ ...person, id: previewPublicRecordId(person.id) })) : rows();
  return copy(applyQuery(contacts, query, new Date(), SAMPLE_ACTOR.userId));
}
export async function getLeadSnapshot() { return copy(snapshotOf(rows(), new Date(), SAMPLE_ACTOR.userId)); }
export async function getTimeline(id) { return copy(rows().some(contact => contact.id === id) ? readSampleTimeline(id) : []); }
export async function getNotes(id) { return copy(rows().some(contact => contact.id === id) ? readSampleNotes(id) : []); }
export async function getNeeds(id) { return copy(rows().some(contact => contact.id === id) ? readSampleNeeds(id) : []); }
function historyCursor(cursor) {
  if (!cursor) return undefined;
  const parsed = decodeHistoryCursor(cursor);
  if (!parsed) throw new LeadsError("invalid_cursor", 400);
  return parsed;
}
export async function getTimelinePage(id, cursor) {
  return copy(historyPage(await getTimeline(id), HISTORY_PAGE_SIZE, item => ({ at: item.at, id: item.id }), historyCursor(cursor)));
}
export async function getNotesPage(id, cursor) {
  return copy(historyPage(await getNotes(id), HISTORY_PAGE_SIZE, item => ({ at: item.createdAt, id: item.id }), historyCursor(cursor)));
}
export async function getNeedsPage(id, cursor) {
  const parsed = cursor ? decodeNeedCursor(cursor) : undefined;
  if (cursor && !parsed) throw new LeadsError("invalid_cursor", 400);
  return copy(needHistoryPage(await getNeeds(id), HISTORY_PAGE_SIZE, item => ({ rank: NEED_STATUS_RANK[item.status], at: item.updatedAt, id: item.id }), parsed));
}
export async function getEligibleContacts(query) {
  return copy(rows().filter(contact => contact.stage === "representation" && (!query || contact.name.toLowerCase().includes(query.toLowerCase()))).map(({ id, name }) => ({ id, name })));
}
export async function getLinkedTransactions(id) {
  if (scenario() === "empty") return [];
  const ids = readSampleTransactionIds(id);
  return copy(visualTransactions.filter(deal => ids.includes(deal.id)).map(({ id, address, city, stage }) => ({ id, address, city, stage })));
}
