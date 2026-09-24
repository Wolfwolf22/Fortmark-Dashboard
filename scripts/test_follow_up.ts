/**
 * Follow-up capture and the truthful closing date.
 *
 * The product rule under test: logging a touch never clears a follow-up on
 * its own — an attempted call may complete nothing. The reminder changes only
 * when the person picks a new date or explicitly marks it complete.
 *
 * Three layers:
 *   - the pure decision (`resolveFollowUp`) and the request shape;
 *   - the real `logActivity` service against an in-memory stand-in for the
 *     database, so ownership, the stored value and the audit are exercised
 *     end to end (due, future, completed, unauthorized);
 *   - how the Leads screens read a stored follow-up (Home's due rule), and
 *     the quick-create closing date (blank stays unset, entered is kept).
 *
 * No database is contacted.
 *
 * Run: npm run test:follow-up
 */
import { readFileSync } from "node:fs";
import type { Actor } from "../lib/auth/actor.ts";
import { activityInputSchema, resolveFollowUp } from "../lib/contacts/domain.ts";
import {
  followUpLabel,
  followUpStatus,
  formatFollowUpDay,
  isFollowUpDue,
  noRecentTouch,
  NO_TOUCH_LABEL,
} from "../lib/contacts/follow-up.ts";
import { logActivity, type Ctx } from "../lib/contacts/service.ts";
import { auditEvents, contactActivities, contacts } from "../lib/db/schema.ts";
import { closeDateFromInput } from "../lib/transactions/close-date.ts";
import { initialDeadlines } from "../lib/transactions/domain.ts";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean): void {
  if (condition) {
    passed++;
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}`);
  }
}

// Noon UTC on Sep 24 2026 — "today" for every check below.
const NOW = new Date("2026-09-24T12:00:00.000Z");
const at = (day: string) => new Date(`${day}T12:00:00.000Z`);

// --- The pure decision -------------------------------------------------------------
{
  const due = at("2026-09-24");
  check("a plain touch keeps a due follow-up", resolveFollowUp(due, {}).value === due && resolveFollowUp(due, {}).change === "kept");
  check("a plain touch with no follow-up keeps none", resolveFollowUp(null, {}).value === null && resolveFollowUp(null, {}).change === "kept");
  const set = resolveFollowUp(due, { nextFollowUpAt: "2026-10-01T12:00:00.000Z" });
  check("a new date reschedules", set.change === "set" && set.value?.toISOString() === "2026-10-01T12:00:00.000Z");
  check("completion clears an existing follow-up", resolveFollowUp(due, { completeFollowUp: true }).value === null &&
    resolveFollowUp(due, { completeFollowUp: true }).change === "completed");
  check("completing with nothing set is a no-op, not a completion", resolveFollowUp(null, { completeFollowUp: true }).change === "kept");
  check("completeFollowUp: false keeps it", resolveFollowUp(due, { completeFollowUp: false }).value === due);
  const both = resolveFollowUp(due, { nextFollowUpAt: "2026-10-01T12:00:00.000Z", completeFollowUp: true });
  check("a new date wins over completion (complete this one, schedule the next)", both.change === "set" && both.value !== null);
}

// --- The request shape ---------------------------------------------------------------
check("completeFollowUp is accepted", activityInputSchema.safeParse({ kind: "call", summary: "Reached them", completeFollowUp: true }).success);
check("completeFollowUp must be a boolean", !activityInputSchema.safeParse({ kind: "call", summary: "x", completeFollowUp: "yes" }).success);
check("a follow-up must be a datetime", !activityInputSchema.safeParse({ kind: "call", summary: "x", nextFollowUpAt: "next week" }).success);
check("a follow-up datetime is accepted", activityInputSchema.safeParse({ kind: "call", summary: "x", nextFollowUpAt: "2026-10-01T12:00:00.000Z" }).success);

// --- logActivity against an in-memory database -----------------------------------------
//
// A minimal stand-in for the Drizzle calls logActivity makes: selects from
// `contacts` return the one stored row (the WHERE is not evaluated, so the
// service's own canSee/canWrite checks are what decide access — which is the
// point), inserts and updates are recorded, updates apply to the row.
const ID = "5b8f6a1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b";
const AGENT: Actor = { userId: "11111111-1111-4111-8111-111111111111", role: "agent", brokerageKey: "fortmark" };
const OTHER_AGENT: Actor = { userId: "22222222-2222-4222-8222-222222222222", role: "agent", brokerageKey: "fortmark" };
const MEMBER_OWNER: Actor = { ...AGENT, role: "member" };
const BROKER: Actor = { userId: "33333333-3333-4333-8333-333333333333", role: "broker", brokerageKey: "fortmark" };
const OUTSIDER: Actor = { userId: "44444444-4444-4444-8444-444444444444", role: "admin", brokerageKey: "elsewhere" };

function storedRow(nextFollowUpAt: Date | null) {
  return {
    id: ID, brokerageKey: "fortmark", assignedAgentUserId: AGENT.userId, createdByUserId: AGENT.userId, updatedByUserId: AGENT.userId,
    firstName: "Synthetic", lastName: "Lead", preferredName: null, email: null, phoneE164: null, company: null,
    source: "other", stage: "qualified", tags: [], notes: null,
    lastContactAt: new Date("2026-09-01T12:00:00Z"), nextFollowUpAt,
    createdAt: new Date("2026-08-20T12:00:00Z"), updatedAt: new Date("2026-09-01T12:00:00Z"),
  };
}

function memoryDb(row: ReturnType<typeof storedRow>) {
  const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
  const updates: Record<string, unknown>[] = [];
  const select = () => {
    let rows: unknown[] = [];
    const b = {
      from(t: unknown) { rows = t === contacts ? [{ ...row }] : []; return b; },
      where() { return b; },
      limit() { return b; },
      orderBy() { return b; },
      then(ok: (v: unknown[]) => unknown, fail?: (e: unknown) => unknown) { return Promise.resolve(rows).then(ok, fail); },
    };
    return b;
  };
  const db = {
    select,
    insert: (table: unknown) => ({
      values(values: Record<string, unknown>) {
        inserts.push({ table, values });
        const p = Promise.resolve([]);
        return Object.assign(p, { returning: () => Promise.resolve([]) });
      },
    }),
    update: () => ({
      set(values: Record<string, unknown>) {
        return { where() { Object.assign(row, values); updates.push(values); return Promise.resolve(); } };
      },
    }),
  };
  return { db, row, inserts, updates };
}

async function touch(actor: Actor, followUp: Date | null, input: Record<string, unknown>) {
  const mem = memoryDb(storedRow(followUp));
  const parsed = activityInputSchema.parse({ kind: "call", summary: "Called, no answer", ...input });
  const result = await logActivity({ actor, db: mem.db } as unknown as Ctx, ID, parsed, NOW);
  const audit = mem.inserts.find((i) => i.table === auditEvents)?.values.safeMetadata as Record<string, unknown> | undefined;
  const activity = mem.inserts.find((i) => i.table === contactActivities)?.values;
  return { result, mem, audit, activity };
}

{
  const dueDay = at("2026-09-24");
  const r = await touch(AGENT, dueDay, {});
  check("service: a touch on a DUE follow-up keeps it", r.result.ok && r.mem.row.nextFollowUpAt?.getTime() === dueDay.getTime());
  check("service: …and the lead still reads as due", r.result.ok && isFollowUpDue(followUpStatus(r.result.value.nextFollowUpDate, NOW)));
  check("service: …while last contact moves to now", r.mem.row.lastContactAt?.getTime() === NOW.getTime());
  check("service: …and the activity is recorded against the actor", r.activity?.actorUserId === AGENT.userId && r.activity?.kind === "call");
  check("service: …audited as kept", r.audit?.followUp === "kept" && r.audit?.activity === "call" && r.audit?.contactId === ID);
}
{
  const future = at("2026-10-08");
  const r = await touch(AGENT, future, {});
  check("service: a touch on a FUTURE follow-up keeps it", r.result.ok && r.mem.row.nextFollowUpAt?.getTime() === future.getTime());
  check("service: …and it is not due", r.result.ok && followUpStatus(r.result.value.nextFollowUpDate, NOW).state === "scheduled");
}
{
  const r = await touch(AGENT, at("2026-09-20"), { completeFollowUp: true, summary: "Reached them, booked a showing" });
  check("service: explicit completion clears an overdue follow-up", r.result.ok && r.mem.row.nextFollowUpAt === null);
  check("service: …the lead has no follow-up afterwards", r.result.ok && r.result.value.nextFollowUpDate === undefined);
  check("service: …audited as completed", r.audit?.followUp === "completed");
}
{
  const r = await touch(AGENT, at("2026-09-24"), { nextFollowUpAt: "2026-10-02T12:00:00.000Z" });
  check("service: a new date reschedules", r.result.ok && r.mem.row.nextFollowUpAt?.toISOString() === "2026-10-02T12:00:00.000Z");
  check("service: …audited as set", r.audit?.followUp === "set");
}
{
  const r = await touch(AGENT, null, { nextFollowUpAt: "2026-10-02T12:00:00.000Z" });
  check("service: a first follow-up can be set while logging", r.result.ok && r.mem.row.nextFollowUpAt?.toISOString() === "2026-10-02T12:00:00.000Z");
}
{
  const r = await touch(BROKER, at("2026-09-24"), { completeFollowUp: true });
  check("service: a broker may complete an agent's follow-up", r.result.ok && r.mem.row.nextFollowUpAt === null);
}
// Unauthorized: nothing is written, not even the activity or the audit.
{
  const due = at("2026-09-24");
  const member = await touch(MEMBER_OWNER, due, { completeFollowUp: true });
  check("service: a member is forbidden, even on their own contact", !member.result.ok && member.result.reason === "forbidden");
  check("service: …and nothing is written", member.mem.inserts.length === 0 && member.mem.updates.length === 0 && member.mem.row.nextFollowUpAt === due);
  const colleague = await touch(OTHER_AGENT, due, { completeFollowUp: true });
  check("service: another agent's contact is not found (no existence leak)", !colleague.result.ok && colleague.result.reason === "not_found");
  check("service: …and nothing is written", colleague.mem.inserts.length === 0 && colleague.mem.updates.length === 0);
  const outsider = await touch(OUTSIDER, due, { completeFollowUp: true });
  check("service: another brokerage is not found", !outsider.result.ok && outsider.result.reason === "not_found" && outsider.mem.updates.length === 0);
  const bad = await logActivity({ actor: AGENT, db: memoryDb(storedRow(due)).db } as unknown as Ctx, "not-a-uuid", activityInputSchema.parse({ kind: "call", summary: "x" }), NOW);
  check("service: a malformed id is not found", !bad.ok && bad.reason === "not_found");
}

// --- How the Leads screens read a follow-up (Home's rule) --------------------------------
{
  check("none set", followUpStatus(undefined, NOW).state === "none" && followUpLabel(followUpStatus(null, NOW)) === "None set");
  const today = followUpStatus("2026-09-24T12:00:00.000Z", NOW);
  check("today is due", today.state === "due" && isFollowUpDue(today) && followUpLabel(today) === "Due today");
  const late = followUpStatus("2026-09-20T12:00:00.000Z", NOW);
  check("a past day is overdue and names the day", late.state === "overdue" && late.daysAway === -4 && followUpLabel(late) === "Overdue · Sep 20, 2026");
  const ahead = followUpStatus("2026-10-08T12:00:00.000Z", NOW);
  check("a future day is scheduled, not due", ahead.state === "scheduled" && !isFollowUpDue(ahead) && followUpLabel(ahead) === "Oct 8, 2026");
  // Home's contactAttention counts next_follow_up_at <= end of today UTC.
  check("late tonight UTC is still today (Home's end-of-day rule)", followUpStatus("2026-09-24T23:59:59.000Z", NOW).state === "due");
  check("just after midnight UTC is tomorrow", followUpStatus("2026-09-25T00:00:01.000Z", NOW).state === "scheduled");
  check("the stored day is shown without timezone drift", formatFollowUpDay("2026-01-01") === "Jan 1, 2026");
  check("the heuristic is labelled for what it measures", NO_TOUCH_LABEL === "No touch in 14 days");
  check("15 days quiet trips the heuristic, 13 does not",
    noRecentTouch("2026-09-09T12:00:00.000Z", NOW) && !noRecentTouch("2026-09-11T12:00:00.000Z", NOW));
}

// --- Quick-create closing date ------------------------------------------------------------
{
  check("a blank close date stays unset", closeDateFromInput("") === undefined && closeDateFromInput("  ") === undefined && closeDateFromInput(null) === undefined);
  check("an entered close date is kept, at noon UTC", closeDateFromInput("2026-11-14") === "2026-11-14T12:00:00.000Z");
  check("a malformed close date is not invented into one", closeDateFromInput("11/14/2026") === undefined);
  // The adapter sends closeDate.slice(0, 10) as closingDate; the service seeds deadlines from it.
  const entered = closeDateFromInput("2026-11-14")!.slice(0, 10);
  const withDate = initialDeadlines({ closingDate: entered });
  check("an entered date creates the real Closing deadline",
    withDate.length === 1 && withDate[0].kind === "closing" && withDate[0].label === "Closing" && withDate[0].dueDate === "2026-11-14");
  check("a blank date creates no deadline at all", initialDeadlines({ closingDate: undefined }).length === 0);
  check("an explicit closing deadline is not duplicated",
    initialDeadlines({ closingDate: "2026-11-14", deadlines: [{ kind: "closing", label: "Closing", dueDate: "2026-11-20" }] }).length === 1);
}

// --- Structural: the UI and adapter wiring -----------------------------------------------
{
  const drawer = readFileSync("components/leads/lead-drawer.tsx", "utf8");
  const table = readFileSync("components/leads/leads-table.tsx", "utf8");
  const quick = readFileSync("components/layout/quick-create-dialog.tsx", "utf8");
  const adapter = readFileSync("lib/data/adapters/leads.ts", "utf8");
  const service = readFileSync("lib/contacts/service.ts", "utf8");

  check("drawer: shows the stored follow-up", drawer.includes('label="Next follow-up"') && drawer.includes("followUpStatus(lead?.nextFollowUpDate)"));
  check("drawer: logs touches through the adapter", /logTouch\(lead\.id, \{ kind: touchKind, summary: text, nextFollowUpDay: day, completeFollowUp: completing \}\)/.test(drawer));
  check("drawer: completion is only offered when a follow-up exists", /\{hasFollowUp && \([\s\S]{0,200}lead-complete-follow-up/.test(drawer));
  check("drawer: a new date disables completion (the date wins)", /disabled=\{saving \|\| Boolean\(nextDay\)\}/.test(drawer));
  check("drawer: completion is sent only when chosen and nothing new is scheduled", drawer.includes("const completing = !day && complete && hasFollowUp;"));
  check("drawer: 'Mark contacted today' says the follow-up is kept", drawer.includes("The follow-up is kept."));
  check("drawer: the old unlabelled 'Follow up' heuristic pill is gone", !/>Follow up</.test(drawer) && !drawer.includes("needsFollowUp"));
  check("table: a Follow-up column reads the stored date", table.includes('{ id: "followUp", label: "Follow-up", sortKey: "followUp" }') && table.includes("followUpStatus(lead.nextFollowUpDate)"));
  check("table: the heuristic is labelled truthfully", table.includes("{NO_TOUCH_LABEL}") && !/>Follow up</.test(table) && !table.includes("needsFollowUp"));
  check("quick-create: no invented 45-day closing", !/45 \* 86400000/.test(quick) && quick.includes('closeDate: closeDateFromInput(get("closeDate"))'));
  check("adapter: a new date is sent as nextFollowUpAt, else completion", /if \(input\.nextFollowUpDay\) body\.nextFollowUpAt = followUpAtFromDay\(input\.nextFollowUpDay\);\s*else if \(input\.completeFollowUp\) body\.completeFollowUp = true;/.test(adapter));
  check("adapter: 'Mark contacted today' sends no follow-up change", /kind: "note", summary: "Marked contacted" \}\)/.test(adapter));
  check("service: the stored value comes only from resolveFollowUp", /nextFollowUpAt: followUp\.value,/.test(service) && (service.match(/nextFollowUpAt:/g) ?? []).length === 1);
  check("service: ownership checks precede the write", service.indexOf('if (!canWrite(ctx.actor, row)) return { ok: false, reason: "forbidden" };') < service.indexOf("resolveFollowUp(row.nextFollowUpAt"));
}

const total = passed + failures.length;
console.log(`\n${passed}/${total} follow-up checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
