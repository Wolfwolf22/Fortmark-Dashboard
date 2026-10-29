/** Synthetic, network-free regression checks for Contacts paging and edit drafts. */
import assert from "node:assert/strict";
import type { Lead } from "../lib/data/types.ts";
import { applyQuery } from "../lib/contacts/windows.ts";
import { contactDefaultOrder, contactPageWithinRange, contactWorkspaceRequest, nextContactRefreshDelay } from "../lib/contacts/workspace.ts";
import { contactEditorSnapshot, contactEditorChanged, contactEditorPatch, reviewContactEditor, resolveContactEditorReview } from "../lib/contacts/editor.ts";
import { birthdayEditorSnapshot, birthdayEditorChanged, reviewBirthdayEditor } from "../lib/contacts/birthday-editor.ts";

let passed = 0;
function check(name: string, test: () => void) { test(); passed += 1; console.log(`PASS ${name}`); }
const NOW = new Date("2026-10-29T16:00:00.000Z");
const firstVersion = "2026-10-29T15:00:00.000Z";
const secondVersion = "2026-10-29T15:01:00.000Z";
function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "test-contact", name: "Sample Contact", email: "sample@example.test", phone: "+19545550100", stage: "lead", source: "referral", intent: "other",
    assignedAgentId: "test-owner", createdDate: "2026-10-01T12:00:00.000Z", updatedAt: firstVersion, lastContactDate: "2026-10-01T12:00:00.000Z", notes: "", recordSource: "db",
    editable: { firstName: "Sample", lastName: "Contact", preferredName: "", company: "Original company" }, ...overrides,
  };
}

check("search starts at page one while router/debounce still hold the previous page", () => {
  const filters = { page: 3, source: ["referral"] as Lead["source"][] };
  assert.equal(contactWorkspaceRequest(filters, "older term", 25, true).page, 1);
  assert.equal(contactWorkspaceRequest(filters, "new term", 25, true).page, 1);
  assert.equal(contactWorkspaceRequest({ ...filters, page: undefined }, "new term", 25).page, 1);
  assert.equal(filters.page, 3, "request construction does not mutate URL state");
});
check("settled search pagination and explicit sort remain available", () => {
  const request = contactWorkspaceRequest({ page: 2, sort: "name", dir: "desc" }, " Sample ", 25);
  assert.equal(request.page, 2);
  assert.equal(request.q, "Sample");
  assert.deepEqual([request.sort, request.dir], ["name", "desc"]);
});
check("upcoming, due and overdue reminders default to the earliest follow-up", () => {
  for (const followUp of ["upcoming", "due_today", "overdue"] as const) assert.deepEqual(contactDefaultOrder({ followUp }), { sort: "followUp", dir: "asc" });
  assert.deepEqual(contactDefaultOrder({}), { sort: "lastTouch", dir: "desc" });
});
check("sample list recovers after a result set shrinks below the requested page", () => {
  const result = applyQuery([lead(), lead({ id: "second", name: "Other Person", email: "other@example.test" })], { q: "Sample Contact", page: 3, pageSize: 25 }, NOW);
  assert.equal(result.total, 1);
  assert.equal(result.page, 1);
  assert.equal(result.items[0].id, "test-contact");
});
check("last valid sample page is returned and an empty result returns page one", () => {
  const people = [lead(), lead({ id: "two" }), lead({ id: "three" })];
  const last = applyQuery(people, { page: 99, pageSize: 2 }, NOW);
  assert.equal(last.page, 2);
  assert.equal(last.items.length, 1);
  const empty = applyQuery(people, { q: "does-not-exist", page: 99, pageSize: 2 }, NOW);
  assert.deepEqual([empty.page, empty.total, empty.items.length], [1, 0, 0]);
  assert.equal(contactPageWithinRange(3, 1, 25), 1);
});
check("day-boundary refresh uses the 23-hour spring and 25-hour fall business day", () => {
  assert.equal(nextContactRefreshDelay(new Date("2026-03-08T05:00:00.000Z")), 23 * 3_600_000 + 50);
  assert.equal(nextContactRefreshDelay(new Date("2026-11-01T04:00:00.000Z")), 25 * 3_600_000 + 50);
  assert.equal(nextContactRefreshDelay(new Date("2026-10-30T03:59:59.950Z")), 100);
});

