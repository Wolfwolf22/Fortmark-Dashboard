import { applyQuery, snapshotOf } from "../../lib/contacts/windows.ts";
import { previewContacts, contactAgents, contactNotes, contactNeeds, timelineFor } from "./contact-fixtures.mjs";
import { visualTransactions } from "./visual-fixtures.mjs";
import { announceReadOnly } from "./read-only.mjs";

const copy = value => value === undefined ? undefined : structuredClone(value);
const scenario = () => typeof window === "undefined" ? "records" : new URLSearchParams(window.location.search).get("scenario") || "records";
const rows = () => scenario() === "empty" ? [] : previewContacts;
let failedOnce = false;
export class LeadsError extends Error {
  constructor(code, status = 403, fields = []) { super(`Design preview: ${code}`); this.name = "LeadsError"; this.code = code; this.status = status; this.fields = fields; }
}
const readOnly = () => { announceReadOnly(); return Promise.reject(new LeadsError("preview_read_only", 403)); };
export const createLead = readOnly;
export const updateLeadStage = readOnly;
export const markContacted = readOnly;
export const logTouch = readOnly;
export const changeFollowUp = readOnly;
export const updateContact = readOnly;
export const addNote = readOnly;
export const deleteNote = readOnly;
export const createNeed = readOnly;
export const updateNeed = readOnly;
export async function getLeadSource() { return "db"; }
export async function getLead(id) { return copy(rows().find(contact => contact.id === id)); }
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
  return copy(applyQuery(rows(), query, new Date(), "sample-agent"));
}
export async function getLeadSnapshot() { return copy(snapshotOf(rows(), new Date(), "sample-agent")); }
export async function getTimeline(id) { return copy(rows().some(contact => contact.id === id) ? timelineFor(id) : []); }
export async function getNotes(id) { return copy(rows().some(contact => contact.id === id) ? contactNotes[id] || [] : []); }
export async function getNeeds(id) { return copy(rows().some(contact => contact.id === id) ? contactNeeds[id] || [] : []); }
export async function getEligibleContacts(query) {
  return copy(rows().filter(contact => contact.stage === "representation" && (!query || contact.name.toLowerCase().includes(query.toLowerCase()))).map(({ id, name }) => ({ id, name })));
}
export async function getLinkedTransactions(id) {
  if (scenario() === "empty") return [];
  const ids = id === "sample-upcoming" ? ["sample-financing"] : id === "sample-overdue" ? ["sample-offer"] : [];
  return copy(visualTransactions.filter(deal => ids.includes(deal.id)).map(({ id, address, city, stage }) => ({ id, address, city, stage })));
}
