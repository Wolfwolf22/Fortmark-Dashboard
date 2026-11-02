// Saved user-authored sample plans. Provider content is never cached here.
import { contactFixtureNow, SAMPLE_AGENT_ID, SAMPLE_COLLEAGUE_ID } from "./contact-fixtures.mjs";
import { sampleShowings } from "./showing-fixtures.mjs";
import { SAMPLE_TOUR_LIST_ID, SAMPLE_PERSONAL_TOUR_LIST_ID, SAMPLE_PRIVATE_LIST_ID, samplePropertyListRows } from "./property-fixtures.mjs";

export const SAMPLE_SAVED_TOUR_ID = "86000000-0000-4000-8000-000000000001";
export const SAMPLE_PERSONAL_SAVED_TOUR_ID = "86000000-0000-4000-8000-000000000002";
export const SAMPLE_PRIVATE_SAVED_TOUR_ID = "86000000-0000-4000-8000-000000000003";
export const SAMPLE_ARCHIVED_TOUR_ID = "86000000-0000-4000-8000-000000000004";
const startsAt = sampleShowings.find(showing => showing.id.endsWith("000101")).startsAt;
const stamp = contactFixtureNow.toISOString();
function saved(id, name, sourceListId, contactId, values = {}) {
  const properties = [...samplePropertyListRows[sourceListId]];
  if (sourceListId === SAMPLE_TOUR_LIST_ID) properties.sort((a, b) => sampleShowings.find(showing => showing.sourcePropertyId === a.id).startsAt.localeCompare(sampleShowings.find(showing => showing.sourcePropertyId === b.id).startsAt));
  return { id, ownerUserId: SAMPLE_AGENT_ID, name, notes: "Compare the floor plans, parking and monthly costs before choosing the next step.", sourceListId, contactId, startsAt, bufferMinutes: 10, firstPropertyId: "auto", originAddress: "", endMode: "last_property", endAddress: "", createdAt: stamp, updatedAt: stamp, archivedAt: null, lastScheduledAt: null,
    stops: properties.map((property, position) => ({ id: `87000000-0000-4000-8000-${String(Number(id.slice(-3)) * 100 + position + 1).padStart(12, "0")}`, propertyId: property.id, position, visitMinutes: 45, lockTime: false, linkedShowingId: sourceListId === SAMPLE_TOUR_LIST_ID ? sampleShowings.find(showing => showing.sourcePropertyId === property.id)?.id || null : null, updatedAt: stamp })), ...values };
}
export const sampleSavedTours = [
  saved(SAMPLE_SAVED_TOUR_ID, "Saturday buyer tour", SAMPLE_TOUR_LIST_ID, "sample-due-today"),
  saved(SAMPLE_PERSONAL_SAVED_TOUR_ID, "Personal research visits", SAMPLE_PERSONAL_TOUR_LIST_ID, "sample-overdue", { notes: "A private draft for comparing two options from the research list.", startsAt: new Date(Date.parse(startsAt) + 86400000).toISOString(), originAddress: "Sample FortMark office", endMode: "address", endAddress: "Sample coastal meeting point" }),
  saved(SAMPLE_PRIVATE_SAVED_TOUR_ID, "Sample colleague private tour", SAMPLE_PRIVATE_LIST_ID, "sample-colleague-contact", { ownerUserId: SAMPLE_COLLEAGUE_ID, notes: "This other owner's plan must never appear in the current actor's workspace." }),
  saved(SAMPLE_ARCHIVED_TOUR_ID, "Archived comparison tour", SAMPLE_TOUR_LIST_ID, "sample-due-today", { archivedAt: stamp, notes: "An archived sample plan retained for reference." }),
];
