/** Real PostgreSQL list/Home/timeline agreement for timed actions; no live connection. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";
import { contacts, dashboardUsers, professionalProfiles } from "../lib/db/schema.ts";
import { createContact, getContact, getTimeline, listContactsPage, contactSnapshot, type Ctx } from "../lib/contacts/service.ts";
import { createContactSchema } from "../lib/contacts/domain.ts";
import { contactActivity, contactAttention, contactMetrics } from "../lib/contacts/metrics.ts";
import { getTimelinePage } from "../lib/contacts/history-service.ts";
import { mutateNextAction } from "../lib/contacts/next-action-service.ts";
import { nextActionDayMirror, nextActionStatus } from "../lib/contacts/next-action.ts";
import { effectiveFollowUpStatus } from "../lib/contacts/follow-up.ts";
import { attentionHint, attentionIsOverdue, compareAttention } from "../lib/metrics/attention.ts";
import { applyQuery, snapshotOf } from "../lib/contacts/windows.ts";
import { nextContactRefreshDelay } from "../lib/contacts/workspace.ts";
import type { ContactQuery } from "../lib/contacts/filters.ts";

let passed = 0;
function check(name: string, value: unknown): asserts value { assert.ok(value, name); passed++; }
const { pg, db } = await createLocalContactDb();
const agent = "11111111-1111-4111-8111-111111111111";
const admin = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const ctx: Ctx = { db, actor: { userId: agent, role: "agent", brokerageKey: "fortmark" } };
const NOW = new Date("2026-10-29T17:00:00.000Z"); // 1 PM Eastern
const ids = (rows: { id: string }[]) => rows.map(row => row.id).sort().join();

async function contact(name: string, dueAt?: string, owner = agent, legacy?: string) {
  const result = await createContact({ ...ctx, actor: { ...ctx.actor, userId: owner } }, createContactSchema.parse({ firstName: name }));
  check(`created ${name}`, result.ok);
  if (dueAt) await db.update(contacts).set({
    nextActionId: randomUUID(), nextActionKind: "call", nextActionPurpose: `Purpose for ${name}`,
    nextActionDueAt: new Date(dueAt), nextActionAssignedUserId: admin,
    nextFollowUpAt: new Date(nextActionDayMirror(dueAt)),
  }).where(eq(contacts.id, result.value.id));
  else if (legacy) await db.update(contacts).set({ nextFollowUpAt: new Date(legacy) }).where(eq(contacts.id, result.value.id));
  return result.value.id;
}

try {
  await db.insert(dashboardUsers).values([
    { id: agent, clerkUserId: "synthetic_action_agent", primaryEmail: "agent@example.test", role: "agent", status: "active" },
    { id: admin, clerkUserId: "synthetic_action_admin", primaryEmail: "admin@example.test", role: "admin", status: "active" },
    { id: other, clerkUserId: "synthetic_action_other", primaryEmail: "other@example.test", role: "agent", status: "active" },
  ]);
  await db.insert(professionalProfiles).values([{ userId: agent, preferredDisplayName: "Synthetic Agent" }, { userId: admin, preferredDisplayName: "Synthetic Admin" }]);
  const earlier = await contact("Earlier today", "2026-10-29T14:00:00.000Z");
  const later = await contact("Later today", "2026-10-29T22:00:00.000Z");
  const tomorrow = await contact("Tomorrow", "2026-10-30T14:00:00.000Z");
  const previous = await contact("Prior day", "2026-10-28T14:00:00.000Z");
  const legacy = await contact("Legacy day", undefined, agent, "2026-10-29T12:00:00.000Z");
  await contact("No reminder");
  const hidden = await contact("Another book", "2026-10-29T13:00:00.000Z", other);
  const atExact = new Date("2026-10-29T14:00:00.000Z");

  for (const clock of [atExact, new Date(atExact.getTime() + 1), NOW, new Date("2026-10-30T04:00:00.000Z")]) {
    const all = await listContactsPage(ctx, {}, clock);
    for (const filter of ["overdue", "due_today", "upcoming", "none"] as const) {
      const query: ContactQuery = { followUp: filter, sort: "followUp", dir: "asc" };
      const real = await listContactsPage(ctx, query, clock);
      const memory = applyQuery(all.items, query, clock, agent);
      check(`${filter} SQL and shared evaluator agree at ${clock.toISOString()}`, ids(real.items) === ids(memory.items));
    }
    const realOrder = await listContactsPage(ctx, { sort: "followUp", dir: "asc" }, clock);
    check("timed SQL ordering matches the complete in-memory ordering", realOrder.items.map(row => row.id).join() === applyQuery(all.items, { sort: "followUp", dir: "asc" }, clock, agent).items.map(row => row.id).join());
    const snapshot = await contactSnapshot(ctx, clock), memory = snapshotOf(all.items, clock, agent);
    check("snapshot counts share exact timed predicates", snapshot.overdue === memory.overdue && snapshot.dueToday === memory.dueToday);
  }
  const atNow = await listContactsPage(ctx, {}, NOW);
  const first = atNow.items.find(row => row.id === earlier)!;
  check("list carries purpose, precise time and resolved assignee", first.nextAction?.purpose === "Purpose for Earlier today" && first.nextAction.dueAt === "2026-10-29T14:00:00.000Z" && first.nextAction.assigneeName === "Synthetic Admin");
  check("a same-day passed deadline is overdue everywhere", effectiveFollowUpStatus(first, NOW).state === "overdue" && nextActionStatus(first.nextAction, NOW).state === "overdue");
  check("a day-only reminder stays due today after noon", effectiveFollowUpStatus(atNow.items.find(row => row.id === legacy), NOW).state === "due_today");
  check("an upcoming time today stays due today", effectiveFollowUpStatus(atNow.items.find(row => row.id === later), NOW).state === "due_today");
  check("a future-day action stays upcoming", effectiveFollowUpStatus(atNow.items.find(row => row.id === tomorrow), NOW).state === "future");

  const attention = await contactAttention(ctx, NOW), metrics = await contactMetrics(ctx, NOW);
  check("Home and list have the same due contact set", ids(attention.map(item => ({ id: item.id.replace("follow-up:", "") }))) === [earlier, later, previous, legacy].sort().join());
  check("Home follow-up count agrees with its due rows", metrics.followUpsDue === attention.length);
  const timed = attention.find(item => item.id === `follow-up:${earlier}`)!;
  check("Home exposes action purpose, owner and exact due time", timed.label === "Call" && timed.purpose === first.nextAction?.purpose && timed.assigneeName === "Synthetic Admin" && timed.dueAt === first.nextAction?.dueAt);
  check("same-day overdue flag overrides calendar-zero with correct wording", timed.daysAway === 0 && attentionIsOverdue(timed) && attentionHint(timed) === "overdue today");
  check("same-day overdue sorts ahead of remaining-today work", [...attention].sort(compareAttention).findIndex(item => item.id === timed.id) < [...attention].sort(compareAttention).findIndex(item => item.id === `follow-up:${later}`));
  check("another book cannot leak through a task assignment", !atNow.items.some(row => row.id === hidden) && !attention.some(item => item.id === `follow-up:${hidden}`));
  check("cross-brokerage scoped queue stays empty", (await contactAttention({ ...ctx, actor: { ...ctx.actor, brokerageKey: "elsewhere" } }, NOW)).length === 0);

  const before = await getContact(ctx, earlier);
  check("completion fixture has a revision and pending ID", before?.updatedAt && before.nextAction);
  const complete = await mutateNextAction(ctx, earlier, { action: "complete", expectedUpdatedAt: before.updatedAt, actionId: before.nextAction.id,
    outcome: "<b>Confirmed the next appointment.</b>", next: { kind: "email", purpose: "Send the revised shortlist", dueAt: "2026-10-30T16:00:00.000Z", assigneeId: agent } }, NOW);
  check("completion with successor succeeds through the actual service", complete.ok);
  check("Home removes completed due item when successor is future", !(await contactAttention(ctx, NOW)).some(item => item.id === `follow-up:${earlier}`));
  check("future successor is visible in the matching SQL list", (await listContactsPage(ctx, { followUp: "upcoming" }, NOW)).items.some(row => row.id === earlier));
  check("completion does not manufacture a touch", complete.value.lastTouchDate === before.lastTouchDate && complete.value.lastContactDate === before.lastContactDate);
  const history = await getTimeline(ctx, earlier);
  check("timeline has separately named completion and successor events", history.ok && history.value.some(item => item.title === "Next action completed") && history.value.some(item => item.title === "Next action scheduled"));
  check("timeline retains authorized outcome and original action context", history.value.some(item => item.title === "Next action completed" && item.detail?.includes("Outcome: <b>Confirmed the next appointment.</b>") && item.detail?.includes("Assigned to Synthetic Admin")));
  const paged = await getTimelinePage(ctx, earlier);
  check("actual paginated UI history resolves a distinct assignee", paged.ok && paged.value.items.some(item => item.title === "Next action completed" && item.detail?.includes("Assigned to Synthetic Admin") && item.by === "Synthetic Agent"));
  const recentTasks = (await contactActivity(ctx, 20)).filter(item => item.subject === "Earlier today" && item.summary.startsWith("Next action"));
  check("Home presents internal task history without claiming a contact touch", recentTasks.length === 2 && recentTasks.every(item => item.kind === "contact_task"));
  check("pending times refresh at minute boundaries", nextContactRefreshDelay(new Date("2026-10-29T17:00:30.000Z"), true) === 30_050);
  check("clock refresh still respects the business-day boundary", nextContactRefreshDelay(new Date("2026-10-30T03:59:59.999Z"), true) === 51);
  console.log(`\n${passed}/${passed} Next Action cross-view checks passed (ephemeral PostgreSQL; no live access)`);
} finally { await pg.close(); }
