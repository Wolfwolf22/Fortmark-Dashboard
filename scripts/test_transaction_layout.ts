/** Pure layout and personal-workspace validation; no connection settings or network. */
import assert from "node:assert/strict";
import { defaultTransactionLayout, normalizeTransactionLayout, moveVisibleSection, transactionLayoutSchema, TRANSACTION_SECTION_IDS, GC_SECTION_IDS } from "../lib/transactions/layout-domain.ts";
import { namespaceSchema, workspaceWriteSchema } from "../lib/workspaces/contract.ts";
import { DEFAULT_WIDGET_ORDER } from "../lib/stores/widget-order.ts";

let passed = 0;
const check = (name: string, work: () => void) => { work(); passed++; };
const defaults = defaultTransactionLayout();
const owner = "11111111-1111-4111-8111-111111111111";
const write = (layout: unknown = defaults) => ({ accountId: owner, namespace: "transaction-layout", revision: 0, data: { layout: JSON.stringify(layout) } });

check("new namespace accepts only the supported personal name", () => {
  assert.equal(namespaceSchema.parse("transaction-layout"), "transaction-layout");
  assert.equal(namespaceSchema.safeParse("transaction-layout:another-user").success, false);
});
check("default orders contain every supported section exactly once", () => {
  assert.deepEqual(defaults.realEstate, [...TRANSACTION_SECTION_IDS]);
  assert.deepEqual(defaults.gc, [...GC_SECTION_IDS]);
  assert.ok(transactionLayoutSchema.safeParse(defaults).success);
});
check("defaults are independent values that cannot mutate later defaults", () => {
  const changed = defaultTransactionLayout(); changed.realEstate.reverse(); changed.gc.pop();
  assert.deepEqual(defaultTransactionLayout(), defaults);
});
check("partial older definitions append new sections without losing their saved priority", () => {
  const old = { version: 1, realEstate: ["vendors", "deadlines"], gc: ["gc-checklist"] };
  const normalized = normalizeTransactionLayout(old);
  assert.deepEqual(normalized.realEstate, ["vendors", "deadlines", ...TRANSACTION_SECTION_IDS.filter(id => !["vendors", "deadlines"].includes(id))]);
  assert.deepEqual(normalized.gc, ["gc-checklist", "gc-property", "gc-client"]);
  assert.deepEqual(old, { version: 1, realEstate: ["vendors", "deadlines"], gc: ["gc-checklist"] });
});
check("empty persisted profiles restore a complete default view", () => {
  assert.deepEqual(normalizeTransactionLayout({ version: 1, realEstate: [], gc: [] }), defaults);
});
const invalidLayouts: unknown[] = [null, {}, { ...defaults, version: 2 }, { ...defaults, transactionId: owner },
  { ...defaults, realEstate: ["forged"] }, { ...defaults, realEstate: ["vendors", "vendors"] },
  { ...defaults, realEstate: ["gc-client"] }, { ...defaults, gc: ["vendors"] }, { ...defaults, gc: ["gc-client", "gc-client"] },
  { ...defaults, realEstate: Array(TRANSACTION_SECTION_IDS.length + 1).fill("vendors") },
  { ...defaults, gc: Array(GC_SECTION_IDS.length + 1).fill("gc-client") },
];
for (const [index, invalid] of invalidLayouts.entries()) check(`invalid layout ${index} is refused and cannot replace safe defaults`, () => {
  assert.equal(transactionLayoutSchema.safeParse(invalid).success, false);
  assert.deepEqual(normalizeTransactionLayout(invalid), defaults);
});
check("moving visible cards keeps hidden side-specific sections in their original slots", () => {
  const order = ["mls-property", "listing-term", "showing-tours", "open-houses", "vendors", "file-history"];
  const visible = ["mls-property", "showing-tours", "vendors", "file-history"];
  assert.deepEqual(moveVisibleSection(order, visible, "vendors", "mls-property"), ["vendors", "listing-term", "mls-property", "open-houses", "showing-tours", "file-history"]);
  assert.deepEqual(order, ["mls-property", "listing-term", "showing-tours", "open-houses", "vendors", "file-history"]);
});
check("move earlier and later are reversible while hidden cards stay positioned", () => {
  const order = ["deadlines", "listing-term", "vendors", "open-houses", "people"];
  const visible = ["deadlines", "vendors", "people"];
  const earlier = moveVisibleSection(order, visible, "people", "deadlines");
  assert.deepEqual(moveVisibleSection(earlier, visible, "people", "vendors"), order);
});
check("unknown, hidden and same-target moves never drop or duplicate a section", () => {
  const visible = ["vendors", "file-history"];
  for (const [active, target] of [["missing", "vendors"], ["listing-term", "vendors"], ["vendors", "listing-term"], ["vendors", "vendors"]]) {
    assert.deepEqual(moveVisibleSection(defaults.realEstate, visible, active, target), defaults.realEstate);
  }
});
check("stored definitions preserve a hidden card's original order when it becomes visible again", () => {
  const order = ["open-houses", "vendors", "listing-term", "showing-tours", "deadlines"];
  const moved = moveVisibleSection(order, ["vendors", "showing-tours", "deadlines"], "deadlines", "vendors");
  assert.equal(moved.indexOf("open-houses"), order.indexOf("open-houses"));
  assert.equal(moved.indexOf("listing-term"), order.indexOf("listing-term"));
  assert.equal(new Set(moved).size, order.length);
});
check("GC reordering has a separate profile", () => {
  assert.deepEqual(moveVisibleSection(defaults.gc, defaults.gc, "gc-checklist", "gc-property"), ["gc-checklist", "gc-property", "gc-client"]);
  assert.deepEqual(defaults.realEstate, [...TRANSACTION_SECTION_IDS]);
});
check("new workspace writes accept full and older partial layouts", () => {
  assert.ok(workspaceWriteSchema.safeParse(write()).success);
  assert.ok(workspaceWriteSchema.safeParse(write({ version: 1, realEstate: ["vendors"], gc: [] })).success);
});
for (const [index, invalid] of invalidLayouts.entries()) check(`workspace boundary rejects invalid layout ${index}`, () => {
  assert.equal(workspaceWriteSchema.safeParse(write(invalid)).success, false);
});
for (const key of ["notifications", "transactionId", "ownerUserId", "records"]) check(`new namespace refuses unsupported key ${key}`, () => {
  assert.equal(workspaceWriteSchema.safeParse({ ...write(), data: { [key]: JSON.stringify(defaults) } }).success, false);
});
check("prototype-like keys cannot survive validation or change object ownership", () => {
  const parsed = workspaceWriteSchema.safeParse({ ...write(), data: { ["__proto__"]: JSON.stringify({ ownerUserId: owner }) } });
  if (parsed.success) {
    assert.deepEqual(parsed.data.data, {});
    assert.equal(Object.hasOwn(parsed.data.data, "__proto__"), false);
    assert.equal(Object.getPrototypeOf(parsed.data.data), Object.prototype);
  }
});
check("private account and record fields cannot be smuggled into a layout", () => {
  for (const extra of [{ ownerUserId: owner }, { transactionIds: [owner] }, { clientName: "Synthetic private client" }, { notes: "Private business content" }]) {
    assert.equal(workspaceWriteSchema.safeParse(write({ ...defaults, ...extra })).success, false);
  }
  assert.equal(workspaceWriteSchema.safeParse({ ...write(), ownerUserId: owner }).success, false);
});
check("Home and transaction schemas cannot overwrite one another's data shapes", () => {
  const home = { widgetOrder: DEFAULT_WIDGET_ORDER, widgetPeriods: {} };
  assert.ok(workspaceWriteSchema.safeParse({ ...write(home), namespace: "dashboard-layout" }).success);
  assert.equal(workspaceWriteSchema.safeParse(write(home)).success, false);
  assert.equal(workspaceWriteSchema.safeParse({ ...write(), namespace: "dashboard-layout" }).success, false);
});
check("other namespaces and invalid optimistic revisions are refused", () => {
  for (const namespace of ["transactions", "transaction-layout:other", "", "competitive-edge"]) assert.equal(workspaceWriteSchema.safeParse({ ...write(), namespace }).success, false);
  for (const revision of [-1, 0.5, 2147483647]) assert.equal(workspaceWriteSchema.safeParse({ ...write(), revision }).success, false);
});
console.log(`${passed}/${passed} transaction layout contract and ordering checks passed`);
