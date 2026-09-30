/**
 * Stage writers, behaviourally: atomic, authorized, and honest about the rules.
 *
 * The structural suites read the source and check that a stage change goes
 * through `db.batch`. That proves the intent, not the outcome. This runs the
 * real `changeStage` for transactions and for contacts against an in-memory
 * database that models a transaction — statements handed to `batch` apply
 * together or not at all — and forces each required write to fail in turn.
 *
 * Every refusal is paired with the same request succeeding for an authorized
 * caller, and every "nothing changed" with a run where the same field changes.
 *
 * Pinned as CURRENT behaviour, not endorsed: a transaction can be closed
 * without a contract price (known debt, recorded in the master checklist).
 *
 * No database is contacted.
 *
 * Run: npm run test:atomicity
 */
import type { Actor } from "../lib/auth/actor.ts";
import { changeStage as changeContactStage } from "../lib/contacts/service.ts";
import { ALL_CONTACT_STAGES, canTransition as canContactTransition } from "../lib/contacts/stages.ts";
import { auditEvents, contactActivities, contacts, transactionEvents, transactions } from "../lib/db/schema.ts";
import { changeStage as changeTransactionStage, planStageChange } from "../lib/transactions/service.ts";
import { ALL_STAGES, canTransition, isTerminalStage } from "../lib/transactions/stages.ts";
import type { TransactionStage } from "../lib/data/types.ts";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean): void {
  if (condition) passed++;
  else {
    failures.push(name);
    console.log(`FAIL  ${name}`);
  }
}

const NOW = new Date("2026-09-28T16:00:00.000Z");
const AGENT: Actor = { userId: "11111111-1111-4111-8111-111111111111", role: "agent", brokerageKey: "fortmark" };
const OTHER_AGENT: Actor = { userId: "22222222-2222-4222-8222-222222222222", role: "agent", brokerageKey: "fortmark" };
const MEMBER: Actor = { ...AGENT, role: "member" };
const BROKER: Actor = { userId: "33333333-3333-4333-8333-333333333333", role: "broker", brokerageKey: "fortmark" };
const ADMIN: Actor = { userId: "55555555-5555-4555-8555-555555555555", role: "admin", brokerageKey: "fortmark" };
const COORDINATOR: Actor = { userId: "66666666-6666-4666-8666-666666666666", role: "transaction_coordinator", brokerageKey: "fortmark" };
const OUTSIDER: Actor = { userId: "44444444-4444-4444-8444-444444444444", role: "admin", brokerageKey: "elsewhere" };
const ID = "5b8f6a1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b";

// --- An in-memory database that models transactions ----------------------------------
type Applied = { table: unknown; kind: "insert" | "update"; values: Record<string, unknown> };
type Stmt = { table: unknown; kind: "insert" | "update"; values: Record<string, unknown>; run: () => void };

function memoryDb(tableRow: { table: unknown; row: Record<string, unknown> }, failOn?: unknown) {
  const applied: Applied[] = [];
  let batches = 0;
  const select = () => {
    let rows: unknown[] = [];
    const b = {
      from(t: unknown) { rows = t === tableRow.table ? [{ ...tableRow.row }] : []; return b; },
      where() { return b; }, limit() { return b; }, orderBy() { return b; },
      then(ok: (v: unknown[]) => unknown, fail?: (e: unknown) => unknown) { return Promise.resolve(rows).then(ok, fail); },
    };
    return b;
  };
  const statement = (table: unknown, kind: "insert" | "update", values: Record<string, unknown>) => {
    const s: Stmt & { then: PromiseLike<unknown>["then"]; returning: () => Promise<unknown[]> } = {
      table, kind, values,
      run() {
        if (failOn !== undefined && table === failOn) throw new Error("simulated write failure");
        if (kind === "update") Object.assign(tableRow.row, values);
        applied.push({ table, kind, values });
      },
      then(ok, fail) { return new Promise<unknown>((res) => { s.run(); res(undefined); }).then(ok, fail); },
      returning: () => Promise.resolve([]),
    };
    return s;
  };
  const db = {
    select,
    insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => statement(table, "insert", values) }),
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: () => statement(table, "update", values) }) }),
    async batch(stmts: Stmt[]) {
      batches++;
      const snapshot = { ...tableRow.row };
      const before = applied.length;
      try { for (const s of stmts) s.run(); }
      catch (e) { Object.assign(tableRow.row, snapshot); applied.length = before; throw e; }
    },
  };
  return { db, applied, batchCount: () => batches, row: tableRow.row };
}
const count = (m: { applied: Applied[] }, table: unknown) => m.applied.filter((w) => w.table === table).length;

