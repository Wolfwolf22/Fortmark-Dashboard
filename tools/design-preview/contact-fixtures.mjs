// Synthetic contacts for visual review. Database-shaped fixtures only enable
// the real stored-record UI; no database, account or service is connected.
import { businessDayKey } from "../../lib/metrics/business-day.ts";
import { followUpInstant } from "../../lib/contacts/follow-up.ts";

export const contactFixtureNow = new Date();
const instant = (days) => new Date(contactFixtureNow.getTime() + days * 86_400_000).toISOString();
const day = (days) => {
  const date = new Date(`${businessDayKey(contactFixtureNow)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const follow = (days) => followUpInstant(day(days));
const base = {
  phone: "+12025550101", stage: "lead", source: "referral", intent: "buy",
  assignedAgentId: "sample-agent", assignedAgentName: "Sample Agent", ownedByViewer: true,
  recordSource: "db", notes: "", birthday: null,
  createdDate: instant(-45), lastContactDate: instant(-3), lastTouchDate: instant(-3),
  editable: { firstName: "Sample", lastName: "Contact", preferredName: "", company: "Sample Company" },
};
export const contactAgents = [{ id: "sample-agent", name: "Sample Agent" }, { id: "sample-colleague", name: "Sample Colleague" }];
export const previewContacts = [
  { ...base, id: "sample-due-today", name: "Sample Due Today", email: "sample.today@example.com", stage: "qualified", source: "website", nextFollowUpDate: follow(0), neighborhood: "Fort Lauderdale", budget: 750000, createdDate: instant(-5), lastContactDate: instant(-1), lastTouchDate: instant(-1), editable: { ...base.editable, lastName: "Due Today" } },
  { ...base, id: "sample-overdue", name: "Sample Overdue Follow-up", email: "sample.overdue@example.com", stage: "representation", source: "referral", nextFollowUpDate: follow(-3), neighborhood: "Fort Lauderdale", budget: 800000, lastContactDate: instant(-18), lastTouchDate: instant(-18), birthday: { month: 11, day: 12 }, notes: "Synthetic legacy note. This is sample content for the read-only visual preview.", editable: { ...base.editable, lastName: "Overdue Follow-up" } },
  { ...base, id: "sample-upcoming", name: "Sample Upcoming Follow-up", email: "sample.upcoming@example.com", stage: "under_contract", source: "sphere", nextFollowUpDate: follow(4), neighborhood: "Fort Lauderdale", budget: 450000, lastContactDate: instant(-2), lastTouchDate: instant(-2), editable: { ...base.editable, lastName: "Upcoming Follow-up" } },
  { ...base, id: "sample-quiet", name: "Sample Quiet Relationship", email: "sample.quiet@example.com", stage: "lead", source: "open_house", intent: "sell", nextFollowUpDate: undefined, lastContactDate: instant(-35), lastTouchDate: undefined, editable: { ...base.editable, lastName: "Quiet Relationship" } },
  { ...base, id: "sample-past-client", name: "Sample Past Client", email: "sample.past@example.com", stage: "past_client", source: "past_client", intent: "other", lastContactDate: instant(-50), lastTouchDate: instant(-50), editable: { ...base.editable, lastName: "Past Client" } },
  { ...base, id: "sample-colleague-contact", name: "Sample Colleague Contact", email: "sample.colleague@example.com", stage: "appointment", source: "social", assignedAgentId: "sample-colleague", assignedAgentName: "Sample Colleague", ownedByViewer: false, editable: { ...base.editable, lastName: "Colleague Contact" } },
  { ...base, id: "sample-labeled-fallback", name: "Sample Labeled Fallback", email: "sample.fallback@example.com", stage: "contacted", source: "other", intent: "other", recordSource: "sample", editable: undefined, notes: "Sample-record fallback: notes and client needs are intentionally unavailable in this source mode." },
  ...Array.from({ length: 23 }, (_, index) => ({
    ...base, id: `sample-contact-${String(index + 1).padStart(2, "0")}`,
    name: index === 22 ? "Sample Contact With a Long Compound Name" : `Sample Contact ${String(index + 1).padStart(2, "0")}`,
    email: index === 22 ? "sample.contact.with.an.extended.address.for.wrapping@example.com" : `sample.contact${index + 1}@example.com`,
    stage: ["lead", "contacted", "appointment"][index % 3],
    source: ["website", "sign_call", "referral"][index % 3],
    intent: ["buy", "sell", "lease"][index % 3],
    lastContactDate: instant(-(index + 2)), lastTouchDate: instant(-(index + 2)),
    createdDate: instant(-(index + 3)), neighborhood: index % 2 ? "Hollywood" : "Fort Lauderdale",
    editable: { ...base.editable, lastName: index === 22 ? "Contact With a Long Compound Name" : `Contact ${index + 1}` },
  })),
];

export const contactNotes = {
  "sample-overdue": [
    { id: "sample-note-2", body: "Sample note: review the next round of property options and confirm the preferred showing times. This is synthetic preview content.", createdAt: instant(-2), author: "Sample Agent", canDelete: true },
    { id: "sample-note-1", body: "Sample note: the client prefers a quiet street and room for a home office.\nNo actual client information is stored here.", createdAt: instant(-10), author: "Sample Agent", canDelete: true },
  ],
  "sample-upcoming": [{ id: "sample-note-3", body: "Sample note: financing questions have been collected for the next call.", createdAt: instant(-1), author: "Sample Agent", canDelete: true }],
};
export const contactNeeds = {
  "sample-overdue": [{ id: "sample-need-1", kind: "buy", status: "active", propertyTypes: ["singleFamily", "townhouse"], areas: ["Fort Lauderdale", "Hollywood"], priceMinCents: 65000000, priceMaxCents: 80000000, minBeds: 3, minBaths: 2, minSqft: 1700, targetDate: day(75), timelineNote: "Sample target: within the next quarter", financing: "conventional", mustHaves: ["Home office", "Outdoor space"], avoid: ["Major roads"], additionalRequirements: "Synthetic requirements for visual review only.", createdAt: instant(-14), updatedAt: instant(-5) }],
  "sample-upcoming": [{ id: "sample-need-2", kind: "buy", status: "fulfilled", propertyTypes: ["condo"], areas: ["Fort Lauderdale"], priceMinCents: 35000000, priceMaxCents: 45000000, minBeds: 2, minBaths: 2, minSqft: null, targetDate: null, timelineNote: null, financing: "conventional", mustHaves: [], avoid: [], additionalRequirements: null, createdAt: instant(-30), updatedAt: instant(-2) }],
};
export function timelineFor(id) {
  if (id === "sample-labeled-fallback" || id === "sample-quiet") return [];
  if (id === "sample-overdue") return [
    { id: "sample-timeline-7", type: "note", title: "Added note", at: instant(-2), by: "Sample Agent" },
    { id: "sample-timeline-6", type: "follow_up_scheduled", title: "Follow-up scheduled", at: instant(-4), by: "Sample Agent" },
    { id: "sample-timeline-5", type: "need", title: "Client need updated", at: instant(-5), by: "Sample Agent" },
    { id: "sample-timeline-4", type: "stage", title: "Stage changed to Representation", at: instant(-10), by: "Sample Agent" },
    { id: "sample-timeline-3", type: "showing", title: "Showing", detail: "Synthetic preview: reviewed example property options.", at: instant(-18), by: "Sample Agent" },
    { id: "sample-timeline-2", type: "call", title: "Called client", detail: "Synthetic preview: discussed the property search.", at: instant(-20), by: "Sample Agent" },
    { id: "sample-timeline-1", type: "created", title: "Contact added", at: instant(-45), by: "Sample Agent" },
  ];
  return [{ id: `${id}-sample-touch`, type: "call", title: "Called client", detail: "Sample activity for visual review.", at: instant(-2), by: "Sample Agent" }, { id: `${id}-sample-created`, type: "created", title: "Contact added", at: instant(-30), by: "Sample Agent" }];
}
