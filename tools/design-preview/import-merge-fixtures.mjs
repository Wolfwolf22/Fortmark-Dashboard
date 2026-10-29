// Synthetic import/merge cases only. None describes an actual contact.
import { previewContacts, contactFixtureNow, contactAgents, SAMPLE_AGENT_ID, SAMPLE_COLLEAGUE_ID } from "./contact-fixtures.mjs";
import { businessDayKey, nextDay } from "../../lib/metrics/business-day.ts";
import { businessLocalToUtc, nextActionDayMirror } from "../../lib/contacts/next-action.ts";

export const DUPLICATE_PRIMARY_ID = "60000000-0000-4000-8000-000000000001";
export const DUPLICATE_SOURCE_ID = "60000000-0000-4000-8000-000000000002";
export const DUPLICATE_DECOY_ID = "60000000-0000-4000-8000-000000000003";
const copy = value => structuredClone(value);
const ago = days => new Date(contactFixtureNow.getTime() - days * 86_400_000).toISOString();
const baseline = previewContacts.find(contact => contact.id === "sample-quiet");
const nextAt = businessLocalToUtc(nextDay(businessDayKey(contactFixtureNow)), "14:00");
if (!nextAt.ok) throw new Error("Invalid synthetic duplicate action time");
const pending = (id, kind, purpose, assigneeId = SAMPLE_AGENT_ID) => ({ id, kind, purpose, dueAt: nextAt.dueAt, assigneeId, assigneeName: contactAgents.find(agent => agent.id === assigneeId).name });
export const duplicateContacts = [
  { ...copy(baseline), id: DUPLICATE_PRIMARY_ID, name: "Sample Morgan River", email: "sample.morgan@example.com", phone: "+12025550161", stage: "qualified", source: "website", createdDate: ago(60), lastContactDate: ago(9), lastTouchDate: ago(9), about: "Synthetic primary reference for merge review.", personalDetails: [{ label: "Sample preference", value: "Written recap" }], birthday: { month: 2, day: 21 }, notes: "Synthetic primary legacy note.", editable: { firstName: "Sample", lastName: "Morgan River", preferredName: "", company: "Sample Primary Company" }, nextAction: pending("61000000-0000-4000-8000-000000000001", "call", "Synthetic primary call about the next property shortlist."), nextFollowUpDate: nextActionDayMirror(nextAt.dueAt) },
  { ...copy(baseline), id: DUPLICATE_SOURCE_ID, name: "Sample Morgan River", email: "SAMPLE.MORGAN@example.com", phone: "+12025550162", stage: "contacted", source: "referral", createdDate: ago(45), lastContactDate: ago(4), lastTouchDate: ago(4), about: "Synthetic duplicate reference for an explicit field choice.", personalDetails: [{ label: "Sample preference", value: "Morning appointment" }], birthday: { month: 1, day: 15 }, notes: "Synthetic duplicate legacy note.", editable: { firstName: "Sample", lastName: "Morgan River", preferredName: "", company: "Sample Secondary Company" }, nextAction: pending("61000000-0000-4000-8000-000000000002", "email", "Synthetic duplicate email whose pending action needs an explicit decision."), nextFollowUpDate: nextActionDayMirror(nextAt.dueAt) },
  { ...copy(baseline), id: DUPLICATE_DECOY_ID, name: "Sample Morgan River", email: "sample.morgan@example.com", phone: "+12025550161", assignedAgentId: SAMPLE_COLLEAGUE_ID, assignedAgentName: "Sample Colleague", ownedByViewer: false, source: "sphere", editable: { firstName: "Sample", lastName: "Morgan River", preferredName: "", company: "Sample Other Book" }, about: "Synthetic same-name record in another owner's book. Never pair or merge it across books." },
];
// The original visual fixtures share one demonstration phone number. Give
// each read-copy a unique synthetic number so it is not a false duplicate.
export const allPreviewContacts = [...previewContacts.map((contact, index) => ({ ...copy(contact), phone: `+1202555${String(101 + index).padStart(4, "0")}` })), ...duplicateContacts];
// Existing visual URLs stay readable; the new strict import/merge contracts
// receive valid, stable synthetic UUID aliases for those older fixture IDs.
const aliasPairs = previewContacts.map((contact, index) => [`70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, contact.id]);
const aliases = new Map(aliasPairs), publicIds = new Map(aliasPairs.map(([alias, id]) => [id, alias]));
export const previewRecordId = id => aliases.get(id) || id;
export const previewPublicRecordId = id => publicIds.get(id) || id;
export const duplicateNotes = {
  [DUPLICATE_PRIMARY_ID]: [{ id: "62000000-0000-4000-8000-000000000001", body: "Synthetic primary note, retained by ID after merging.", createdAt: ago(8), author: "Sample Agent", canDelete: true }],
  [DUPLICATE_SOURCE_ID]: [{ id: "62000000-0000-4000-8000-000000000002", body: "Synthetic duplicate note, retained by ID after merging.", createdAt: ago(3), author: "Sample Agent", canDelete: true }],
};
const need = { kind: "buy", status: "active", propertyTypes: ["condo"], areas: ["Sample Harbor"], priceMinCents: null, priceMaxCents: 55000000, minBeds: 2, minBaths: null, minSqft: null, targetDate: null, timelineNote: null, financing: "cash", mustHaves: ["Synthetic office"], avoid: [], additionalRequirements: "Synthetic requirement preserved by merge.", createdAt: ago(10), updatedAt: ago(2) };
export const duplicateNeeds = {
  [DUPLICATE_PRIMARY_ID]: [{ ...copy(need), id: "63000000-0000-4000-8000-000000000001" }],
  [DUPLICATE_SOURCE_ID]: [{ ...copy(need), id: "63000000-0000-4000-8000-000000000002", kind: "sell", areas: ["Sample Courtyard"] }],
};
export const duplicateTimeline = {
  [DUPLICATE_PRIMARY_ID]: [{ id: "64000000-0000-4000-8000-000000000001", type: "call", title: "Called client", detail: "Synthetic primary historical call.", at: ago(9), by: "Sample Agent" }],
  [DUPLICATE_SOURCE_ID]: [{ id: "64000000-0000-4000-8000-000000000002", type: "email", title: "Emailed client", detail: "Synthetic duplicate historical email.", at: ago(4), by: "Sample Agent" }],
};
export const duplicateOpportunities = {
  [DUPLICATE_PRIMARY_ID]: [{ id: "65000000-0000-4000-8000-000000000001", kind: "buyer", status: "open", area: "Sample Harbor", budgetMaxCents: 55000000, createdAt: ago(30) }],
  [DUPLICATE_SOURCE_ID]: [{ id: "65000000-0000-4000-8000-000000000002", kind: "seller", status: "open", area: "Sample Courtyard", budgetMaxCents: null, createdAt: ago(20) }],
};
export const contactTransactionIds = {
  "sample-overdue": ["sample-offer"], "sample-upcoming": ["sample-financing"],
  [DUPLICATE_PRIMARY_ID]: ["sample-offer"], [DUPLICATE_SOURCE_ID]: ["sample-financing"],
};
export const sampleImportCsv = [
  "First name,Last name,Email,Phone,Company,Source,Notes",
  "Sample,New Import,sample.new.import@example.com,+12025550180,Sample New Company,website,Synthetic new contact row",
  "Sample,Morgan River,,+12025550162,Sample Updated Company,referral,Synthetic imported note",
  "Sample,New Import,sample.new.import@example.com,+12025550180,Sample Duplicate In File,website,Synthetic repeated row",
  "Sample,Broken Email,not-an-email,+12025550181,Sample Invalid Company,website,Synthetic invalid row",
  "Sample,Morgan River,sample.morgan@example.com,+12025550161,Sample Matched Company,referral,Synthetic ambiguous match to review or skip",
].join("\n");
