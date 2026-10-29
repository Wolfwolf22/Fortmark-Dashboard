// Ephemeral synthetic state for the explicitly selected Interactive samples
// mode. Nothing is sent to a service, account, localStorage or production API.
import { contactNeeds, contactNotes, timelineFor, SAMPLE_AGENT_ID } from "./contact-fixtures.mjs";
import { allPreviewContacts, duplicateNeeds, duplicateNotes, duplicateTimeline, duplicateOpportunities, contactTransactionIds, previewRecordId } from "./import-merge-fixtures.mjs";
import { projectContactNeedSummary } from "../../lib/contacts/needs-summary.ts";

const copy = value => value === undefined ? undefined : structuredClone(value);
const sessionContacts = new Map(allPreviewContacts.map(contact => [contact.id, copy(contact)]));
const fixtureNeeds = { ...contactNeeds, ...duplicateNeeds };
const fixtureNotes = { ...contactNotes, ...duplicateNotes };
const sessionNeeds = new Map(Object.entries(fixtureNeeds).map(([id, needs]) => [id, copy(needs)]));
const sessionNotes = new Map(Object.entries(fixtureNotes).map(([id, notes]) => [id, copy(notes)]));
const sessionTimeline = new Map();
const sessionHomeEventIds = new Set();
const auditHistoryIds = new Set();
const sessionActivitySummaries = new Map();
const sessionHistory = new Map();
const sessionLinks = new Map(Object.entries(contactTransactionIds).map(([id, ids]) => [id, copy(ids)]));
const sessionOpportunities = new Map();
const receipts = new Map();

export const SAMPLE_ACTOR = { userId: SAMPLE_AGENT_ID, role: "admin", brokerageKey: "design-preview" };
export function getPreviewScenario() {
  return typeof window === "undefined" ? "records" : new URLSearchParams(window.location.search).get("scenario") || "records";
}
export const interactiveSamples = () => getPreviewScenario() === "interactive";
export const canWriteSample = contact => interactiveSamples() && SAMPLE_ACTOR.role === "admin" && contact?.recordSource === "db";

function legacyOpportunities(contact) {
  const kinds = { buy: ["buyer"], sell: ["seller"], both: ["buyer", "seller"], lease: ["tenant"], invest: ["investor"], other: [] }[contact.intent] || [];
  return kinds.map((kind, index) => ({ id: `${contact.id}-legacy-${index}`, kind, status: "open", area: contact.neighborhood || null, budgetMaxCents: contact.budget == null ? null : Math.round(contact.budget * 100), createdAt: new Date(contact.createdDate) }));
}
export function readSampleNeeds(id) {
  return copy(interactiveSamples() ? sessionNeeds.get(id) || [] : fixtureNeeds[id] || []);
}
export function readSampleNotes(id) { return copy(interactiveSamples() ? sessionNotes.get(id) || [] : fixtureNotes[id] || []); }
export function readSampleTransactionIds(id) { return copy(interactiveSamples() ? sessionLinks.get(id) || [] : contactTransactionIds[id] || []); }
export function readSampleOpportunities(id) {
  const contact = readSampleRawContacts().find(item => item.id === id);
  return copy(interactiveSamples() && sessionOpportunities.has(id) ? sessionOpportunities.get(id) : duplicateOpportunities[id] || (contact ? legacyOpportunities(contact) : []));
}
function project(contact) {
  if (contact.recordSource === "sample") return copy(contact);
  const needs = readSampleNeeds(contact.id).map(need => ({ ...need, createdAt: new Date(need.createdAt), updatedAt: new Date(need.updatedAt) }));
  const opportunities = readSampleOpportunities(contact.id).map(item => ({ ...item, createdAt: new Date(item.createdAt) }));
  const summary = projectContactNeedSummary(needs, opportunities);
  return { ...copy(contact), intent: summary.intent, budget: summary.budgetMaxCents == null ? undefined : summary.budgetMaxCents / 100, neighborhood: summary.areas.join(" · ") || undefined };
}
export function readSampleContacts() {
  if (getPreviewScenario() === "empty") return [];
  return readSampleRawContacts().filter(contact => !contact.mergedIntoContactId).map(project);
}
export function readSampleRawContacts() { return copy(interactiveSamples() ? [...sessionContacts.values()] : allPreviewContacts); }
export function readSampleContact(id) {
  if (getPreviewScenario() === "empty") return undefined;
  id = previewRecordId(id);
  const raw = readSampleRawContacts(); const seen = new Set(); let contact = raw.find(item => item.id === id);
  while (contact?.mergedIntoContactId && !seen.has(contact.id)) { seen.add(contact.id); contact = raw.find(item => item.id === contact.mergedIntoContactId); }
  return contact && !contact.mergedIntoContactId ? project(contact) : undefined;
}
export function readSampleTimeline(id) {
  const base = duplicateTimeline[id] || timelineFor(id);
  return copy([...(interactiveSamples() ? sessionTimeline.get(id) || [] : []), ...(interactiveSamples() && sessionHistory.has(id) ? sessionHistory.get(id) : base)]);
}
export function readSampleActivities(id) { return readSampleTimeline(id).filter(item => !auditHistoryIds.has(item.id)); }
/** Home receives controlled task titles, not private purpose/outcome details. */
export function readSampleActionActivity() {
  if (!interactiveSamples()) return [];
  return [...sessionContacts.values()].filter(contact => !contact.mergedIntoContactId).flatMap(contact => {
    const id = contact.id;
    return readSampleTimeline(id).filter(item => sessionHomeEventIds.has(item.id)).map(item => ({
      id: `contact:${item.id}`, kind: item.type === "created" ? "contact_created" : item.type === "stage" ? "contact_stage_changed" : "contact_task", summary: item.type === "created" ? `${contact.name} added` : sessionActivitySummaries.get(item.id) || item.title,
      subject: contact.name, at: item.at, href: `/contacts?open=${encodeURIComponent(id)}`,
    }));
  });
}
export function replaceSampleContact(contact) { sessionContacts.set(contact.id, copy(contact)); }
export function replaceSampleNeeds(id, needs) { sessionNeeds.set(id, copy(needs)); }
export function replaceSampleNotes(id, notes) { sessionNotes.set(id, copy(notes)); }
export function replaceSampleTransactionIds(id, ids) { sessionLinks.set(id, copy(ids)); }
export function replaceSampleOpportunities(id, items) { sessionOpportunities.set(id, copy(items)); }
export function replaceSampleTimeline(id, items) { sessionHistory.set(id, copy(items)); sessionTimeline.set(id, []); }
export function readSampleReceipt(kind, requestId) { return copy(receipts.get(`${kind}:${requestId}`)); }
export function replaceSampleReceipt(kind, requestId, receipt) { receipts.set(`${kind}:${requestId}`, copy(receipt)); }
export function appendSampleTimeline(id, item, activitySummary, activityRecord = true) {
  if (!activityRecord) auditHistoryIds.add(item.id);
  if (activityRecord && ["task", "created", "stage"].includes(item.type)) sessionHomeEventIds.add(item.id);
  if (activitySummary) sessionActivitySummaries.set(item.id, activitySummary);
  sessionTimeline.set(id, [copy(item), ...(sessionTimeline.get(id) || [])]);
}
export function nextSampleRevision(previous) {
  return new Date(Math.max(Date.now(), Date.parse(previous || "1970-01-01T00:00:00.000Z") + 1)).toISOString();
}