// --- Transactions ------------------------------------------------------------------------
function txnRow(stage: string, over: Record<string, unknown> = {}) {
  return {
    id: ID, brokerageKey: "fortmark", agentUserId: AGENT.userId, createdByUserId: AGENT.userId, updatedByUserId: AGENT.userId,
    transactionType: "residential_sale", side: "buyer", stage,
    addressLine1: "1 Synthetic Way", addressLine2: null, city: "Fort Lauderdale", state: "FL", postalCode: "33301", county: null,
    propertySubType: null, listingKey: null, mlsNumber: null,
    listPriceCents: null, offerPriceCents: null, contractPriceCents: 125_000_000,
    commissionRateBps: 300, commissionFlatCents: null, agentSplitBps: 7_000, transactionFeeCents: null, referralFeeBps: null, referralPayee: null,
    commissionPaidCents: null, commissionPaidAt: null,
    contractExecutionDate: null, effectiveDate: null, closingDate: "2026-10-30", closedDate: null, possessionDate: null, cancelledDate: null,
    notes: null, createdAt: new Date("2026-08-15T15:00:00Z"), updatedAt: new Date("2026-08-15T15:00:00Z"), ...over,
  };
}
const txn = (actor: Actor, from: string, to: string, opts: { failOn?: unknown; row?: Record<string, unknown> } = {}) => {
  const m = memoryDb({ table: transactions, row: txnRow(from, opts.row) }, opts.failOn);
  return changeTransactionStage({ actor, db: m.db as never }, ID, to as TransactionStage, NOW).then((result) => ({ m, result }));
};

{
  const ok = await txn(AGENT, "closing_prep", "closed");
  check("txn: a valid stage change succeeds", ok.result.ok);
  check("txn: the stage moves and the closing date is stamped", ok.m.row.stage === "closed" && ok.m.row.closedDate === "2026-09-28");
  check("txn: exactly one event and one audit are written", count(ok.m, transactionEvents) === 1 && count(ok.m, auditEvents) === 1 && count(ok.m, transactions) === 1);
  check("txn: all three commit in one batch", ok.m.batchCount() === 1);
  check("txn: the actor is the caller", ok.m.applied.find((w) => w.table === transactionEvents)?.values.actorUserId === AGENT.userId);
  check("txn: audit metadata is ids and stages only", Object.keys(ok.m.applied.find((w) => w.table === auditEvents)?.values.safeMetadata as object).sort().join(",") === "from,to,transactionId");

  for (const [label, table] of [["the event", transactionEvents], ["the audit", auditEvents], ["the stage update", transactions]] as const) {
    const bad = await txn(AGENT, "closing_prep", "closed", { failOn: table });
    check(`txn rollback: when ${label} fails the request fails`, !bad.result.ok && bad.result.reason === "unavailable");
    check(`txn rollback: …the stage is unchanged`, bad.m.row.stage === "closing_prep" && bad.m.row.closedDate === null);
    check(`txn rollback: …no event, no audit, no update survives`, bad.m.applied.length === 0);
  }
}

