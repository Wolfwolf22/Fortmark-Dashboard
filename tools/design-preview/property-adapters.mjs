// Local synthetic manual lookup/list references. No provider, fetch or storage.
import { propertyLookupInputSchema, addPropertyInputSchema, readPropertyQuery, PROPERTY_BODY_BYTES } from "../../lib/contacts/properties.ts";
import { createPropertyListInputSchema, renamePropertyListInputSchema, readPropertyListsQuery } from "../../lib/contacts/property-lists.ts";
import { propertyResearchInputSchema, propertyTransferInputSchema, propertyRemovalInputSchema, propertyReviewMatches, comparePropertyAdded, applyPropertyPriceOrder } from "../../lib/contacts/property-research.ts";
import { bumpDataVersion } from "../../lib/data/store.ts";
import { LeadsError } from "./contact-errors.mjs";
import { announceReadOnly } from "./read-only.mjs";
import { previewRecordId, previewPublicRecordId } from "./import-merge-fixtures.mjs";
import { samplePropertyCatalog, samplePropertyProviderStates, SAMPLE_PROPERTY_DATASET } from "./property-fixtures.mjs";
import { SAMPLE_ACTOR, interactiveSamples, getPreviewScenario, canWriteSample, readSampleRawContacts, readSampleContact, readSampleRawPropertyLists, readSampleDefaultPropertyList, readSampleListPropertyRows, replaceSamplePropertyList, replaceSampleListPropertyRows, readSampleReceipt, replaceSampleReceipt, appendSamplePropertyAudit, nextSampleRevision } from "./sample-session.mjs";

