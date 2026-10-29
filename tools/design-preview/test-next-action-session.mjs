// Run: node --experimental-strip-types --no-warnings tools/design-preview/test-next-action-session.mjs
// Exercises only isolated synthetic state; no database or network service.
import assert from "node:assert/strict";
import * as contacts from "./contact-adapters.mjs";
import { previewContacts, contactNeeds, SAMPLE_AGENT_ID, SAMPLE_COLLEAGUE_ID } from "./contact-fixtures.mjs";
import { getPreviewMetrics, installPreviewTransport, metrics } from "./fixtures.mjs";
import { nextActionDraftSchema, nextActionDayMirror, businessLocalToUtc, formatNextActionDueAt } from "../../lib/contacts/next-action.ts";
import { effectiveFollowUpStatus } from "../../lib/contacts/follow-up.ts";
import { businessDayKey, nextDay } from "../../lib/metrics/business-day.ts";
import { useDataVersion } from "../../lib/data/store.ts";

globalThis.window = Object.assign(new EventTarget(), { location: { search: "", origin: "http://127.0.0.1:4173" } });
const mode = scenario => { window.location.search = `?scenario=${scenario}`; };
const denied = (fn, status) => assert.rejects(fn, error => error.status === status);
const original = JSON.stringify({ previewContacts, contactNeeds });
const originalActivity = JSON.stringify(metrics.activity.data);
const id = "sample-quiet";
const today = businessDayKey(new Date());
const local = (time) => { const value = businessLocalToUtc(nextDay(today), time); assert(value.ok); return value.dueAt; };
const draft = { kind: "call", purpose: "Synthetic first call <b>plain text</b>", dueAt: local("11:30"), assigneeId: SAMPLE_AGENT_ID };
let groups = 0;

mode("records");
const baseline = await contacts.getLead(id);
await denied(() => contacts.updateNextAction(id, { action: "set", expectedUpdatedAt: baseline.updatedAt, expectedActionId: null, next: draft }), 403);
assert.equal((await contacts.getLead(id)).nextAction, undefined);
for (const contact of previewContacts.filter(contact => contact.nextAction)) {
  const { id: actionId, assigneeName, ...input } = contact.nextAction;
  assert(nextActionDraftSchema.safeParse(input).success, contact.id);
  assert.equal(contact.nextFollowUpDate, nextActionDayMirror(input.dueAt));
}
assert.deepEqual((await contacts.getNextActionAssignees("sample-colleague-contact")).map(agent => agent.id), [SAMPLE_AGENT_ID, SAMPLE_COLLEAGUE_ID]);
assert.equal((await contacts.getNextActionAssignees("sample-labeled-fallback")).length, 0); groups++;

mode("interactive");
const set = { action: "set", expectedUpdatedAt: baseline.updatedAt, expectedActionId: null, next: draft };
for (const invalid of [{ ...draft, purpose: " " }, { ...draft, purpose: "x".repeat(241) }, { ...draft, purpose: "nul\u0000" }, { ...draft, dueAt: "not a time" }, { ...draft, assigneeId: "invalid" }]) {
  await denied(() => contacts.updateNextAction(id, { ...set, next: invalid }), 400);
}
await denied(() => contacts.updateNextAction(id, { ...set, next: { ...draft, assigneeId: SAMPLE_COLLEAGUE_ID } }), 400);
await denied(() => contacts.updateNextAction(id, { ...set, next: { ...draft, dueAt: new Date(Date.now() - 60_000).toISOString() } }), 400);
await denied(() => contacts.updateNextAction(id, { ...set, next: { ...draft, dueAt: new Date(Date.now() + 733 * 86_400_000).toISOString() } }), 400);
await denied(() => contacts.updateNextAction(id, { ...set, unexpected: "field" }), 400);
assert.equal((await contacts.getLead(id)).updatedAt, baseline.updatedAt); groups++;