// Authorization, each refusal beside the same request succeeding.
{
  const results = {
    agent: await txn(AGENT, "financing", "closing_prep"),
    broker: await txn(BROKER, "financing", "closing_prep"),
    admin: await txn(ADMIN, "financing", "closing_prep"),
    coordinator: await txn(COORDINATOR, "financing", "closing_prep"),
    member: await txn(MEMBER, "financing", "closing_prep"),
    other: await txn(OTHER_AGENT, "financing", "closing_prep"),
    outsider: await txn(OUTSIDER, "financing", "closing_prep"),
    foreignRow: await txn(BROKER, "financing", "closing_prep", { row: { brokerageKey: "elsewhere" } }),
  };
  check("txn auth: owner, broker, admin and coordinator may move a stage", (["agent", "broker", "admin", "coordinator"] as const).every((k) => results[k].result.ok && results[k].m.row.stage === "closing_prep"));
  check("txn auth: a member is forbidden and nothing is written", !results.member.result.ok && results.member.result.reason === "forbidden" && results.member.m.applied.length === 0);
  check("txn auth: another agent's deal is not found", !results.other.result.ok && results.other.result.reason === "not_found" && results.other.m.applied.length === 0);
  check("txn auth: another brokerage's deal is not found, even for a broker", !results.foreignRow.result.ok && results.foreignRow.result.reason === "not_found" && results.foreignRow.m.applied.length === 0);
  check("txn auth: a caller from another brokerage is not found", !results.outsider.result.ok && results.outsider.result.reason === "not_found" && results.outsider.m.applied.length === 0);
}

// The lifecycle, exhaustively: every pair, and a refused move writes nothing.
{
  let mismatches = 0;
  let refusedWithWrites = 0;
  let allowed = 0;
  for (const from of ALL_STAGES) {
    for (const to of ALL_STAGES) {
      const m = memoryDb({ table: transactions, row: txnRow(from) });
      const plan = await planStageChange({ actor: BROKER, db: m.db as never }, ID, to as TransactionStage, { now: NOW });
      if (plan.ok !== canTransition(from as TransactionStage, to as TransactionStage)) mismatches++;
      if (plan.ok) allowed++;
      if (!plan.ok && m.applied.length > 0) refusedWithWrites++;
    }
  }
  check(`txn lifecycle: the writer agrees with the rule on all ${ALL_STAGES.length ** 2} pairs`, mismatches === 0);
  check("txn lifecycle: a refused move writes nothing", refusedWithWrites === 0);
  check("txn lifecycle: control — some moves are allowed", allowed > 0 && allowed < ALL_STAGES.length ** 2);
  check("txn lifecycle: terminal stages are irreversible", ALL_STAGES.filter((s) => isTerminalStage(s)).every((from) => ALL_STAGES.every((to) => !canTransition(from, to))));
  check("txn lifecycle: control — an active stage can still reach a terminal one", canTransition("financing", "cancelled"));
  check("txn lifecycle: closing is only reachable from closing prep", ALL_STAGES.filter((s) => canTransition(s, "closed")).join(",") === "closing_prep");
  const same = await txn(AGENT, "financing", "financing");
  check("txn lifecycle: a same-stage move is refused and writes no history", !same.result.ok && same.result.reason === "invalid_transition" && same.m.applied.length === 0);
  const cancelled = await txn(AGENT, "financing", "cancelled");
  check("txn dates: a cancellation stamps the cancelled date, not the closed date", cancelled.m.row.cancelledDate === "2026-09-28" && cancelled.m.row.closedDate === null);
  const keepsDate = await txn(AGENT, "on_hold", "financing", { row: { closedDate: null, cancelledDate: "2026-09-01" } });
  check("txn dates: a date already recorded is never cleared", keepsDate.m.row.cancelledDate === "2026-09-01");
  // KNOWN DEBT — pinned as current behaviour, not endorsed.
  const noPrice = await txn(AGENT, "closing_prep", "closed", { row: { contractPriceCents: null, commissionRateBps: null } });
  check("KNOWN DEBT: a deal with no contract price can still be closed (recorded, unchanged)", noPrice.result.ok && noPrice.m.row.stage === "closed");
}

