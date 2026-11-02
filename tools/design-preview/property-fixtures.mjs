// Fictional manual property lists. No MLS provider is contacted by this preview.
import { visualListings } from "./visual-fixtures.mjs";
import { contactFixtureNow, SAMPLE_AGENT_ID, SAMPLE_COLLEAGUE_ID } from "./contact-fixtures.mjs";
import { DUPLICATE_PRIMARY_ID, DUPLICATE_SOURCE_ID } from "./import-merge-fixtures.mjs";

const copy = value => structuredClone(value);
const researchPrices = [775000, 460000, 910000, 520000, 650000, 390000, 840000, 505000, 725000, 420000, 990000, 610000, 335000, 805000];
const extraListings = Array.from({ length: 14 }, (_, index) => ({
  ...copy(visualListings[0]), id: `sample-client-property-${String(index + 1).padStart(2, "0")}`,
  mlsNumber: `SAMPLE-${101 + index}`, address: `Sample Saved Property ${String(index + 1).padStart(2, "0")}`,
  listPrice: researchPrices[index],
  photos: [visualListings[index % visualListings.length].photos[0] || "/photos/plate-01.svg"],
  description: "Synthetic property-list example for an isolated design preview. The illustration, address and specifications do not describe a real listing.",
}));
export const sampleTourListings = [
  ["West Garden Residence", 26.104, -80.315, 645000],
  ["Canal Walk House", 26.117, -80.285, 725000],
  ["River Oaks Residence", 26.103, -80.255, 689000],
  ["Oak Terrace House", 26.121, -80.222, 795000],
  ["Harbor Courtyard", 26.108, -80.191, 835000],
  ["Coastal Garden Residence", 26.124, -80.151, 925000],
].map(([name, lat, lng, listPrice], index) => ({ ...copy(visualListings[0]), id: `sample-tour-property-${index + 1}`, mlsNumber: `SAMPLE-TOUR-${index + 1}`, address: `Sample ${name}`, coordinates: { lat, lng }, listPrice, photos: [visualListings[index % visualListings.length].photos[0] || "/photos/plate-01.svg"], description: "Fictional property and illustrative location for reviewing a sample showing tour. No live listing, map or driving service is connected." }));
export const samplePropertyCatalog = [...visualListings, ...extraListings, ...sampleTourListings];
export const SAMPLE_PROPERTY_DATASET = "synthetic-preview";
export const samplePropertyProviderStates = { "SAMPLE-MISSING-901": "not_found", "SAMPLE-OFFLINE-902": "unavailable", "SAMPLE-NOT-CONFIGURED-903": "not_configured", "SAMPLE-109": "unavailable" };
const saved = (number, contactId, mlsNumber, listingId, age = 1) => {
  const addedAt = new Date(contactFixtureNow.getTime() - age * 86_400_000).toISOString();
  return { id: `82000000-0000-4000-8000-${String(number).padStart(12, "0")}`, contactId, dataset: SAMPLE_PROPERTY_DATASET, mlsNumber, listingId, addedAt, updatedAt: addedAt, notes: "", reviewStatus: "to_review", removedAt: null };
};
export const sampleContactProperties = {
  "sample-due-today": [saved(1, "sample-due-today", "SAMPLE-001", "sample-coastal"), saved(2, "sample-due-today", "SAMPLE-MISSING-901", "sample-removed-reference", 2), saved(3, "sample-due-today", "SAMPLE-OFFLINE-902", "sample-unavailable-reference", 3)],
  "sample-long-history": extraListings.slice(0, 13).map((listing, index) => saved(100 + index, "sample-long-history", listing.mlsNumber, listing.id, 15 - index)),
  [DUPLICATE_PRIMARY_ID]: [saved(201, DUPLICATE_PRIMARY_ID, "SAMPLE-001", "sample-coastal")],
  [DUPLICATE_SOURCE_ID]: [saved(202, DUPLICATE_SOURCE_ID, "SAMPLE-001", "sample-coastal"), saved(203, DUPLICATE_SOURCE_ID, "SAMPLE-002", "sample-courtyard")],
};

