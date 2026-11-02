import assert from "node:assert/strict";
import { DEFAULT_TRANSACTION_CHECKLIST, TRANSACTION_CHECKLIST_VERSION, checklistRequiredStages, checklistBlockers, checklistMissingStages, checklistProgress, transactionChecklistMutationSchema } from "../lib/transactions/checklist-domain.ts";
import { ACTIVE_STAGES } from "../lib/transactions/stages.ts";
let count = 0;
function check(name: string, fn: () => void) { fn(); count++; console.log(`PASS ${name}`); }
const stamp = "2026-11-02T18:00:00.000Z";
const pending = DEFAULT_TRANSACTION_CHECKLIST.map((item, index) => ({ ...item, id: `87000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, completedAt: null as string | null, updatedAt: stamp }));
check("every active stage has required operational steps and stable unique keys", () => {
  assert.equal(TRANSACTION_CHECKLIST_VERSION, "brokerage-starter-v1");
  assert.equal(new Set(pending.map(item => item.templateKey)).size, pending.length);
  for (const stage of ACTIVE_STAGES) assert.ok(pending.some(item => item.stage === stage && item.required));
});
check("starter snapshots cannot be changed through shared default objects", () => {
  assert.ok(Object.isFrozen(DEFAULT_TRANSACTION_CHECKLIST));
  assert.ok(DEFAULT_TRANSACTION_CHECKLIST.every(Object.isFrozen));
});
check("moving to the next stage checks the current checkpoint, not the next one", () => {
  assert.deepEqual(checklistRequiredStages("opportunity", "offer"), ["opportunity"]);
  assert.deepEqual(checklistBlockers(pending, "opportunity", "offer").map(item => item.stage), ["opportunity", "opportunity"]);
});
check("a skipped stage cannot bypass its pending requirements", () => {
  assert.deepEqual(checklistRequiredStages("opportunity", "financing"), ACTIVE_STAGES.slice(0, 4));
  assert.equal(checklistBlockers(pending, "opportunity", "financing").length, 8);
});
check("an advanced legacy file still needs its earlier unchecked requirements", () => {
  assert.equal(checklistBlockers(pending, "financing", "closing_prep").length, 10);
});
check("closing checks every required checkpoint including final file review", () => {
  assert.deepEqual(checklistRequiredStages("closing_prep", "closed"), ACTIVE_STAGES);
  assert.equal(checklistBlockers(pending, "closing_prep", "closed").length, 12);
});
check("a paused file cannot bypass earlier checkpoints by resuming farther ahead", () => {
  assert.deepEqual(checklistRequiredStages("on_hold", "financing"), ACTIVE_STAGES.slice(0, 4));
  assert.deepEqual(checklistRequiredStages("on_hold", "opportunity"), []);
});
check("pause, backward moves and terminal exits remain available without forward gates", () => {
  for (const target of ["on_hold", "cancelled", "withdrawn", "fell_through", "offer", "due_diligence"] as const) assert.deepEqual(checklistRequiredStages("financing", target), []);
  assert.deepEqual(checklistRequiredStages("closed", "offer"), []);
});
check("completing requirements allows advancement without changing future tasks", () => {
  const reviewed = pending.map(item => ({ ...item, completedAt: item.stage === "closing_prep" ? null : stamp }));
  assert.equal(checklistBlockers(reviewed, "financing", "closing_prep").length, 0);
  assert.equal(checklistBlockers(reviewed, "closing_prep", "closed").length, 2);
});
check("reopened requirements block a later move again", () => {
  const reopened = pending.map((item, i) => ({ ...item, completedAt: i === 0 ? null : stamp }));
  assert.equal(checklistBlockers(reopened, "financing", "closing_prep")[0].id, pending[0].id);
});
check("optional steps do not block or inflate required progress", () => {
  const items = [{ ...pending[0], completedAt: stamp }, { ...pending[1], required: false }];
  assert.deepEqual(checklistProgress(items), { completed: 1, required: 1 });
  assert.deepEqual(checklistBlockers(items, "opportunity", "offer"), []);
});
check("empty or partial snapshots cannot grant advancement", () => {
  assert.deepEqual(checklistMissingStages([], "opportunity", "offer"), ["opportunity"]);
  assert.deepEqual(checklistMissingStages(pending.filter(item => item.stage !== "offer"), "opportunity", "under_contract"), ["offer"]);
  assert.deepEqual(checklistMissingStages(pending, "closing_prep", "closed"), []);
});
const mutation = { requestId: "87000000-0000-4000-8000-000000000101", expectedUpdatedAt: stamp, itemId: pending[0].id, expectedItemUpdatedAt: stamp, action: "complete" };
check("checklist mutations require exact revisions and reject supplied actor or completion claims", () => {
  assert.ok(transactionChecklistMutationSchema.safeParse(mutation).success);
  for (const extra of [{ completedAt: stamp }, { actorUserId: pending[1].id }, { label: "Bypass" }]) assert.ok(!transactionChecklistMutationSchema.safeParse({ ...mutation, ...extra }).success);
  assert.ok(!transactionChecklistMutationSchema.safeParse({ ...mutation, expectedItemUpdatedAt: "yesterday" }).success);
  assert.ok(!transactionChecklistMutationSchema.safeParse({ ...mutation, action: "skip" }).success);
});
console.log(`${count}/${count} transaction checklist domain checks passed`);
