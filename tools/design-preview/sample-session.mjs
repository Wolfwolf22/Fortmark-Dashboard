// Ephemeral synthetic state for the explicitly selected Interactive samples
// mode. Nothing is sent to a service, account, localStorage or production API.
import { previewContacts, contactNeeds, timelineFor } from "./contact-fixtures.mjs";
import { projectContactNeedSummary } from "../../lib/contacts/needs-summary.ts";

const copy = value => value === undefined ? undefined : structuredClone(value);
const sessionContacts = new Map(previewContacts.map(contact => [contact.id, copy(contact)]));
const sessionNeeds = new Map(Object.entries(contactNeeds).map(([id, needs]) => [id, copy(needs)]));
const sessionTimeline = new Map();

export const SAMPLE_ACTOR = { userId: "sample-agent", role: "admin", brokerageKey: "design-preview" };
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
  return copy(interactiveSamples() ? sessionNeeds.get(id) || [] : contactNeeds[id] || []);
}
function project(contact) {
  if (contact.recordSource === "sample") return copy(contact);
  const needs = readSampleNeeds(contact.id).map(need => ({ ...need, createdAt: new Date(need.createdAt), updatedAt: new Date(need.updatedAt) }));
  const summary = projectContactNeedSummary(needs, legacyOpportunities(contact));
  return { ...copy(contact), intent: summary.intent, budget: summary.budgetMaxCents == null ? undefined : summary.budgetMaxCents / 100, neighborhood: summary.areas.join(" · ") || undefined };
}
export function readSampleContacts() {
  if (getPreviewScenario() === "empty") return [];
  return (interactiveSamples() ? [...sessionContacts.values()] : previewContacts).map(project);
}
export function readSampleContact(id) { return readSampleContacts().find(contact => contact.id === id); }
export function readSampleTimeline(id) {
  return copy([...(interactiveSamples() ? sessionTimeline.get(id) || [] : []), ...timelineFor(id)]);
}
export function replaceSampleContact(contact) { sessionContacts.set(contact.id, copy(contact)); }
export function replaceSampleNeeds(id, needs) { sessionNeeds.set(id, copy(needs)); }
export function appendSampleTimeline(id, item) {
  sessionTimeline.set(id, [copy(item), ...(sessionTimeline.get(id) || [])]);
}
export function nextSampleRevision(previous) {
  return new Date(Math.max(Date.now(), Date.parse(previous || "1970-01-01T00:00:00.000Z") + 1)).toISOString();
}