// Two simultaneous saves cannot both pass the same revision/action-ID guard.
const concurrent = await Promise.allSettled([contacts.updateNextAction(id, set), contacts.updateNextAction(id, set)]);
assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1);
assert.equal(concurrent.filter(result => result.status === "rejected" && result.reason.status === 409).length, 1);
let lead = await contacts.getLead(id);
assert(lead.nextAction.id);
assert.equal(lead.nextFollowUpDate, nextActionDayMirror(draft.dueAt));
assert.equal(lead.lastContactDate, baseline.lastContactDate);
assert.equal(lead.lastTouchDate, baseline.lastTouchDate);
let history = await contacts.getTimeline(id);
assert.equal(history[0].title, "Next action scheduled");
assert(history[0].detail.includes(draft.purpose));
assert(history[0].detail.includes(formatNextActionDueAt(draft.dueAt)));
assert(history[0].detail.includes("Assigned to Sample Agent")); groups++;
let activity = getPreviewMetrics().activity.data;
const scheduledActivity = activity.find(item => item.id === `contact:${history[0].id}`);
assert.deepEqual(scheduledActivity, { id: `contact:${history[0].id}`, kind: "contact_task", summary: "Next action scheduled", subject: lead.name, at: history[0].at, href: `/contacts?open=${id}` });
assert(!JSON.stringify(scheduledActivity).includes(draft.purpose));
assert.equal(JSON.stringify(metrics.activity.data), originalActivity);

// The shared status and queue fields are based on the exact action timestamp.
const atNoon = new Date(local("12:00"));
const laterContact = await contacts.getLead("sample-contact-02");
await contacts.updateNextAction(laterContact.id, { action: "set", expectedUpdatedAt: laterContact.updatedAt, expectedActionId: null, next: { ...draft, dueAt: local("14:30") } });
const attention = getPreviewMetrics(atNoon).attention.data;
const row = attention.items.find(item => item.id === `follow-up:${id}`);
assert.equal(row.daysAway, 0); assert.equal(row.overdue, true);
assert.equal(row.purpose, draft.purpose); assert.equal(row.actionKind, "call");
assert.equal(row.dueAt, draft.dueAt); assert.equal(row.assigneeName, "Sample Agent");
assert(attention.overdueCount > 0);
assert(attention.items.findIndex(item => item.id === row.id) < attention.items.findIndex(item => item.id === `follow-up:${laterContact.id}`));
const currentStatus = effectiveFollowUpStatus(lead);
const filter = currentStatus.state === "future" ? "upcoming" : currentStatus.state;
assert((await contacts.getLeadsPage({ followUp: filter, active: true })).items.some(item => item.id === id));
const snap = await contacts.getLeadSnapshot();
assert.equal(snap.dueToday, (await contacts.getLeadsPage({ followUp: "due_today", active: true })).total);
assert.equal(snap.overdue, (await contacts.getLeadsPage({ followUp: "overdue", active: true })).total);
assert.equal(getPreviewMetrics().contacts.data.followUpsDue, snap.dueToday + snap.overdue); groups++;

const beforeNoop = lead.updatedAt;
const beforeNoopVersion = useDataVersion.getState().version;
lead = await contacts.updateNextAction(id, { action: "set", expectedUpdatedAt: lead.updatedAt, expectedActionId: lead.nextAction.id, next: draft });
assert.equal(lead.updatedAt, beforeNoop);
assert.equal(useDataVersion.getState().version, beforeNoopVersion);
assert.equal((await contacts.getTimeline(id)).length, history.length);
const originalActionId = lead.nextAction.id;
lead = await contacts.updateNextAction(id, { action: "set", expectedUpdatedAt: lead.updatedAt, expectedActionId: lead.nextAction.id, next: { ...draft, kind: "text", purpose: "Synthetic edited purpose" } });
assert.equal(lead.nextAction.id, originalActionId);
assert.equal((await contacts.getTimeline(id))[0].title, "Next action updated");
lead = await contacts.updateNextAction(id, { action: "set", expectedUpdatedAt: lead.updatedAt, expectedActionId: lead.nextAction.id, next: { ...draft, dueAt: "2027-01-05T09:30:00-05:00" } });
assert.equal(lead.nextAction.id, originalActionId);
assert.equal(lead.nextAction.dueAt, "2027-01-05T14:30:00.000Z");
assert.equal(lead.nextFollowUpDate, "2027-01-05T12:00:00.000Z");
assert.equal((await contacts.getTimeline(id))[0].title, "Next action rescheduled"); groups++;

