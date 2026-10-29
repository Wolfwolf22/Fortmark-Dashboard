// Fictional manual property lists. No MLS provider is contacted by this preview.
import { visualListings } from "./visual-fixtures.mjs";
import { contactFixtureNow } from "./contact-fixtures.mjs";
import { DUPLICATE_PRIMARY_ID, DUPLICATE_SOURCE_ID } from "./import-merge-fixtures.mjs";

const copy = value => structuredClone(value);
const extraListings = Array.from({ length: 14 }, (_, index) => ({
  ...copy(visualListings[0]), id: `sample-client-property-${String(index + 1).padStart(2, "0")}`,
  mlsNumber: `SAMPLE-${101 + index}`, address: `Sample Saved Property ${String(index + 1).padStart(2, "0")}`,
  photos: [visualListings[index % visualListings.length].photos[0] || "/photos/plate-01.svg"],
  description: "Synthetic property-list example for an isolated design preview. The illustration, address and specifications do not describe a real listing.",
}));
export const samplePropertyCatalog = [...visualListings, ...extraListings];
export const SAMPLE_PROPERTY_DATASET = "synthetic-preview";
export const samplePropertyProviderStates = { "SAMPLE-MISSING-901": "not_found", "SAMPLE-OFFLINE-902": "unavailable", "SAMPLE-NOT-CONFIGURED-903": "not_configured" };
const saved = (number, contactId, mlsNumber, listingId, age = 1) => ({ id: `82000000-0000-4000-8000-${String(number).padStart(12, "0")}`, contactId, dataset: SAMPLE_PROPERTY_DATASET, mlsNumber, listingId, addedAt: new Date(contactFixtureNow.getTime() - age * 86_400_000).toISOString(), removedAt: null });
export const sampleContactProperties = {
  "sample-due-today": [saved(1, "sample-due-today", "SAMPLE-001", "sample-coastal"), saved(2, "sample-due-today", "SAMPLE-MISSING-901", "sample-removed-reference", 2), saved(3, "sample-due-today", "SAMPLE-OFFLINE-902", "sample-unavailable-reference", 3)],
  "sample-long-history": extraListings.slice(0, 13).map((listing, index) => saved(100 + index, "sample-long-history", listing.mlsNumber, listing.id, 15 - index)),
  [DUPLICATE_PRIMARY_ID]: [saved(201, DUPLICATE_PRIMARY_ID, "SAMPLE-001", "sample-coastal")],
  [DUPLICATE_SOURCE_ID]: [saved(202, DUPLICATE_SOURCE_ID, "SAMPLE-001", "sample-coastal"), saved(203, DUPLICATE_SOURCE_ID, "SAMPLE-002", "sample-courtyard")],
};