check("opening baseline is copied, and only dirty fields plus its frozen version are sent", () => {
  const person = lead();
  const baseline = contactEditorSnapshot(person);
  const draft = { ...baseline.values, phone: "+19545550199" };
  person.email = "remote@example.test";
  person.updatedAt = secondVersion;
  assert.deepEqual(contactEditorPatch(baseline, draft), { phone: "+19545550199", expectedUpdatedAt: firstVersion });
  assert.equal(baseline.values.email, "sample@example.test");
});
check("unchanged or reverted fields do not become edits when a new prop arrives", () => {
  const baseline = contactEditorSnapshot(lead());
  assert.deepEqual(contactEditorPatch(baseline, { ...baseline.values }), {});
  assert.deepEqual(contactEditorPatch(baseline, { ...baseline.values, email: " sample@example.test " }), {});
  assert(contactEditorChanged(baseline, contactEditorSnapshot(lead({ updatedAt: secondVersion, email: "other@example.test" }))));
});
check("review keeps a dirty phone and accepts a newer untouched email without overwriting it", () => {
  const baseline = contactEditorSnapshot(lead());
  const draft = { ...baseline.values, phone: "+19545550199" };
  const latest = contactEditorSnapshot(lead({ updatedAt: secondVersion, email: "new@example.test" }));
  const review = reviewContactEditor(baseline, draft, latest);
  assert.deepEqual(review.conflicts, []);
  assert.equal(review.values.email, "new@example.test");
  assert.equal(review.values.phone, draft.phone);
  assert.deepEqual(contactEditorPatch(review.latest, review.values), { phone: draft.phone, expectedUpdatedAt: secondVersion });
});
check("overlapping edits cannot adopt a newer version without an explicit field choice", () => {
  const baseline = contactEditorSnapshot(lead());
  const draft = { ...baseline.values, phone: "+19545550199" };
  const latest = contactEditorSnapshot(lead({ updatedAt: secondVersion, phone: "+19545550188" }));
  const review = reviewContactEditor(baseline, draft, latest);
  assert.deepEqual(review.conflicts, ["phone"]);
  assert.equal(resolveContactEditorReview(review, {}), null);
  const saved = resolveContactEditorReview(review, { phone: "saved" })!;
  assert.deepEqual(contactEditorPatch(saved.baseline, saved.values), {});
  const mine = resolveContactEditorReview(review, { phone: "mine" })!;
  assert.deepEqual(contactEditorPatch(mine.baseline, mine.values), { phone: draft.phone, expectedUpdatedAt: secondVersion });
});
check("source changes participate in the same explicit conflict review", () => {
  const baseline = contactEditorSnapshot(lead());
  const review = reviewContactEditor(baseline, { ...baseline.values, source: "website" }, contactEditorSnapshot(lead({ updatedAt: secondVersion, source: "sphere" })));
  assert.deepEqual(review.conflicts, ["source"]);
  assert.equal(resolveContactEditorReview(review, { source: "saved" })!.values.source, "sphere");
});
check("matching independent edits are accepted without a false conflict", () => {
  const baseline = contactEditorSnapshot(lead());
  const latest = contactEditorSnapshot(lead({ updatedAt: secondVersion, email: "same@example.test" }));
  const review = reviewContactEditor(baseline, { ...baseline.values, email: "same@example.test" }, latest);
  assert.deepEqual(review.conflicts, []);
  assert.deepEqual(contactEditorPatch(review.latest, review.values), {});
});
check("a refreshed different contact cannot replace this editor's baseline", () => {
  const baseline = contactEditorSnapshot(lead());
  assert.throws(() => reviewContactEditor(baseline, baseline.values, contactEditorSnapshot(lead({ id: "different" }))));
});
check("birthday opening snapshot retains its observed revision and copied month/day", () => {
  const value = { month: 3, day: 17 };
  const opening = birthdayEditorSnapshot(value, firstVersion);
  value.day = 18;
  assert.deepEqual(opening, { value: { month: 3, day: 17 }, revision: firstVersion });
  assert(birthdayEditorChanged(opening, birthdayEditorSnapshot({ month: 4, day: 2 }, secondVersion)));
  assert.equal(opening.revision, firstVersion, "receiving a newer saved date does not adopt its write token");
});
check("birthday review can preserve the draft or deliberately load the saved date", () => {
  const draft = { month: 2, day: 29 };
  const latest = birthdayEditorSnapshot({ month: 4, day: 2 }, secondVersion);
  const kept = reviewBirthdayEditor(draft, latest, "draft");
  assert.deepEqual(kept.value, draft);
  assert.equal(kept.baseline.revision, secondVersion);
  const saved = reviewBirthdayEditor(draft, latest, "saved");
  assert.deepEqual(saved.value, { month: 4, day: 2 });
  assert.equal(saved.baseline.revision, secondVersion);
  assert.deepEqual(draft, { month: 2, day: 29 }, "explicit review never mutates the original draft");
});
check("birthday review also guards unrelated contact revisions and saved clears", () => {
  const opening = birthdayEditorSnapshot({ month: 3, day: 17 }, firstVersion);
  assert(birthdayEditorChanged(opening, birthdayEditorSnapshot({ month: 3, day: 17 }, secondVersion)));
  const cleared = reviewBirthdayEditor({ month: 3, day: 17 }, birthdayEditorSnapshot(null, secondVersion), "saved");
  assert.equal(cleared.value, null);
  assert(!birthdayEditorChanged(cleared.baseline, opening), "an older prop arriving after review cannot force a false conflict");
});
console.log(`\n${passed}/${passed} Contacts workspace regressions passed`);