// A frozen submitted draft survives a refusal; a fresh reviewed revision can retry.
const complete = { action: "complete", expectedUpdatedAt: lead.updatedAt, actionId: lead.nextAction.id, outcome: "Synthetic outcome <script>plain text</script>", next: { ...draft, kind: "meeting", purpose: "Synthetic successor meeting", dueAt: "2027-01-08T15:00:00.000Z" } };
await denied(() => contacts.updateNextAction(id, { ...complete, next: { ...draft, dueAt: new Date(Date.now() - 60_000).toISOString() } }), 400);
const keptDraft = JSON.stringify(complete);
await contacts.updateLeadStage(id, "qualified", { expectedStage: lead.stage });
await denied(() => contacts.updateNextAction(id, complete), 409);
assert.equal(JSON.stringify(complete), keptDraft);
lead = await contacts.getLead(id);
await denied(() => contacts.updateNextAction(id, { ...complete, expectedUpdatedAt: lead.updatedAt, actionId: "60000000-0000-4000-8000-000000000099" }), 409);
const beforeCompleteVersion = useDataVersion.getState().version;
lead = await contacts.updateNextAction(id, { ...complete, expectedUpdatedAt: lead.updatedAt });
assert.notEqual(lead.nextAction.id, originalActionId);
assert.equal(lead.nextAction.purpose, complete.next.purpose);
assert.equal(lead.nextFollowUpDate, nextActionDayMirror(complete.next.dueAt));
assert.equal(useDataVersion.getState().version, beforeCompleteVersion + 1);
assert.equal(lead.lastContactDate, baseline.lastContactDate);
assert.equal(lead.lastTouchDate, baseline.lastTouchDate);
history = await contacts.getTimeline(id);
assert.equal(history[0].title, "Next action scheduled");
assert.equal(history[1].title, "Next action completed");
assert(history[1].detail.includes(`Outcome: ${complete.outcome}`)); groups++;
activity = getPreviewMetrics().activity.data;
for (const task of history.slice(0, 2)) {
  const item = activity.find(item => item.id === `contact:${task.id}`);
  assert.equal(item.summary, task.title); assert.equal(item.kind, "contact_task");
  assert.equal(item.subject, lead.name); assert.equal(item.at, task.at);
  assert.deepEqual(Object.keys(item).sort(), ["at", "href", "id", "kind", "subject", "summary"]);
  assert(!JSON.stringify(item).includes(complete.outcome));
  assert(!JSON.stringify(item).includes(complete.next.purpose));
}
assert(activity.length <= 8);
assert(activity.every((item, index) => index === 0 || activity[index - 1].at >= item.at));

// Exited contacts may resolve a pending action but cannot receive a successor.
await contacts.updateLeadStage(id, "archived", { expectedStage: lead.stage });
lead = await contacts.getLead(id);
await denied(() => contacts.updateNextAction(id, { action: "complete", actionId: lead.nextAction.id, expectedUpdatedAt: lead.updatedAt, outcome: "Done", next: draft }), 409);
lead = await contacts.updateNextAction(id, { action: "cancel", actionId: lead.nextAction.id, expectedUpdatedAt: lead.updatedAt, reason: "Synthetic cancellation: timing changed" });
assert.equal(lead.nextAction, null); assert.equal(lead.nextFollowUpDate, undefined);
assert.equal((await contacts.getTimeline(id))[0].title, "Next action cancelled");
assert((await contacts.getTimeline(id))[0].detail.includes("Reason: Synthetic cancellation"));
assert(!getPreviewMetrics().attention.data.items.some(item => item.id === `follow-up:${id}`));
await denied(() => contacts.updateNextAction(id, { action: "set", expectedUpdatedAt: lead.updatedAt, expectedActionId: null, next: draft }), 409);
await contacts.updateLeadStage(id, "lead", { expectedStage: "archived" });
lead = await contacts.getLead(id);
lead = await contacts.updateNextAction(id, { action: "set", expectedUpdatedAt: lead.updatedAt, expectedActionId: null, next: draft });
lead = await contacts.updateNextAction(id, { action: "complete", expectedUpdatedAt: lead.updatedAt, actionId: lead.nextAction.id, outcome: "Synthetic completion without successor" });
assert.equal(lead.nextAction, null); assert.equal(lead.nextFollowUpDate, undefined); groups++;

