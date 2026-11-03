/** GC operational files must never become sales production, even with contaminated stored facts. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";
import { contacts, dashboardUsers, transactionChecklistItems, transactionDeadlines, transactionEvents, transactionParties, transactions } from "../lib/db/schema.ts";
import { getTransaction } from "../lib/transactions/service.ts";
import { transactionMetrics, transactionAttention, transactionActivity, transactionLeaderboard } from "../lib/transactions/metrics.ts";
import { searchTransactions } from "../lib/transactions/search.ts";
import { listLinkedTransactions } from "../lib/contacts/linked-transactions.ts";
import { parseQuery } from "../lib/search/query.ts";
import { ALL_STAGES } from "../lib/transactions/stages.ts";
let count = 0; function check(name: string, value: unknown): asserts value { assert.ok(value, name); count++; }
const { pg, db } = await createLocalContactDb(), now = new Date("2026-11-03T04:30:00.000Z");
const owner = { userId: randomUUID(), role: "agent" as const, brokerageKey: "fortmark" }, other = { userId: randomUUID(), role: "agent" as const, brokerageKey: "fortmark" }, admin = { userId: randomUUID(), role: "admin" as const, brokerageKey: "fortmark" }, ctx = { actor: owner, db }, adminCtx = { actor: admin, db };
const contactId = randomUUID(), activeId = randomUUID(), closedId = randomUUID(), pausedId = randomUUID();
try {
  await db.insert(dashboardUsers).values([owner, other, admin].map((user, i) => ({ id: user.userId, role: user.role, status: "active" as const, clerkUserId: `gc_metrics_${i}`, primaryEmail: `gc-metrics-${i}@example.test` })));
  await db.insert(contacts).values({ id: contactId, assignedAgentUserId: owner.userId, firstName: "GC client", stage: "lead" });
  await db.insert(transactions).values([
    { id: activeId, brokerageKey: "fortmark", agentUserId: owner.userId, transactionType: "residential_sale", side: "buyer", stage: "financing", addressLine1: "Ordinary active sale", city: "Sample", contractPriceCents: 10000000, commissionRateBps: 300, closingDate: "2026-11-30", contractExecutionDate: "2026-11-01" },
    { id: closedId, brokerageKey: "fortmark", agentUserId: owner.userId, transactionType: "residential_sale", side: "listing", stage: "closed", addressLine1: "Ordinary completed sale", city: "Sample", contractPriceCents: 20000000, commissionRateBps: 400, closedDate: "2026-11-01", closingDate: "2026-11-01", contractExecutionDate: "2026-10-01" },
    { id: pausedId, brokerageKey: "fortmark", agentUserId: owner.userId, transactionType: "residential_sale", side: "buyer", stage: "on_hold", addressLine1: "Ordinary paused sale", city: "Sample", contractPriceCents: 30000000 },
  ]);
  await db.insert(transactionParties).values({ transactionId: activeId, role: "buyer", displayName: "Ordinary sale client", contactId, isPrimary: true });
  await db.insert(transactionDeadlines).values({ transactionId: activeId, kind: "inspection", label: "Ordinary pending inspection", dueDate: "2026-11-02" });
  await db.insert(transactionEvents).values([{ transactionId: activeId, actorUserId: owner.userId, eventType: "transaction_created", createdAt: now }, { transactionId: closedId, actorUserId: owner.userId, eventType: "transaction_stage_changed", safeMetadata: { from: "closing_prep", to: "closed" }, createdAt: now }]);
  const baseline = await transactionMetrics(ctx, now), baselineAdmin = await transactionMetrics(adminCtx, now), baselineLeaders = await transactionLeaderboard(adminCtx, now);
  check("baseline sales production is populated", baseline.activeCount === 1 && baseline.onHoldCount === 1 && baseline.activeVolumeCents === 10000000 && baseline.projectedCommissionCents === 300000 && baseline.closedThisMonthCount === 1 && baseline.closedThisMonthVolumeCents === 20000000);
  const gcRows = ALL_STAGES.map((stage, i) => ({ id: randomUUID(), brokerageKey: "fortmark", agentUserId: owner.userId, transactionType: "general_contractor" as const, side: "gc" as const, stage, addressLine1: `GC contaminated file ${i}`, city: "", contractPriceCents: 900000000, commissionRateBps: 10000, commissionFlatCents: 400000000, contractExecutionDate: "2026-11-01", closingDate: "2026-11-02", closedDate: stage === "closed" ? "2026-11-02" : null }));
  const emptyGcId = randomUUID(), foreignGcId = randomUUID();
  await db.insert(transactions).values([...gcRows, { id: emptyGcId, brokerageKey: "fortmark", agentUserId: owner.userId, transactionType: "general_contractor", side: "gc", stage: "opportunity", addressLine1: "GC legitimate blank setup", city: "" }, { id: foreignGcId, brokerageKey: "fortmark", agentUserId: other.userId, transactionType: "general_contractor", side: "gc", stage: "closed", addressLine1: "GC private colleague file", city: "", contractPriceCents: 999999999, commissionRateBps: 10000, closedDate: "2026-11-02" }]);
  const gcIds: string[] = [...gcRows.map(row => row.id), emptyGcId, foreignGcId];
  await db.insert(transactionParties).values([...gcRows.map(row => ({ transactionId: row.id, role: "other" as const, displayName: "GC client", contactId, isPrimary: true })), { transactionId: emptyGcId, role: "other", displayName: "GC client", contactId, isPrimary: true }]);
  await db.insert(transactionDeadlines).values(gcIds.map(transactionId => ({ transactionId, kind: "closing" as const, label: "GC must not imply a closing deadline", dueDate: "2026-11-01" })));
  await db.insert(transactionEvents).values(gcIds.flatMap(transactionId => [{ transactionId, actorUserId: owner.userId, eventType: "transaction_created", createdAt: new Date(now.getTime() + 1000) }, { transactionId, actorUserId: owner.userId, eventType: "transaction_stage_changed", safeMetadata: { from: "closing_prep", to: "closed" }, createdAt: new Date(now.getTime() + 2000) }]));
  assert.deepEqual(await transactionMetrics(ctx, now), baseline); check("GC does not inflate any own sales total or monthly series", true);
  assert.deepEqual(await transactionMetrics(adminCtx, now), baselineAdmin); check("GC does not inflate privileged brokerage sales production", true);
  assert.deepEqual(await transactionLeaderboard(adminCtx, now), baselineLeaders); check("GC never introduces closed volume or active production leaderboard rows", true);
  const attention = await transactionAttention(ctx, now); check("GC entered dates cannot appear as sales deadline attention", attention.length === 1 && attention[0].label === "Ordinary pending inspection");
  const activity = await transactionActivity(ctx, 100), gcActivity = activity.filter(item => item.summary.startsWith("GC file opened"));
  check("GC creation is named as an operational file without Opportunity", gcActivity.length === gcRows.length + 1 && gcActivity.every(item => item.kind === "transaction_created" && !/opportunity|deal opened|closed/i.test(item.summary)));
  check("GC fake stage history never becomes a sales closure", activity.filter(item => item.kind === "transaction_closed").length === 1 && activity.filter(item => item.kind === "transaction_closed")[0].subject.startsWith("Ordinary completed sale"));
  check("GC colleague activity remains scoped", activity.every(item => !item.summary.includes("private colleague")));
  const projected = await getTransaction(ctx, gcRows.find(row => row.stage === "closed")!.id, now); check("GC client resolves through explicit other-role primary party", projected?.clientName === "GC client" && projected.side === "gc" && projected.transactionType === "general_contractor");
  check("GC projection omits sales financial dates and milestones despite contaminated storage", projected.contractPrice === 0 && projected.commissionRate === 0 && projected.projectedCommission === 0 && projected.contractDate === undefined && projected.closeDate === undefined && projected.milestones.length === 0);
  check("GC status is neutral setup rather than sales lifecycle or missing setup failure", projected.status === "neutral" && projected.statusLabel === "Setup pending");
  const blankProjected = await getTransaction(ctx, emptyGcId, now); check("legitimate blank GC has no invented date or commission", blankProjected !== null && blankProjected.closeDate === undefined && blankProjected.contractDate === undefined && blankProjected.projectedCommission === 0 && blankProjected.statusLabel === "Setup pending");
  const gcSearch = await searchTransactions(ctx, parseQuery("GC contaminated"), 100); check("global search shows GC setup label without sales stage or close-date meta", gcSearch.length === gcRows.length && gcSearch.every(hit => hit.subtitle === "GC · Setup pending" && hit.meta === undefined));
  const partySearch = await searchTransactions(ctx, parseQuery("GC client"), 100); check("global client search finds owned GC operational files", partySearch.length === gcRows.length + 1 && partySearch.every(hit => hit.subtitle === "GC · Setup pending"));
  check("global search cannot disclose another agent's GC file", (await searchTransactions(ctx, parseQuery(foreignGcId), 10)).length === 0);
  const saleSearch = await searchTransactions(ctx, parseQuery(activeId), 10); check("ordinary sale search retains its existing workflow", saleSearch[0].subtitle === "Buyer · Financing");
  const links = await listLinkedTransactions(ctx, contactId); check("contact linked GC files carry a non-sales workflow label", links.ok && links.value.filter(link => gcIds.includes(link.id)).every(link => link.workflowLabel === "Setup pending")); check("ordinary contact-linked sale label contract stays unchanged", links.ok && links.value.find(link => link.id === activeId)?.workflowLabel === undefined);
  check("GC trigger leaves its checklist intentionally empty", (await db.select().from(transactionChecklistItems)).every(item => !gcIds.includes(item.transactionId)));
  check("sales files still receive their required default checklist", (await db.select().from(transactionChecklistItems).where(eq(transactionChecklistItems.transactionId, activeId))).length === 12);
  console.log(`${count}/${count} GC metrics/projection/search checks passed (isolated PostgreSQL; no live access)`);
} finally { await pg.close(); }
