// Run: node --experimental-strip-types --no-warnings tools/design-preview/test-sample-session.mjs
// Isolated adapter contract checks: no browser, database or real transport.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as contacts from "./contact-adapters.mjs";
import { previewContacts, contactNeeds } from "./contact-fixtures.mjs";
import { readSampleContacts } from "./sample-session.mjs";
import { getPreviewMetrics, installPreviewTransport } from "./fixtures.mjs";
import { useDataVersion } from "../../lib/data/store.ts";
import { ACTIVE_CLIENT_STAGES } from "../../lib/contacts/stages.ts";

globalThis.window = Object.assign(new EventTarget(), { location: { search: "", origin: "http://127.0.0.1:4173" } });
const mode = scenario => { window.location.search = scenario ? `?scenario=${scenario}` : ""; };
const base = JSON.stringify({ previewContacts, contactNeeds });
const refused = (fn, status) => assert.rejects(fn, error => error.status === status);
const id = "sample-overdue";
let checks = 0;
function checked() { checks += 1; }

// Records is still strictly read-only.
await refused(() => contacts.updateLeadStage(id, "closed", { expectedStage: "representation" }), 403);
await refused(() => contacts.createNeed(id, { kind: "buy" }), 403);
await refused(() => contacts.updateContact(id, { about: "Should refuse" }), 403);
assert.equal((await contacts.getLead(id)).stage, "representation"); checked();

mode("interactive");
const before = await contacts.getLead(id);
const overviewBefore = getPreviewMetrics();
const snapshotBefore = await contacts.getLeadSnapshot();
await refused(() => contacts.updateLeadStage(id, "closed", { expectedStage: "lead" }), 409);
await refused(() => contacts.updateLeadStage(id, "unrecognised", { expectedStage: before.stage }), 400);
assert.equal((await contacts.getLead(id)).stage, before.stage); checked();

// A stage changes only the relationship, never an outreach date.
const closed = await contacts.updateLeadStage(id, "closed", { expectedStage: before.stage });
assert.equal(closed.lastContactDate, before.lastContactDate);
assert.equal(closed.lastTouchDate, before.lastTouchDate);
assert(Date.parse(closed.updatedAt) > Date.parse(before.updatedAt));
assert.equal((await contacts.getLeadSnapshot()).active, snapshotBefore.active - 1);
assert.equal(getPreviewMetrics().contacts.data.activeClients, overviewBefore.contacts.data.activeClients - 1);
assert.equal(getPreviewMetrics().contacts.data.followUpsDue, overviewBefore.contacts.data.followUpsDue - 1);
assert(!getPreviewMetrics().attention.data.items.some(item => item.id === `follow-up:${id}`));
assert.equal((await contacts.getLeadsPage({ stage: ["closed"] })).items.some(item => item.id === id), true); checked();

await contacts.updateLeadStage(id, "archived", { expectedStage: "closed" });
await refused(() => contacts.updateLeadStage(id, "qualified", { expectedStage: "archived" }), 409);
await contacts.updateLeadStage(id, "lead", { expectedStage: "archived" });
// Acknowledgement remains a UI-recorded fact, matching the real backend.
await contacts.updateLeadStage(id, "representation", { expectedStage: "lead" });
assert.equal(getPreviewMetrics().contacts.data.activeClients, overviewBefore.contacts.data.activeClients); checked();

const current = await contacts.getLead(id);
await refused(() => contacts.updateContact(id, { about: "Draft", expectedUpdatedAt: before.updatedAt }), 409);
await refused(() => contacts.updateContact(id, { about: "Draft" }), 400);
await refused(() => contacts.updateContact(id, { about: null, expectedUpdatedAt: current.updatedAt }), 400);
await refused(() => contacts.updateContact(id, { personalDetails: null, expectedUpdatedAt: current.updatedAt }), 400);
await refused(() => contacts.updateContact(id, { about: "x".repeat(2001), expectedUpdatedAt: current.updatedAt }), 400);
await refused(() => contacts.updateContact(id, { email: "blocked@example.com", expectedUpdatedAt: current.updatedAt }), 403);
const saved = await contacts.updateContact(id, { about: "  Synthetic saved reference  ", personalDetails: [{ label: "  Preference ", value: " <b>Plain text only</b> " }, { label: " ", value: " " }], expectedUpdatedAt: current.updatedAt });
assert.equal(saved.lead.about, "Synthetic saved reference");
assert.deepEqual(saved.lead.personalDetails, [{ label: "Preference", value: "<b>Plain text only</b>" }]);
assert.deepEqual(saved.changed, ["about", "personalDetails"]);
assert.equal(saved.lead.lastTouchDate, before.lastTouchDate);
const cleared = await contacts.updateContact(id, { about: "", personalDetails: [], expectedUpdatedAt: saved.lead.updatedAt });
assert.equal(cleared.lead.about, ""); assert.deepEqual(cleared.lead.personalDetails, []); checked();

