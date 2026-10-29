// Synthetic contacts for visual review. Database-shaped fixtures only enable
// the real stored-record UI; no database, account or service is connected.
import { businessDayKey } from "../../lib/metrics/business-day.ts";
import { followUpInstant } from "../../lib/contacts/follow-up.ts";
import { businessLocalToUtc, nextActionDayMirror } from "../../lib/contacts/next-action.ts";

export const contactFixtureNow = new Date();
export const CONTACT_FIXTURE_REVISION = "2026-10-29T12:00:00.000Z";
export const SAMPLE_AGENT_ID = "30000000-0000-4000-8000-000000000001";
export const SAMPLE_COLLEAGUE_ID = "30000000-0000-4000-8000-000000000002";
const instant = (days) => new Date(contactFixtureNow.getTime() + days * 86_400_000).toISOString();
const day = (days) => {
  const date = new Date(`${businessDayKey(contactFixtureNow)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const follow = (days) => followUpInstant(day(days));
const base = {
  phone: "+12025550101", stage: "lead", source: "referral", intent: "buy",
  assignedAgentId: SAMPLE_AGENT_ID, assignedAgentName: "Sample Agent", ownedByViewer: true,
  recordSource: "db", notes: "", birthday: null,
  about: "", personalDetails: [],
  updatedAt: CONTACT_FIXTURE_REVISION,
  createdDate: instant(-45), lastContactDate: instant(-3), lastTouchDate: instant(-3),
  editable: { firstName: "Sample", lastName: "Contact", preferredName: "", company: "Sample Company" },
};
export const contactAgents = [{ id: SAMPLE_AGENT_ID, name: "Sample Agent" }, { id: SAMPLE_COLLEAGUE_ID, name: "Sample Colleague" }];
export const previewContacts = [
  { ...base, id: "sample-due-today", name: "Sample Due Today", email: "sample.today@example.com", stage: "qualified", source: "website", nextFollowUpDate: follow(0), neighborhood: "Fort Lauderdale", budget: 750000, createdDate: instant(-5), lastContactDate: instant(-1), lastTouchDate: instant(-1), editable: { ...base.editable, lastName: "Due Today" } },
  { ...base, id: "sample-overdue", name: "Sample Overdue Follow-up", email: "sample.overdue@example.com", stage: "representation", source: "referral", nextFollowUpDate: follow(-3), neighborhood: "Fort Lauderdale", budget: 800000, lastContactDate: instant(-18), lastTouchDate: instant(-18), birthday: { month: 11, day: 12 }, notes: "Synthetic legacy note. This is sample content for the visual preview.", about: "Synthetic client information for your reference. Prefers a calm pace and a short written recap after a conversation.\nThis does not describe a real person.", personalDetails: [{ label: "Preferred contact time", value: "Sample weekday mornings" }, { label: "A longer named detail for wrapping and readable reference", value: "Synthetic detail with a longer value that should wrap cleanly on a small screen. <strong>This markup stays plain text.</strong>\nA second line remains readable." }], editable: { ...base.editable, lastName: "Overdue Follow-up" } },
  { ...base, id: "sample-upcoming", name: "Sample Upcoming Follow-up", email: "sample.upcoming@example.com", stage: "under_contract", source: "sphere", nextFollowUpDate: follow(4), neighborhood: "Fort Lauderdale", budget: 450000, lastContactDate: instant(-2), lastTouchDate: instant(-2), editable: { ...base.editable, lastName: "Upcoming Follow-up" } },
  { ...base, id: "sample-quiet", name: "Sample Quiet Relationship", email: "sample.quiet@example.com", stage: "lead", source: "open_house", intent: "sell", nextFollowUpDate: undefined, lastContactDate: instant(-35), lastTouchDate: undefined, editable: { ...base.editable, lastName: "Quiet Relationship" } },
  { ...base, id: "sample-past-client", name: "Sample Past Client", email: "sample.past@example.com", stage: "past_client", source: "past_client", intent: "other", lastContactDate: instant(-50), lastTouchDate: instant(-50), editable: { ...base.editable, lastName: "Past Client" } },
  { ...base, id: "sample-colleague-contact", name: "Sample Colleague Contact", email: "sample.colleague@example.com", stage: "appointment", source: "social", assignedAgentId: SAMPLE_COLLEAGUE_ID, assignedAgentName: "Sample Colleague", ownedByViewer: false, editable: { ...base.editable, lastName: "Colleague Contact" } },
  { ...base, id: "sample-labeled-fallback", name: "Sample Labeled Fallback", email: "sample.fallback@example.com", stage: "contacted", source: "other", intent: "other", recordSource: "sample", updatedAt: undefined, editable: undefined, notes: "Sample-record fallback: notes and client needs are intentionally unavailable in this source mode." },
  { ...base, id: "sample-long-history", name: "Sample Long History", email: "sample.history@example.com", stage: "past_client", source: "past_client", intent: "other", lastContactDate: instant(-60), lastTouchDate: instant(-60), notes: "Synthetic long-history contact. Every note, activity and client need is a fixture for paged-history review.", editable: { ...base.editable, lastName: "Long History" } },
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

// Real action DTOs with synthetic identities. Every legacy day mirror is
// derived from the same due instant, never an independent fixture date.
const actionAt = (days, time) => {
  const result = businessLocalToUtc(day(days), time);
  if (!result.ok) throw new Error("Invalid synthetic action time");
  return result.dueAt;
};
const actionCases = [
  ["sample-due-today", "call", "Sample call to confirm the preferred showing times.", actionAt(0, "17:00"), SAMPLE_AGENT_ID],
  ["sample-overdue", "email", "Sample email to review the property shortlist and agree on a next step.", actionAt(-3, "10:15"), SAMPLE_AGENT_ID],
  ["sample-upcoming", "meeting", "Sample meeting to review financing questions.", actionAt(4, "14:30"), SAMPLE_AGENT_ID],
  ["sample-past-client", "call", "Sample pending call retained after the relationship left the open pipeline.", actionAt(-1, "11:00"), SAMPLE_AGENT_ID],
  ["sample-colleague-contact", "text", "Sample text to confirm the appointment with the assigned agent.", actionAt(1, "11:00"), SAMPLE_COLLEAGUE_ID],
  ["sample-contact-23", "custom", "Sample longer purpose: prepare a clear written recap of the client's priorities, compare the next property options and confirm timing with the assigned agent. This synthetic action tests readable wrapping on a small screen.", actionAt(2, "09:45"), SAMPLE_AGENT_ID],
];
for (const [index, [id, kind, purpose, dueAt, assigneeId]] of actionCases.entries()) {
  const contact = previewContacts.find(item => item.id === id);
  contact.nextAction = { id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, kind, purpose, dueAt, assigneeId, assigneeName: contactAgents.find(agent => agent.id === assigneeId).name };
  contact.nextFollowUpDate = nextActionDayMirror(dueAt);
}
// Deliberately retain a date-only reminder for legacy comparison.
previewContacts.find(contact => contact.id === "sample-contact-01").nextFollowUpDate = follow(0);

export const contactNotes = {
  "sample-overdue": [
    { id: "sample-note-2", body: "Sample note: review the next round of property options and confirm the preferred showing times. This is synthetic preview content.", createdAt: instant(-2), author: "Sample Agent", canDelete: true },
    { id: "sample-note-1", body: "Sample note: the client prefers a quiet street and room for a home office.\nNo actual client information is stored here.", createdAt: instant(-10), author: "Sample Agent", canDelete: true },
  ],
  "sample-upcoming": [{ id: "sample-note-3", body: "Sample note: financing questions have been collected for the next call.", createdAt: instant(-1), author: "Sample Agent", canDelete: true }],
  "sample-long-history": Array.from({ length: 137 }, (_, index) => ({
    id: `sample-long-note-${String(index + 1).padStart(4, "0")}`,
    body: `Synthetic note ${index + 1} of 137. This sample entry verifies that older notes remain reachable through paging. No actual client information is stored here.`,
    createdAt: new Date(contactFixtureNow.getTime() - Math.floor(index / 5) * 3_600_000).toISOString(),
    author: "Sample Agent", canDelete: true,
  })),
};
export const contactNeeds = {
  "sample-overdue": [{ id: "sample-need-1", kind: "buy", status: "active", propertyTypes: ["singleFamily", "townhouse"], areas: ["Fort Lauderdale", "Hollywood"], priceMinCents: 65000000, priceMaxCents: 80000000, minBeds: 3, minBaths: 2, minSqft: 1700, targetDate: day(75), timelineNote: "Sample target: within the next quarter", financing: "conventional", mustHaves: ["Home office", "Outdoor space"], avoid: ["Major roads"], additionalRequirements: "Synthetic requirements for visual review only.", createdAt: instant(-14), updatedAt: instant(-5) }],
  "sample-upcoming": [{ id: "sample-need-2", kind: "buy", status: "fulfilled", propertyTypes: ["condo"], areas: ["Fort Lauderdale"], priceMinCents: 35000000, priceMaxCents: 45000000, minBeds: 2, minBaths: 2, minSqft: null, targetDate: null, timelineNote: null, financing: "conventional", mustHaves: [], avoid: [], additionalRequirements: null, createdAt: instant(-30), updatedAt: instant(-2) }],
  "sample-long-history": Array.from({ length: 127 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    kind: ["buy", "sell", "rent", "lease", "other"][index % 5], status: ["active", "paused", "fulfilled", "archived"][index % 4],
    propertyTypes: index % 2 ? ["condo", "townhouse"] : ["singleFamily"],
    areas: [index % 2 ? "Hollywood" : "Fort Lauderdale"], priceMinCents: 20000000 + index * 100000,
    priceMaxCents: 30000000 + index * 100000, minBeds: 2 + index % 3, minBaths: index % 2 ? 2.5 : 2,
    minSqft: 1200 + index * 10, targetDate: day(30 + index), timelineNote: `Synthetic target window ${index + 1}`,
    financing: ["cash", "conventional", "fha", "va", "other", "unknown"][index % 6],
    mustHaves: ["Synthetic home office", `Sample requirement ${index + 1}`], avoid: ["Synthetic major-road exclusion"],
    additionalRequirements: `Synthetic additional requirement ${index + 1} of 127. This stored detail must remain readable without entering an edit form.`,
    createdAt: instant(-90), updatedAt: new Date(contactFixtureNow.getTime() - Math.floor(index / 5) * 3_600_000).toISOString(),
  })),
};
contactNeeds["sample-overdue"].push(
  { ...contactNeeds["sample-overdue"][0], id: "20000000-0000-4000-8000-000000000001", kind: "other", kindOther: "Synthetic relocation planning", propertyTypes: ["other"], propertyTypeOther: "Sample live/work loft", financing: "other", financingOther: "Sample employer-assisted financing", areas: ["Fort Lauderdale"], priceMinCents: null, priceMaxCents: null, minBeds: null, minBaths: null, minSqft: null, targetDate: null, timelineNote: null, mustHaves: [], avoid: [], additionalRequirements: "A populated Other example; every description is synthetic.", createdAt: instant(-12), updatedAt: instant(-6) },
  { ...contactNeeds["sample-overdue"][0], id: "20000000-0000-4000-8000-000000000002", kind: "other", kindOther: null, propertyTypes: ["other"], propertyTypeOther: null, financing: "other", financingOther: null, status: "paused", areas: [], priceMinCents: null, priceMaxCents: null, minBeds: null, minBaths: null, minSqft: null, targetDate: null, timelineNote: "Synthetic legacy Other without saved descriptions", mustHaves: [], avoid: [], additionalRequirements: null, createdAt: instant(-20), updatedAt: instant(-15) }
);
export function timelineFor(id) {
  if (id === "sample-labeled-fallback" || id === "sample-quiet") return [];
  if (id === "sample-long-history") return Array.from({ length: 143 }, (_, index) => ({
    id: `sample-long-activity-${String(index + 1).padStart(4, "0")}`,
    type: index % 7 === 0 ? "contacted" : ["call", "email", "note", "need", "follow_up_scheduled", "showing", "created"][index % 7],
    title: index % 7 === 0 ? "Marked contacted" : `Sample activity ${index + 1} of 143`,
    detail: `Synthetic history entry ${index + 1}. Older activity must remain reachable through stable paging.`,
    at: new Date(contactFixtureNow.getTime() - Math.floor(index / 5) * 3_600_000).toISOString(), by: "Sample Agent",
  }));
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