const copy = value => structuredClone(value);
const failure = (code, status = 400) => new LeadsError(code, status);
const researchConflicts = new Set();
function writeMode() { if (!interactiveSamples()) { announceReadOnly(); throw failure("preview_read_only", 403); } }
function contactFor(id, write = false) {
  if (write) writeMode();
  const raw = readSampleRawContacts().find(contact => contact.id === previewRecordId(id));
  if (write && raw?.mergedIntoContactId) throw failure("merged_contact", 409);
  const contact = readSampleContact(id);
  if (!contact) throw failure("not_found", 404);
  if (contact.recordSource !== "db" || write && !canWriteSample(contact)) throw failure("preview_read_only", 403);
  return contact;
}
function ownList(id, write = false) {
  if (write) writeMode();
  const list = readSampleRawPropertyLists().find(list => list.id === id && list.ownerUserId === SAMPLE_ACTOR.userId && !list.archivedAt);
  if (!list) throw failure("not_found", 404);
  if (list.contactId) contactFor(list.contactId);
  return list;
}
function parse(schema, input, code = "invalid_property", bytes = PROPERTY_BODY_BYTES) {
  const parsed = schema.safeParse(input);
  if (!parsed.success || new TextEncoder().encode(JSON.stringify(input)).length > bytes) throw failure(code);
  return parsed.data;
}
function resolution(mlsNumber, listingId, dataset = SAMPLE_PROPERTY_DATASET) {
  if (dataset !== SAMPLE_PROPERTY_DATASET) return { status: "not_configured", listing: null };
  const status = samplePropertyProviderStates[mlsNumber];
  if (status) return { status, listing: null };
  const listing = samplePropertyCatalog.find(listing => listing.mlsNumber === mlsNumber && (!listingId || listing.id === listingId));
  return listing ? { status: "available", listing } : { status: "not_found", listing: null };
}
function resolveLookup(mlsNumber) {
  const result = resolution(mlsNumber);
  if (result.status !== "available") throw failure(result.status === "not_found" ? "listing_not_found" : result.status, result.status === "not_found" ? 404 : 503);
  return result.listing;
}
function listView(list) {
  const contact = list.contactId ? contactFor(list.contactId) : null;
  return { id: list.id, name: list.name, contactId: contact ? previewPublicRecordId(contact.id) : null, ...(contact ? { contactName: contact.name } : {}), propertyCount: readSampleListPropertyRows(list.id).filter(row => !row.removedAt).length, createdAt: list.createdAt, updatedAt: list.updatedAt };
}
function view(row, list, checkedAt = new Date().toISOString()) {
  const current = resolution(row.mlsNumber, row.listingId, row.dataset);
  return copy({ ...metadataView(row, list), listing: current.listing, syncStatus: current.status, checkedAt });
}
function metadataView(row, list) {
  const metadata = { notes: row.notes ?? "", reviewStatus: row.reviewStatus ?? "to_review", updatedAt: row.updatedAt ?? row.addedAt };
  if (getPreviewScenario() === "conflict" && researchConflicts.has(`${list.id}:${row.id}`)) {
    metadata.notes = "Confirm guest parking and review the latest floor plan.";
    metadata.reviewStatus = metadata.reviewStatus === "shortlisted" ? "ruled_out" : "shortlisted";
    metadata.updatedAt = new Date(Date.parse(metadata.updatedAt) + 60_000).toISOString();
  }
  return copy({ id: row.id, listId: list.id, contactId: list.contactId ? previewPublicRecordId(list.contactId) : null, mlsNumber: row.mlsNumber, listingId: row.listingId, addedAt: row.addedAt, ...metadata, listing: null, syncStatus: "unavailable", checkedAt: null });
}
function membership(list, propertyId, active = true) {
  const row = readSampleListPropertyRows(list.id).find(row => row.id === propertyId && (!active || !row.removedAt));
  if (!row) throw failure("not_found", 404);
  return row;
}
export async function getPropertyListProperty(id, propertyId) {
  const list = ownList(id); return metadataView(membership(list, propertyId), list);
}
export async function getPropertyLists(options = {}) {
  const params = new URLSearchParams({ page: String(options.page ?? 1) });
  if (options.contactId) params.set("contactId", previewPublicRecordId(options.contactId));
  const query = readPropertyListsQuery(params);
  if (!query) throw failure("invalid_property_list");
  const contact = query.contactId ? contactFor(query.contactId) : null;
  const lists = readSampleRawPropertyLists().filter(list => list.ownerUserId === SAMPLE_ACTOR.userId && !list.archivedAt && (!contact || list.contactId === contact.id)).filter(list => !list.contactId || readSampleContact(list.contactId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  const page = Math.min(query.page, Math.max(1, Math.ceil(lists.length / query.pageSize)));
  return { items: lists.slice((page - 1) * query.pageSize, page * query.pageSize).map(listView), total: lists.length, page, pageSize: query.pageSize };
}
export async function getPropertyList(id) { return copy(listView(ownList(id))); }
export async function createPropertyList(value) {
  writeMode();
  const input = { ...value, ...(value?.contactId ? { contactId: previewPublicRecordId(value.contactId) } : {}) };
  const data = parse(createPropertyListInputSchema, input, "invalid_property_list");
  const payload = JSON.stringify({ name: data.name, contactId: data.contactId || null });
  const receipt = readSampleReceipt("property-list", data.requestId);
  if (receipt) { if (receipt.payload !== payload) throw failure("request_conflict", 409); return getPropertyList(receipt.id); }
  const contact = data.contactId ? contactFor(data.contactId, true) : null;
  const at = new Date().toISOString();
  const list = { id: crypto.randomUUID(), name: data.name, contactId: contact?.id || null, ownerUserId: SAMPLE_ACTOR.userId, defaultForContactId: null, createdAt: at, updatedAt: at };
  replaceSamplePropertyList(list); replaceSampleListPropertyRows(list.id, []);
  replaceSampleReceipt("property-list", data.requestId, { payload, id: list.id }); bumpDataVersion();
  return copy(listView(list));
}
export async function renamePropertyList(id, value) {
  const list = ownList(id, true), data = parse(renamePropertyListInputSchema, value, "invalid_property_list");
  if (Date.parse(data.expectedUpdatedAt) !== Date.parse(list.updatedAt)) throw failure("conflict", 409);
  if (data.name !== list.name) { const next = { ...list, name: data.name, updatedAt: nextSampleRevision(list.updatedAt) }; replaceSamplePropertyList(next); bumpDataVersion(); return copy(listView(next)); }
  return copy(listView(list));
}
export async function getPropertyListProperties(id, page = 1, options = {}) {
  const params = new URLSearchParams({ page: String(page) });
  for (const key of ["reviewStatus", "sort"]) if (options[key] !== undefined) params.set(key, options[key]);
  const list = ownList(id), query = readPropertyQuery(params);
  if (!query) throw failure("invalid_property");
  const checkedAt = new Date().toISOString();
  const all = readSampleListPropertyRows(list.id).filter(row => !row.removedAt).map(row => view(row, list, checkedAt));
  let rows = all.filter(row => propertyReviewMatches(row.reviewStatus, query.reviewStatus)).sort((a, b) => comparePropertyAdded(a, b, query.sort === "added_asc" ? "added_asc" : "added_desc"));
  if (query.sort === "price_asc" || query.sort === "price_desc") {
    const price = row => Number.isFinite(row.listing?.listPrice) && row.listing.listPrice > 0 ? row.listing.listPrice : null;
    const ids = [...rows].sort((a, b) => {
      const left = price(a), right = price(b);
      if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
      return query.sort === "price_asc" ? left - right : right - left;
    }).map(row => row.id);
    rows = applyPropertyPriceOrder(rows, ids);
    if (!rows) throw failure("unavailable", 503);
  }
  const actualPage = Math.min(query.page, Math.max(1, Math.ceil(rows.length / query.pageSize)));
  return { items: rows.slice((actualPage - 1) * query.pageSize, actualPage * query.pageSize), total: rows.length, totalAll: all.length, page: actualPage, pageSize: query.pageSize };
}
export async function lookupPropertyListProperty(id, mlsNumber) {
  const list = ownList(id), input = parse(propertyLookupInputSchema, { mlsNumber });
  const listing = resolveLookup(input.mlsNumber);
  return copy({ dataset: SAMPLE_PROPERTY_DATASET, listing, alreadySaved: readSampleListPropertyRows(list.id).some(row => !row.removedAt && row.dataset === SAMPLE_PROPERTY_DATASET && row.listingId === listing.id) });
}
export async function addPropertyListProperty(id, value) {
  const list = ownList(id, true), input = parse(addPropertyInputSchema, value);
  const listing = resolveLookup(input.mlsNumber);
  if (listing.id !== input.expectedListingId || input.expectedDataset !== SAMPLE_PROPERTY_DATASET) throw failure("listing_changed", 409);
  const rows = readSampleListPropertyRows(list.id);
  const existing = rows.find(row => !row.removedAt && row.dataset === SAMPLE_PROPERTY_DATASET && row.listingId === listing.id);
  if (existing) return view(existing, list);
  const at = new Date().toISOString();
  const row = { id: crypto.randomUUID(), listId: list.id, contactId: list.contactId, dataset: SAMPLE_PROPERTY_DATASET, mlsNumber: input.mlsNumber, listingId: listing.id, addedAt: at, updatedAt: at, notes: "", reviewStatus: "to_review", removedAt: null };
  replaceSampleListPropertyRows(list.id, [...rows, row]); replaceSamplePropertyList({ ...list, updatedAt: nextSampleRevision(list.updatedAt) }); bumpDataVersion();
  return view(row, list);
}
export async function removePropertyListProperty(id, propertyId, expectedUpdatedAt) {
  const list = ownList(id, true), rows = readSampleListPropertyRows(list.id);
  parse(propertyRemovalInputSchema, { ...(expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {}) });
  const property = rows.find(row => row.id === propertyId);
  if (!property) throw failure("not_found", 404);
  if (!property.removedAt) {
    if (expectedUpdatedAt !== undefined && Date.parse(expectedUpdatedAt) !== Date.parse(property.updatedAt ?? property.addedAt)) throw failure("conflict", 409);
    replaceSampleListPropertyRows(list.id, rows.map(row => row.id === propertyId ? { ...row, removedAt: new Date().toISOString(), updatedAt: nextSampleRevision(row.updatedAt ?? row.addedAt) } : row)); replaceSamplePropertyList({ ...list, updatedAt: nextSampleRevision(list.updatedAt) }); bumpDataVersion();
  }
  return { removed: true };
}
export async function updatePropertyResearch(id, propertyId, value) {
  if (getPreviewScenario() === "conflict") {
    const list = ownList(id); membership(list, propertyId);
    parse(propertyResearchInputSchema, value, "invalid_property_research", 32768);
    const key = `${id}:${propertyId}`;
    if (!researchConflicts.has(key)) { researchConflicts.add(key); throw failure("conflict", 409); }
  }
  const list = ownList(id, true), data = parse(propertyResearchInputSchema, value, "invalid_property_research", 32768), row = membership(list, propertyId);
  const same = (row.notes ?? "") === data.notes && (row.reviewStatus ?? "to_review") === data.reviewStatus;
  if (Date.parse(data.expectedUpdatedAt) !== Date.parse(row.updatedAt ?? row.addedAt) && !same) throw failure("conflict", 409);
  if (same) return metadataView(row, list);
  const next = { ...row, notes: data.notes, reviewStatus: data.reviewStatus, updatedAt: nextSampleRevision(row.updatedAt ?? row.addedAt) };
  replaceSampleListPropertyRows(list.id, readSampleListPropertyRows(list.id).map(item => item.id === row.id ? next : item));
  appendSamplePropertyAudit(list, row.id, "research", [row.notes !== data.notes ? "notes" : null, row.reviewStatus !== data.reviewStatus ? "reviewStatus" : null].filter(Boolean));
  replaceSamplePropertyList({ ...list, updatedAt: nextSampleRevision(list.updatedAt) }); bumpDataVersion();
  return metadataView(next, list);
}
export async function transferProperty(id, propertyId, value) {
  writeMode(); const data = parse(propertyTransferInputSchema, value, "invalid_property_transfer", 32768);
  if (id === data.targetListId) throw failure("invalid_property_transfer");
  const payload = JSON.stringify({ sourceListId: id, propertyId, mode: data.mode, targetListId: data.targetListId, expectedUpdatedAt: data.expectedUpdatedAt });
  const receiptKey = `property-transfer:${SAMPLE_ACTOR.userId}`, receipt = readSampleReceipt(receiptKey, data.requestId);
  if (receipt) {
    ownList(receipt.sourceListId, true); const target = ownList(receipt.targetListId, true);
    if (receipt.payload !== payload) throw failure("request_conflict", 409);
    const row = membership(target, receipt.targetPropertyId, false);
    if (row.removedAt) throw failure("conflict", 409);
    return { property: metadataView(row, target), sourceRemoved: receipt.sourceRemoved, targetListId: target.id };
  }
  const source = ownList(id, true), target = ownList(data.targetListId, true);
  const row = membership(source, propertyId);
  if (Date.parse(data.expectedUpdatedAt) !== Date.parse(row.updatedAt ?? row.addedAt)) throw failure("conflict", 409);
  const targetRows = readSampleListPropertyRows(target.id);
  if (targetRows.some(item => !item.removedAt && item.dataset === row.dataset && item.listingId === row.listingId)) throw failure("target_has_property", 409);
  const at = new Date().toISOString();
  const next = { ...row, id: crypto.randomUUID(), listId: target.id, contactId: target.contactId, notes: row.notes ?? "", reviewStatus: row.reviewStatus ?? "to_review", addedAt: at, updatedAt: at, removedAt: null };
  replaceSampleListPropertyRows(target.id, [...targetRows, next]);
  replaceSamplePropertyList({ ...target, updatedAt: nextSampleRevision(target.updatedAt) });
  if (data.mode === "move") {
    replaceSampleListPropertyRows(source.id, readSampleListPropertyRows(source.id).map(item => item.id === row.id ? { ...item, removedAt: at, updatedAt: nextSampleRevision(item.updatedAt ?? item.addedAt) } : item));
    replaceSamplePropertyList({ ...source, updatedAt: nextSampleRevision(source.updatedAt) });
  }
  appendSamplePropertyAudit(source, row.id, data.mode); appendSamplePropertyAudit(target, next.id, data.mode);
  replaceSampleReceipt(receiptKey, data.requestId, { payload, sourceListId: source.id, targetListId: target.id, targetPropertyId: next.id, sourceRemoved: data.mode === "move" }); bumpDataVersion();
  return { property: metadataView(next, target), sourceRemoved: data.mode === "move", targetListId: target.id };
}
function compatibilityList(id, write = false) {
  const contact = contactFor(id, write);
  let list = readSampleDefaultPropertyList(contact.id);
  if (!list && write) {
    const at = new Date().toISOString();
    list = { id: crypto.randomUUID(), name: "Saved properties", contactId: contact.id, ownerUserId: SAMPLE_ACTOR.userId, defaultForContactId: contact.id, createdAt: at, updatedAt: at };
    replaceSamplePropertyList(list); replaceSampleListPropertyRows(list.id, []);
  }
  return { contact, list };
}
export async function getContactProperties(id, page = 1) {
  const { list } = compatibilityList(id);
  if (list) return getPropertyListProperties(list.id, page);
  const query = readPropertyQuery(new URLSearchParams({ page: String(page) })); if (!query) throw failure("invalid_property");
  return { items: [], total: 0, page: 1, pageSize: query.pageSize };
}
export async function lookupContactProperty(id, mlsNumber) {
  const { list } = compatibilityList(id);
  if (list) return lookupPropertyListProperty(list.id, mlsNumber);
  const data = parse(propertyLookupInputSchema, { mlsNumber }); return copy({ dataset: SAMPLE_PROPERTY_DATASET, listing: resolveLookup(data.mlsNumber), alreadySaved: false });
}
export async function addContactProperty(id, value) {
  contactFor(id, true); const data = parse(addPropertyInputSchema, value), listing = resolveLookup(data.mlsNumber);
  if (listing.id !== data.expectedListingId || data.expectedDataset !== SAMPLE_PROPERTY_DATASET) throw failure("listing_changed", 409);
  const { list } = compatibilityList(id, true); return addPropertyListProperty(list.id, value);
}
export async function removeContactProperty(id, propertyId, expectedUpdatedAt) {
  const contact = contactFor(id, true), list = readSampleDefaultPropertyList(contact.id);
  if (!list) throw failure("not_found", 404);
  return removePropertyListProperty(list.id, propertyId, expectedUpdatedAt);
}