// Shared need validators and planner govern the local write allowlist too.
await refused(() => contacts.createNeed(id, { kind: "other", propertyTypes: ["other"], financing: "other" }), 400);
const revisionBeforeNeed = (await contacts.getLead(id)).updatedAt;
const need = await contacts.createNeed(id, { kind: "other", kindOther: "  Synthetic relocation  ", propertyTypes: ["other"], propertyTypeOther: "  Sample live/work  ", financing: "other", financingOther: "  Sample financing  ", areas: ["Sample Area", "sample area"], priceMaxCents: 45000000 });
assert.equal(need.kindOther, "Synthetic relocation");
assert.equal(need.propertyTypeOther, "Sample live/work");
assert.equal(need.financingOther, "Sample financing");
assert.deepEqual(need.areas, ["Sample Area"]);
assert.equal((await contacts.getLead(id)).budget, 450000);
assert.equal((await contacts.getLead(id)).updatedAt, revisionBeforeNeed);
assert.equal((await contacts.getLead(id)).lastTouchDate, before.lastTouchDate); checked();

const edited = await contacts.updateNeed(id, need.id, { kind: "sell", propertyTypes: ["condo"], financing: "cash", areas: ["Synthetic Harbor"] });
assert.equal(edited.need.kindOther, null);
assert.equal(edited.need.propertyTypeOther, null);
assert.equal(edited.need.financingOther, null);
assert.equal((await contacts.getLead(id)).intent, "both");
assert((await contacts.getLeadsPage({ intent: ["both"] })).items.some(item => item.id === id));
assert((await contacts.getLead(id)).neighborhood.includes("Synthetic Harbor"));
await refused(() => contacts.updateNeed(id, need.id, { priceMinCents: 45000001 }), 400); checked();

const legacyId = "20000000-0000-4000-8000-000000000002";
await contacts.updateNeed(id, legacyId, { status: "active" });
await refused(() => contacts.updateNeed(id, legacyId, { areas: ["Should require descriptions"] }), 400);
await contacts.updateNeed(id, legacyId, { status: "paused" });
for (const item of await contacts.getNeeds(id)) if (item.status === "active") await contacts.updateNeed(id, item.id, { status: "fulfilled" });
const inactive = await contacts.getLead(id);
assert.equal(inactive.intent, "other"); assert.equal(inactive.budget, undefined); assert.equal(inactive.neighborhood, undefined);
assert((await contacts.getLeadsPage({ intent: ["other"] })).items.some(item => item.id === id)); checked();

// No other contact write, sample-source write or network request is allowed.
for (const name of ["addNote", "deleteNote", "markContacted", "logTouch", "changeFollowUp", "createLead"]) await refused(() => contacts[name](id, {}), 403);
await refused(() => contacts.updateLeadStage("sample-labeled-fallback", "lead", { expectedStage: "contacted" }), 403);
installPreviewTransport();
assert.equal((await window.fetch("https://example.invalid/api/contacts")).status, 403);
assert.equal((await window.fetch("/api/contacts", { method: "POST" })).status, 403);
assert.equal((await (await window.fetch("/api/metrics")).json()).contacts.data.activeClients, readSampleContacts().filter(contact => ACTIVE_CLIENT_STAGES.includes(contact.stage)).length);
const visual = await readFile(new URL("./visual-adapters.mjs", import.meta.url), "utf8");
assert(visual.includes("export const updateTransactionStage = readOnly")); checked();

// Existing history paging remains complete with ties and mixed statuses.
for (const [getter, count] of [[contacts.getNotesPage, 137], [contacts.getTimelinePage, 143], [contacts.getNeedsPage, 127]]) {
  let cursor; const ids = [];
  do { const page = await getter("sample-long-history", cursor); assert(page.items.length <= 25); ids.push(...page.items.map(item => item.id)); cursor = page.nextCursor; if (!page.hasMore) break; } while (cursor);
  assert.equal(ids.length, count); assert.equal(new Set(ids).size, count);
} checked();

// Immutable base fixtures and the other read scenarios remain intact.
assert.equal(JSON.stringify({ previewContacts, contactNeeds }), base);
assert(useDataVersion.getState().version > 0);
mode("records");
assert.equal((await contacts.getLead(id)).about, before.about);
assert.equal((await contacts.getLead(id)).stage, before.stage);
assert.equal((await contacts.getNeeds(id)).length, contactNeeds[id].length);
mode("conflict");
await refused(() => contacts.updateContact(id, { company: "Draft" }), 409);
assert.equal((await contacts.getLead(id)).editable.company, "Sample Company - remote version");
await refused(() => contacts.updateContact(id, { about: "Draft" }), 403);
mode("empty"); assert.equal((await contacts.getLeadsPage({})).total, 0);
mode("unavailable"); await refused(() => contacts.getLeadsPage({}), 503); assert.equal((await contacts.getLeadsPage({})).total, 31);
assert.equal(JSON.stringify({ previewContacts, contactNeeds }), base); checked();
console.log(`PASS: ${checks} isolated sample contract groups (stages, revisions, client information, Other needs, projections, history, denied writes and read-only scenarios).`);