export const SAMPLE_WATERFRONT_LIST_ID = "83000000-0000-4000-8000-000000000001";
export const SAMPLE_INVESTMENT_LIST_ID = "83000000-0000-4000-8000-000000000002";
export const SAMPLE_PERSONAL_RESEARCH_LIST_ID = "83000000-0000-4000-8000-000000000003";
export const SAMPLE_PERSONAL_EMPTY_LIST_ID = "83000000-0000-4000-8000-000000000004";
export const SAMPLE_PRIVATE_LIST_ID = "83000000-0000-4000-8000-000000000005";
export const SAMPLE_TOUR_LIST_ID = "83000000-0000-4000-8000-000000000009";
const defaultIds = {
  "sample-due-today": SAMPLE_WATERFRONT_LIST_ID,
  "sample-long-history": "83000000-0000-4000-8000-000000000006",
  [DUPLICATE_PRIMARY_ID]: "83000000-0000-4000-8000-000000000007",
  [DUPLICATE_SOURCE_ID]: "83000000-0000-4000-8000-000000000008",
};
const list = (id, name, contactId, ownerUserId = SAMPLE_AGENT_ID, defaultForContactId = null) => ({ id, name, contactId, ownerUserId, defaultForContactId, createdAt: contactFixtureNow.toISOString(), updatedAt: contactFixtureNow.toISOString() });
export const samplePropertyLists = [
  list(SAMPLE_WATERFRONT_LIST_ID, "Waterfront options", "sample-due-today", SAMPLE_AGENT_ID, "sample-due-today"),
  list(SAMPLE_INVESTMENT_LIST_ID, "Investment research", "sample-due-today"),
  list(SAMPLE_PERSONAL_RESEARCH_LIST_ID, "Personal market research", null),
  list(SAMPLE_PERSONAL_EMPTY_LIST_ID, "Weekend opportunities", null),
  list(SAMPLE_PRIVATE_LIST_ID, "Sample colleague private research", null, SAMPLE_COLLEAGUE_ID),
  list(defaultIds["sample-long-history"], "Property shortlist", "sample-long-history", SAMPLE_AGENT_ID, "sample-long-history"),
  list(defaultIds[DUPLICATE_PRIMARY_ID], "Primary shortlist", DUPLICATE_PRIMARY_ID, SAMPLE_AGENT_ID, DUPLICATE_PRIMARY_ID),
  list(defaultIds[DUPLICATE_SOURCE_ID], "Duplicate shortlist", DUPLICATE_SOURCE_ID, SAMPLE_AGENT_ID, DUPLICATE_SOURCE_ID),
  list(SAMPLE_TOUR_LIST_ID, "Saturday tour", "sample-due-today"),
];
for (const [contactId, properties] of Object.entries(sampleContactProperties)) for (const property of properties) property.listId = defaultIds[contactId];
export const samplePropertyListRows = Object.fromEntries(Object.entries(sampleContactProperties).map(([contactId, rows]) => [defaultIds[contactId], rows]));
samplePropertyListRows[SAMPLE_INVESTMENT_LIST_ID] = [{ ...saved(301, "sample-due-today", "SAMPLE-003", "sample-condo"), listId: SAMPLE_INVESTMENT_LIST_ID }];
samplePropertyListRows[SAMPLE_PERSONAL_RESEARCH_LIST_ID] = [{ ...saved(302, null, "SAMPLE-001", "sample-coastal"), listId: SAMPLE_PERSONAL_RESEARCH_LIST_ID }];
samplePropertyListRows[SAMPLE_PERSONAL_EMPTY_LIST_ID] = [];
samplePropertyListRows[SAMPLE_PRIVATE_LIST_ID] = [{ ...saved(303, null, "SAMPLE-002", "sample-courtyard"), listId: SAMPLE_PRIVATE_LIST_ID }];
samplePropertyListRows[SAMPLE_TOUR_LIST_ID] = sampleTourListings.map((listing, index) => ({ ...saved(401 + index, "sample-due-today", listing.mlsNumber, listing.id), listId: SAMPLE_TOUR_LIST_ID, reviewStatus: "shortlisted", notes: "Compare the layout and parking during the planned tour." }));
Object.assign(samplePropertyListRows[SAMPLE_WATERFRONT_LIST_ID][0], { notes: "Review the floor plan and confirm parking before arranging a visit.", reviewStatus: "shortlisted" });
Object.assign(samplePropertyListRows[SAMPLE_WATERFRONT_LIST_ID][1], { notes: "Layout does not fit the current search.", reviewStatus: "ruled_out" });
samplePropertyListRows[SAMPLE_WATERFRONT_LIST_ID][2].notes = "Confirm availability with the listing agent.";
Object.assign(samplePropertyListRows[SAMPLE_PERSONAL_RESEARCH_LIST_ID][0], { notes: "Carrying costs are above the research budget.", reviewStatus: "ruled_out" });
for (const [index, row] of sampleContactProperties["sample-long-history"].entries()) Object.assign(row, { notes: ["Review monthly fees and parking availability.", "Keep this option for the next round of visits.", "Location does not fit the current search."][index % 3], reviewStatus: ["to_review", "shortlisted", "ruled_out"][index % 3] });