// --- Contacts ------------------------------------------------------------------------------
function contactRow(stage: string, over: Record<string, unknown> = {}) {
  return {
    id: ID, brokerageKey: "fortmark", assignedAgentUserId: AGENT.userId, createdByUserId: AGENT.userId, updatedByUserId: AGENT.userId,
    firstName: "Synthetic", lastName: "Lead", preferredName: null, email: null, phoneE164: null, company: null,
    source: "other", stage, tags: [], notes: null, lastContactAt: null, nextFollowUpAt: null,
    createdAt: new Date("2026-08-20T12:00:00Z"), updatedAt: new Date("2026-09-01T12:00:00Z"), ...over,
  };
}
const contact = (actor: Actor, from: string, to: string, opts: { failOn?: unknown; row?: Record<string, unknown> } = {}) => {
  const m = memoryDb({ table: contacts, row: contactRow(from, opts.row) }, opts.failOn);
  return changeContactStage({ actor, db: m.db as never }, ID, to as never, NOW).then((result) => ({ m, result }));
};

{
  const ok = await contact(AGENT, "contacted", "qualified");
  check("contact: a valid stage change succeeds and moves the stage", ok.result.ok && ok.m.row.stage === "qualified");
  check("contact: exactly one activity and one audit", count(ok.m, contactActivities) === 1 && count(ok.m, auditEvents) === 1 && count(ok.m, contacts) === 1);
  check("contact: the activity is a system status change, not a touch", ok.m.applied.find((w) => w.table === contactActivities)?.values.kind === "status_change");
  check("contact: all three commit in one batch", ok.m.batchCount() === 1);
  check("contact: a stage change does not move last contact", ok.m.row.lastContactAt === null);

  for (const [label, table] of [["the activity", contactActivities], ["the audit", auditEvents], ["the stage update", contacts]] as const) {
    const bad = await contact(AGENT, "contacted", "qualified", { failOn: table });
    check(`contact rollback: when ${label} fails the request fails`, !bad.result.ok && bad.result.reason === "unavailable");
    check(`contact rollback: …the stage is unchanged and nothing else survives`, bad.m.row.stage === "contacted" && bad.m.applied.length === 0);
  }

  const owner = await contact(AGENT, "lead", "contacted");
  const member = await contact(MEMBER, "lead", "contacted");
  const other = await contact(OTHER_AGENT, "lead", "contacted");
  const broker = await contact(BROKER, "lead", "contacted");
  const coordinator = await contact(COORDINATOR, "lead", "contacted");
  const foreign = await contact(BROKER, "lead", "contacted", { row: { brokerageKey: "elsewhere" } });
  check("contact auth: the owner may change a stage", owner.result.ok);
  check("contact auth: a broker or coordinator who does not own the contact cannot — it is not found and nothing is written",
    !broker.result.ok && broker.result.reason === "not_found" && !coordinator.result.ok && coordinator.result.reason === "not_found" &&
      broker.m.applied.length + coordinator.m.applied.length === 0);
  check("contact auth: member forbidden, other agent and other brokerage not found, nothing written",
    !member.result.ok && member.result.reason === "forbidden" && !other.result.ok && other.result.reason === "not_found" &&
      !foreign.result.ok && foreign.result.reason === "not_found" && member.m.applied.length + other.m.applied.length + foreign.m.applied.length === 0);

  const same = await contact(AGENT, "lead", "lead");
  check("contact: a same-stage move is refused and writes nothing", !same.result.ok && same.result.reason === "invalid_transition" && same.m.applied.length === 0);

  // The lifecycle as it stands: archived is a one-way door except an explicit restore to lead.
  const fromArchived = ALL_CONTACT_STAGES.filter((s) => canContactTransition("archived", s));
  check("contact lifecycle: archived can only be restored to lead (unchanged)", fromArchived.join(",") === "lead");
  check("contact lifecycle: control — anything open can be archived", canContactTransition("qualified", "archived"));
  const archive = await contact(AGENT, "qualified", "archived");
  check("contact lifecycle: the manual archive is one atomic change", archive.result.ok && archive.m.row.stage === "archived" && archive.m.batchCount() === 1);
  const restore = await contact(AGENT, "archived", "lead");
  const illegal = await contact(AGENT, "archived", "qualified");
  check("contact lifecycle: restore works, any other move out of archived is refused with no writes", restore.result.ok && !illegal.result.ok && illegal.m.applied.length === 0);
}

const total = passed + failures.length;
console.log(`\n${passed}/${total} atomicity checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