// A colleague's owner and the existing Admin reader are the only assignees.
let colleague = await contacts.getLead("sample-colleague-contact");
colleague = await contacts.updateNextAction(colleague.id, { action: "set", expectedUpdatedAt: colleague.updatedAt, expectedActionId: colleague.nextAction.id, next: { ...draft, assigneeId: SAMPLE_COLLEAGUE_ID } });
assert.equal(colleague.nextAction.assigneeName, "Sample Colleague");
assert.equal(colleague.assignedAgentId, SAMPLE_COLLEAGUE_ID);
assert.equal(colleague.ownedByViewer, false);
let overdue = await contacts.getLead("sample-overdue");
const { id: overdueId, assigneeName, ...overdueDraft } = overdue.nextAction;
overdue = await contacts.updateNextAction(overdue.id, { action: "set", expectedUpdatedAt: overdue.updatedAt, expectedActionId: overdueId, next: { ...overdueDraft, purpose: "Synthetic corrected purpose on the same existing overdue action" } });
assert.equal(overdue.nextAction.dueAt, overdueDraft.dueAt);
await denied(() => contacts.updateNextAction(overdue.id, { action: "set", expectedUpdatedAt: overdue.updatedAt, expectedActionId: overdueId, next: { ...overdueDraft, dueAt: new Date(Date.parse(overdueDraft.dueAt) + 60_000).toISOString() } }), 400);
await denied(() => contacts.changeFollowUp(id, { action: "schedule", day: today }), 403);
await denied(() => contacts.logTouch(id, {}), 403);
await denied(() => contacts.updateNextAction("sample-labeled-fallback", set), 403);
installPreviewTransport();
assert.equal((await window.fetch("/api/contacts/x/next-action", { method: "POST", body: JSON.stringify(set) })).status, 403);
assert.equal((await window.fetch("https://example.invalid/next-action", { method: "POST" })).status, 403);
assert.equal(JSON.stringify({ previewContacts, contactNeeds }), original); groups++;

// The explicit read-only conflict rehearsal reveals a preset newer read only.
mode("conflict");
let remote = await contacts.getLead("sample-overdue");
const remoteDraft = { action: "set", expectedUpdatedAt: remote.updatedAt, expectedActionId: remote.nextAction.id, next: draft };
const keptRemote = JSON.stringify(remoteDraft);
await denied(() => contacts.updateNextAction(remote.id, remoteDraft), 409);
const latest = await contacts.getLead(remote.id);
assert(latest.nextAction.purpose.includes("Synthetic newer action"));
assert.notEqual(latest.updatedAt, remote.updatedAt);
assert.notEqual(latest.nextAction.dueAt, remote.nextAction.dueAt);
assert.equal(JSON.stringify(remoteDraft), keptRemote);
await denied(() => contacts.updateNextAction(remote.id, { ...remoteDraft, expectedUpdatedAt: latest.updatedAt }), 403);
await denied(() => contacts.updateContact(remote.id, { company: "Kept Company draft" }), 409);
assert.equal((await contacts.getLead(remote.id)).editable.company, "Sample Company - remote version");
remote = await contacts.getLead("sample-upcoming");
await denied(() => contacts.updateNextAction(remote.id, { action: "complete", expectedUpdatedAt: remote.updatedAt, actionId: remote.nextAction.id, outcome: "Kept completion draft" }), 409);
assert.notEqual((await contacts.getLead(remote.id)).nextAction.id, remote.nextAction.id);
mode("records");
assert.equal(JSON.stringify(getPreviewMetrics().activity.data), originalActivity);
assert.equal((await contacts.getLead(id)).nextAction, undefined);
assert.equal((await contacts.getLead("sample-overdue")).nextAction.purpose, previewContacts.find(contact => contact.id === "sample-overdue").nextAction.purpose);
assert.equal(JSON.stringify({ previewContacts, contactNeeds }), original); groups++;
mode("interactive");
const freshPageSession = await import("./sample-session.mjs?fresh-page-session");
assert.equal(freshPageSession.readSampleActionActivity().length, 0);
assert.equal(JSON.stringify(metrics.activity.data), originalActivity); groups++;

console.log(`PASS: ${groups} isolated NextAction groups (CAS/concurrency, schema, eligibility, exact clock/mirror, no-op/edit/reschedule, completion/successor, cancellation, history, Home/list/activity agreement, denied transport, conflict draft and immutable base/reset).`);
