// Local synthetic manual lookup/list references. No provider, fetch or storage.
import { propertyLookupInputSchema, addPropertyInputSchema, readPropertyQuery, PROPERTY_BODY_BYTES } from "../../lib/contacts/properties.ts";
import { createPropertyListInputSchema, renamePropertyListInputSchema, readPropertyListsQuery } from "../../lib/contacts/property-lists.ts";
import { bumpDataVersion } from "../../lib/data/store.ts";
import { LeadsError } from "./contact-errors.mjs";
import { announceReadOnly } from "./read-only.mjs";
import { previewRecordId, previewPublicRecordId } from "./import-merge-fixtures.mjs";
import { samplePropertyCatalog, samplePropertyProviderStates, SAMPLE_PROPERTY_DATASET } from "./property-fixtures.mjs";
import { SAMPLE_ACTOR, interactiveSamples, canWriteSample, readSampleRawContacts, readSampleContact, readSampleRawPropertyLists, readSampleDefaultPropertyList, readSampleListPropertyRows, replaceSamplePropertyList, replaceSampleListPropertyRows, readSampleReceipt, replaceSampleReceipt, nextSampleRevision } from "./sample-session.mjs";

const copy = value => structuredClone(value);
const failure = (code, status = 400) => new LeadsError(code, status);
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
function parse(schema, input, code = "invalid_property") {
  const parsed = schema.safeParse(input);
  if (!parsed.success || new TextEncoder().encode(JSON.stringify(input)).length > PROPERTY_BODY_BYTES) throw failure(code);
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
  return copy({ id: row.id, listId: list.id, contactId: list.contactId ? previewPublicRecordId(list.contactId) : null, mlsNumber: row.mlsNumber, listingId: row.listingId, addedAt: row.addedAt, listing: current.listing, syncStatus: current.status, checkedAt });
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
export async function getPropertyListProperties(id, page = 1) {
  const list = ownList(id), query = readPropertyQuery(new URLSearchParams({ page: String(page) }));
  if (!query) throw failure("invalid_property");
  const rows = readSampleListPropertyRows(list.id).filter(row => !row.removedAt).sort((a, b) => b.addedAt.localeCompare(a.addedAt) || b.id.localeCompare(a.id));
  const actualPage = Math.min(query.page, Math.max(1, Math.ceil(rows.length / query.pageSize))), checkedAt = new Date().toISOString();
  return { items: rows.slice((actualPage - 1) * query.pageSize, actualPage * query.pageSize).map(row => view(row, list, checkedAt)), total: rows.length, page: actualPage, pageSize: query.pageSize };
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
  const row = { id: crypto.randomUUID(), listId: list.id, contactId: list.contactId, dataset: SAMPLE_PROPERTY_DATASET, mlsNumber: input.mlsNumber, listingId: listing.id, addedAt: new Date().toISOString(), removedAt: null };
  replaceSampleListPropertyRows(list.id, [...rows, row]); replaceSamplePropertyList({ ...list, updatedAt: nextSampleRevision(list.updatedAt) }); bumpDataVersion();
  return view(row, list);
}
export async function removePropertyListProperty(id, propertyId) {
  const list = ownList(id, true), rows = readSampleListPropertyRows(list.id);
  const property = rows.find(row => row.id === propertyId);
  if (!property) throw failure("not_found", 404);
  if (!property.removedAt) {
    replaceSampleListPropertyRows(list.id, rows.map(row => row.id === propertyId ? { ...row, removedAt: new Date().toISOString() } : row)); replaceSamplePropertyList({ ...list, updatedAt: nextSampleRevision(list.updatedAt) }); bumpDataVersion();
  }
  return { removed: true };
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
export async function removeContactProperty(id, propertyId) {
  const contact = contactFor(id, true), list = readSampleDefaultPropertyList(contact.id);
  if (!list) throw failure("not_found", 404);
  return removePropertyListProperty(list.id, propertyId);
}
