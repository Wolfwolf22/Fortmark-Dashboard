// Local synthetic manual lookup/list references. No provider, fetch or storage.
import { propertyLookupInputSchema, addPropertyInputSchema, readPropertyQuery, PROPERTY_BODY_BYTES } from "../../lib/contacts/properties.ts";
import { bumpDataVersion } from "../../lib/data/store.ts";
import { LeadsError } from "./contact-errors.mjs";
import { announceReadOnly } from "./read-only.mjs";
import { previewRecordId } from "./import-merge-fixtures.mjs";
import { samplePropertyCatalog, samplePropertyProviderStates, SAMPLE_PROPERTY_DATASET } from "./property-fixtures.mjs";
import { interactiveSamples, canWriteSample, readSampleRawContacts, readSampleContact, readSamplePropertyRows, readSampleProperties, replaceSampleProperties } from "./sample-session.mjs";

const copy = value => structuredClone(value);
const failure = (code, status = 400) => new LeadsError(code, status);
function contactFor(id, write = false) {
  if (write && !interactiveSamples()) { announceReadOnly(); throw failure("preview_read_only", 403); }
  const raw = readSampleRawContacts().find(contact => contact.id === previewRecordId(id));
  if (write && raw?.mergedIntoContactId) throw failure("merged_contact", 409);
  const contact = readSampleContact(id);
  if (!contact) throw failure("not_found", 404);
  if (contact.recordSource !== "db" || write && !canWriteSample(contact)) throw failure("preview_read_only", 403);
  return contact;
}
function parse(schema, input) {
  const parsed = schema.safeParse(input);
  if (!parsed.success || new TextEncoder().encode(JSON.stringify(input)).length > PROPERTY_BODY_BYTES) throw failure("invalid_property");
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
function view(row, checkedAt = new Date().toISOString()) {
  const current = resolution(row.mlsNumber, row.listingId, row.dataset);
  return copy({ id: row.id, contactId: row.contactId, mlsNumber: row.mlsNumber, listingId: row.listingId, addedAt: row.addedAt, listing: current.listing, syncStatus: current.status, checkedAt });
}
export async function getContactProperties(id, page = 1) {
  const contact = contactFor(id), query = readPropertyQuery(new URLSearchParams({ page: String(page) }));
  if (!query) throw failure("invalid_property");
  const rows = readSampleProperties(contact.id).sort((a, b) => b.addedAt.localeCompare(a.addedAt) || b.id.localeCompare(a.id));
  const actualPage = Math.min(query.page, Math.max(1, Math.ceil(rows.length / query.pageSize))), checkedAt = new Date().toISOString();
  return { items: rows.slice((actualPage - 1) * query.pageSize, actualPage * query.pageSize).map(row => view(row, checkedAt)), total: rows.length, page: actualPage, pageSize: query.pageSize };
}
export async function lookupContactProperty(id, mlsNumber) {
  const contact = contactFor(id), input = parse(propertyLookupInputSchema, { mlsNumber });
  const listing = resolveLookup(input.mlsNumber);
  return copy({ dataset: SAMPLE_PROPERTY_DATASET, listing, alreadySaved: readSampleProperties(contact.id).some(row => row.dataset === SAMPLE_PROPERTY_DATASET && row.listingId === listing.id) });
}
export async function addContactProperty(id, value) {
  const contact = contactFor(id, true), input = parse(addPropertyInputSchema, value);
  const listing = resolveLookup(input.mlsNumber);
  if (listing.id !== input.expectedListingId || input.expectedDataset !== SAMPLE_PROPERTY_DATASET) throw failure("listing_changed", 409);
  const rows = readSamplePropertyRows(contact.id);
  const existing = rows.find(row => !row.removedAt && row.dataset === SAMPLE_PROPERTY_DATASET && row.listingId === listing.id);
  if (existing) return view(existing);
  const row = { id: crypto.randomUUID(), contactId: contact.id, dataset: SAMPLE_PROPERTY_DATASET, mlsNumber: input.mlsNumber, listingId: listing.id, addedAt: new Date().toISOString(), removedAt: null };
  replaceSampleProperties(contact.id, [...rows, row]); bumpDataVersion();
  return view(row);
}
export async function removeContactProperty(id, propertyId) {
  const contact = contactFor(id, true), rows = readSamplePropertyRows(contact.id);
  const property = rows.find(row => row.id === propertyId);
  if (!property) throw failure("not_found", 404);
  if (!property.removedAt) {
    replaceSampleProperties(contact.id, rows.map(row => row.id === propertyId ? { ...row, removedAt: new Date().toISOString() } : row)); bumpDataVersion();
  }
  return { removed: true };
}
