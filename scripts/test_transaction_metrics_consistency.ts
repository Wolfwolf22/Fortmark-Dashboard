/** Real isolated SQL proves deadline attention and historical closures remain truthful. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";
import { dashboardUsers, transactions, transactionEvents, transactionDeadlines } from "../lib/db/schema.ts";
import { transactionActivity, transactionAttention } from "../lib/transactions/metrics.ts";
const { pg, db } = await createLocalContactDb(); let checks = 0;
function check(name: string, value: unknown) { assert.ok(value, name); checks++; }
const actor = { userId: "11111111-1111-4111-8111-111111111111", brokerageKey: "fortmark", role: "agent" as const }, ctx = { db, actor }, now = new Date("2026-11-03T04:30:00.000Z");
try {
 await db.insert(dashboardUsers).values({ id: actor.userId, clerkUserId: "synthetic_txn_metrics", primaryEmail: "synthetic@example.invalid", status: "active", role: "agent" });
 const activeId = randomUUID(), closedId = randomUUID();
 await db.insert(transactions).values([{ id: activeId, agentUserId: actor.userId, brokerageKey: "fortmark", transactionType: "residential_sale", side: "buyer", stage: "financing", addressLine1: "Synthetic active file", city: "Sample" }, { id: closedId, agentUserId: actor.userId, brokerageKey: "fortmark", transactionType: "residential_sale", side: "buyer", stage: "closed", closedDate: "2026-11-02", addressLine1: "Synthetic closed file", city: "Sample" }]);
 await db.insert(transactionDeadlines).values([{ transactionId: activeId, kind: "title", label: "Due today", dueDate: "2026-11-02" }, { transactionId: activeId, kind: "inspection", label: "Removed", dueDate: "2026-11-01", removedAt: now }, { transactionId: activeId, kind: "appraisal", label: "Completed", dueDate: "2026-11-01", completedAt: now }, { transactionId: activeId, kind: "financing", label: "Tomorrow", dueDate: "2026-11-03" }, { transactionId: closedId, kind: "other", label: "Closed file past date", dueDate: "2026-11-01" }]);
 const items = await transactionAttention(ctx, now);
 check("only current open deadlines on active files need attention", items.length === 2 && items.every(item => !/Removed|Completed|Closed file/.test(item.label)));
 check("a late New York due-today item remains zero days away rather than overdue", items.some(item => item.label === "Due today" && item.daysAway === 0 && item.kind === "deadline_soon"));
 check("tomorrow remains one New York calendar day away", items.some(item => item.label === "Tomorrow" && item.daysAway === 1));
 await db.insert(transactionEvents).values([{ transactionId: closedId, actorUserId: actor.userId, eventType: "transaction_stage_changed", safeMetadata: { from: "financing", to: "closing_prep" }, createdAt: new Date("2026-11-01T15:00:00Z") }, { transactionId: closedId, actorUserId: actor.userId, eventType: "transaction_stage_changed", safeMetadata: { from: "closing_prep", to: "closed" }, createdAt: new Date("2026-11-02T15:00:00Z") }]);
 const history = await transactionActivity(ctx, 20);
 check("closing a file never relabels its earlier stage events as closures", history.length === 2 && history.filter(item => item.kind === "transaction_closed").length === 1 && history.filter(item => item.kind === "transaction_stage_changed").length === 1);
 console.log(`${checks}/${checks} transaction metrics consistency checks passed (isolated PostgreSQL)`);
} finally { await pg.close(); }
