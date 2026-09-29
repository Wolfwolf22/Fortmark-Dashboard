/**
 * Follow-up workflow: direct scheduling, touch logging, and the business day.
 *
 * Two product rules under test.
 *
 *   1. A follow-up is a reminder, not an interaction. Setting, changing or
 *      completing one directly never touches last contact and never writes a
 *      call/email/meeting/note. Logging an actual touch does move last contact
 *      and may change the reminder in the same step; alone, it never clears it.
 *   2. "Today" is the BUSINESS day (US Eastern), not the UTC day. At 11:30 PM
 *      in Fort Lauderdale it is already tomorrow in UTC — the old rule showed
 *      tomorrow's follow-up as "Due today".
 *
 * Every refusal and every "unchanged" assertion below has a positive control:
 * a test in the same harness where the authorized call succeeds, or where the
 * same field really does change. A green result cannot come from a harness
 * that simply never writes.
 *
 * Layers: the pure clock and rule; the real `changeFollowUp` / `logActivity`
 * against an in-memory database that models transactions; how Home, the list
 * and the drawer read the result; the quick-create closing date; structure.
 *
 * No database is contacted.
 *
 * Run: npm run test:follow-up
 */
import { readFileSync } from "node:fs";
import type { Actor } from "../lib/auth/actor.ts";
import { activityInputSchema, followUpChangeSchema, resolveFollowUp } from "../lib/contacts/domain.ts";
import {
  checkFollowUpDay,
  decideFollowUp,
  followUpDueBy,
  followUpInstant,
  followUpLabel,
  followUpStatus,
  formatFollowUpDay,
  isFollowUpDue,
  noRecentTouch,
  NO_TOUCH_LABEL,
} from "../lib/contacts/follow-up.ts";
import { changeFollowUp, getContact, logActivity, type Ctx } from "../lib/contacts/service.ts";
import { auditEvents, contactActivities, contacts } from "../lib/db/schema.ts";
import {
  businessDayKey,
  businessDayStart,
  dayDiff,
  isCalendarDay,
  startOfNextBusinessDay,
} from "../lib/metrics/business-day.ts";
import { dayKey } from "../lib/metrics/window.ts";
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

const at = (iso: string) => new Date(iso);
const noon = (day: string) => new Date(`${day}T12:00:00.000Z`);

// The evening that broke the old rule: 11:30 PM EDT on Thu Sep 24 is already
// Fri Sep 25 in UTC.
const FLORIDA_EVENING = at("2026-09-25T03:30:00.000Z");

// --- The business clock ------------------------------------------------------------
{
  check("the premise: it is already tomorrow in UTC", dayKey(FLORIDA_EVENING) === "2026-09-25");
  check("…but still Thursday in Fort Lauderdale", businessDayKey(FLORIDA_EVENING) === "2026-09-24");
  check("midnight Eastern is the boundary (EDT)", businessDayKey(at("2026-09-25T03:59:59.999Z")) === "2026-09-24" && businessDayKey(at("2026-09-25T04:00:00.000Z")) === "2026-09-25");
  check("winter boundary is one hour later (EST)", businessDayKey(at("2026-12-15T04:59:59.999Z")) === "2026-12-14" && businessDayKey(at("2026-12-15T05:00:00.000Z")) === "2026-12-15");
  check("a UTC morning is still the previous business day", businessDayKey(at("2026-09-25T02:00:00.000Z")) === "2026-09-24");

  // Daylight saving: spring forward Sun Mar 8 2026, fall back Sun Nov 1 2026.
  check("spring-forward day starts at EST midnight", businessDayStart("2026-03-08").toISOString() === "2026-03-08T05:00:00.000Z");
  check("…the next day starts at EDT midnight", businessDayStart("2026-03-09").toISOString() === "2026-03-09T04:00:00.000Z");
  check("the spring-forward day is 23 hours", (businessDayStart("2026-03-09").getTime() - businessDayStart("2026-03-08").getTime()) / 3_600_000 === 23);
  check("fall-back day starts at EDT midnight", businessDayStart("2026-11-01").toISOString() === "2026-11-01T04:00:00.000Z");
  check("the fall-back day is 25 hours", (businessDayStart("2026-11-02").getTime() - businessDayStart("2026-11-01").getTime()) / 3_600_000 === 25);
  check("11:59 PM on the 23-hour day is still that day", businessDayKey(at("2026-03-09T03:59:59.999Z")) === "2026-03-08");
  check("11:59 PM on the 25-hour day is still that day", businessDayKey(at("2026-11-02T04:59:59.999Z")) === "2026-11-01");
  check("…and one millisecond later is the next", businessDayKey(at("2026-11-02T05:00:00.000Z")) === "2026-11-02");
  check("the start of the next day is measured from the calendar, not +24h",
    startOfNextBusinessDay(at("2026-11-01T12:00:00.000Z")).toISOString() === "2026-11-02T05:00:00.000Z" &&
      startOfNextBusinessDay(at("2026-03-08T12:00:00.000Z")).toISOString() === "2026-03-09T04:00:00.000Z");
  check("noon UTC is the same calendar day in Eastern on both sides of both changes",
    ["2026-03-07", "2026-03-08", "2026-03-09", "2026-10-31", "2026-11-01", "2026-11-02"].every((d) => businessDayKey(noon(d)) === d));

  check("calendar validation refuses Feb 30 and junk", !isCalendarDay("2026-02-30") && !isCalendarDay("2026-13-01") && !isCalendarDay("soon") && isCalendarDay("2028-02-29"));
  check("day arithmetic counts calendar days", dayDiff("2026-09-30", "2026-09-24") === 6 && dayDiff("2026-09-24", "2026-09-30") === -6 && dayDiff("2026-11-02", "2026-10-31") === 2);
}

// --- One classifier: none / due_today / overdue / future ---------------------------------
{
  const NOW = FLORIDA_EVENING; // Thursday Sep 24, 11:30 PM Eastern
  const yesterday = followUpStatus(noon("2026-09-23").toISOString(), NOW);
  const today = followUpStatus(noon("2026-09-24").toISOString(), NOW);
  const tomorrow = followUpStatus(noon("2026-09-25").toISOString(), NOW);
  const later = followUpStatus(noon("2026-10-08").toISOString(), NOW);

  check("none set", followUpStatus(undefined, NOW).state === "none" && followUpStatus(null, NOW).daysAway === null);
  check("Florida 11:30 PM: today's follow-up is Due today", today.state === "due_today" && today.daysAway === 0);
  check("Florida 11:30 PM: TOMORROW's follow-up is NOT Due today (the UTC bug)", tomorrow.state === "future" && tomorrow.daysAway === 1 && !isFollowUpDue(tomorrow));
  check("Florida 11:30 PM: yesterday's is Overdue", yesterday.state === "overdue" && yesterday.daysAway === -1 && isFollowUpDue(yesterday));
  check("a later date is a plain future date", later.state === "future" && later.daysAway === 14 && !isFollowUpDue(later));
  // Positive control: under the old UTC rule the same input was wrong, so the
  // assertion above is not passing by accident.
  check("control: the old UTC comparison called tomorrow's follow-up due", dayKey(noon("2026-09-25")) <= dayKey(NOW));
  check("the same follow-up an hour later in the day is still Due today (noon Eastern)", followUpStatus(noon("2026-09-24").toISOString(), at("2026-09-24T16:00:00.000Z")).state === "due_today");
  check("the reader's clock is irrelevant: only `now` and the stored day decide",
    followUpStatus(noon("2026-09-25").toISOString(), at("2026-09-25T03:30:00.000Z")).state === followUpStatus(noon("2026-09-25").toISOString(), at("2026-09-25T03:30:00.001Z")).state);

  // DST: a follow-up on the 25-hour and 23-hour days classifies by calendar day.
  check("DST: the fall-back day itself is due that day", followUpStatus(noon("2026-11-01").toISOString(), at("2026-11-01T14:00:00.000Z")).state === "due_today");
  check("DST: 11:59 PM on the 25-hour day, tomorrow's is still future", followUpStatus(noon("2026-11-02").toISOString(), at("2026-11-02T04:59:00.000Z")).state === "future");
  check("DST: the next minute it is due", followUpStatus(noon("2026-11-02").toISOString(), at("2026-11-02T05:00:00.000Z")).state === "due_today");
  check("DST: 11:59 PM on the 23-hour day, tomorrow's is still future", followUpStatus(noon("2026-03-09").toISOString(), at("2026-03-09T03:59:00.000Z")).state === "future");

  // Home's SQL bound is the classifier written as an instant. Prove the two
  // agree on every hour around each boundary, so Home and Leads cannot disagree.
  const probes: Date[] = [];
  for (const base of ["2026-03-08", "2026-03-09", "2026-09-24", "2026-11-01", "2026-11-02", "2026-12-31"]) {
    for (let h = -30; h <= 54; h += 1) probes.push(new Date(Date.parse(`${base}T00:00:00.000Z`) + h * 3_600_000));
  }
  let agree = true;
  let sawDue = false;
  let sawNotDue = false;
  for (const now of probes) {
    const dueBy = followUpDueBy(now);
    for (const day of ["2026-03-07", "2026-03-08", "2026-03-09", "2026-09-23", "2026-09-24", "2026-09-25", "2026-11-01", "2026-11-02", "2027-01-01"]) {
      const stored = noon(day);
      const homeSaysDue = stored.getTime() <= dueBy.getTime();
      const listSaysDue = isFollowUpDue(followUpStatus(stored.toISOString(), now));
      if (homeSaysDue !== listSaysDue) agree = false;
      if (listSaysDue) sawDue = true;
      else sawNotDue = true;
    }
  }
  check(`Home's SQL bound and the classifier agree on ${probes.length * 9} (now, day) pairs`, agree);
  check("control: that sweep really exercised both outcomes", sawDue && sawNotDue);
  check("Home's bound is the last millisecond of the business day", followUpDueBy(FLORIDA_EVENING).toISOString() === "2026-09-25T03:59:59.999Z");

  // Copy
  check("labels: none / due / overdue / future",
    followUpLabel(followUpStatus(null, NOW)) === "None set" &&
      followUpLabel(today) === "Due today" &&
      followUpLabel(today, { withDate: true }) === "Due today · Sep 24, 2026" &&
      followUpLabel(yesterday) === "Overdue · Sep 23, 2026" &&
      followUpLabel(later) === "Oct 8, 2026");
  check("the day prints without timezone drift", formatFollowUpDay("2026-01-01") === "Jan 1, 2026" && formatFollowUpDay("2026-12-31") === "Dec 31, 2026");
}

// --- Which days may be scheduled ------------------------------------------------------
{
  const NOW = FLORIDA_EVENING;
  check("today (business day) is allowed", checkFollowUpDay("2026-09-24", NOW).ok);
  check("control: the UTC 'today' is tomorrow here, and is also allowed", checkFollowUpDay("2026-09-25", NOW).ok);
  const past = checkFollowUpDay("2026-09-23", NOW);
  check("yesterday is refused", !past.ok && past.reason === "in_the_past");
  const far = checkFollowUpDay("2028-09-30", NOW);
  check("more than two years ahead is refused", !far.ok && far.reason === "too_far_ahead");
  const bad = checkFollowUpDay("2026-02-30", NOW);
  check("a date that does not exist is refused", !bad.ok && bad.reason === "invalid");
  check("two years exactly is allowed", checkFollowUpDay("2028-09-23", NOW).ok);
}

// --- The one decision, both paths -------------------------------------------------------
{
  const due = noon("2026-09-24");
  check("schedule when none is set", (() => { const r = decideFollowUp(null, { day: "2026-10-01" }); return r.outcome === "scheduled" && r.value?.toISOString() === "2026-10-01T12:00:00.000Z"; })());
  check("reschedule when one is set", (() => { const r = decideFollowUp(due, { day: "2026-10-01" }); return r.outcome === "rescheduled" && r.value?.toISOString() === "2026-10-01T12:00:00.000Z"; })());
  check("the same day is kept, not rewritten", (() => { const r = decideFollowUp(due, { day: "2026-09-24" }); return r.outcome === "kept" && r.value === due; })());
  check("complete clears", (() => { const r = decideFollowUp(due, { complete: true }); return r.outcome === "completed" && r.value === null; })());
  check("completing nothing is kept, not 'completed'", decideFollowUp(null, { complete: true }).outcome === "kept");
  check("asking for nothing keeps it", (() => { const r = decideFollowUp(due, {}); return r.outcome === "kept" && r.value === due; })());
  check("a day supersedes complete", decideFollowUp(due, { day: "2026-10-01", complete: true }).outcome === "rescheduled");
  check("completeFollowUp: false keeps it", decideFollowUp(due, { complete: false }).value === due);

  // The touch path translates the picked instant to its business day first.
  check("touch: a noon-UTC pick keeps its day", resolveFollowUp(null, { nextFollowUpAt: "2026-10-01T12:00:00.000Z" }).value?.toISOString() === "2026-10-01T12:00:00.000Z");
  check("touch: 11 PM Eastern sent as the next UTC morning still means the day picked",
    resolveFollowUp(null, { nextFollowUpAt: "2026-10-02T03:00:00.000Z" }).value?.toISOString() === "2026-10-01T12:00:00.000Z");
  check("touch: no date, no completion keeps", resolveFollowUp(due, {}).change === "kept");
}

// --- Request shapes ---------------------------------------------------------------------
{
  check("schedule accepts a day", followUpChangeSchema.safeParse({ action: "schedule", day: "2026-10-01" }).success);
  check("complete takes no day", followUpChangeSchema.safeParse({ action: "complete" }).success && !followUpChangeSchema.safeParse({ action: "complete", day: "2026-10-01" }).success);
  check("schedule needs a day", !followUpChangeSchema.safeParse({ action: "schedule" }).success);
  check("a datetime is not a day", !followUpChangeSchema.safeParse({ action: "schedule", day: "2026-10-01T12:00:00.000Z" }).success);
  check("an unknown action is refused", !followUpChangeSchema.safeParse({ action: "delete" }).success);
  check("a touch still accepts completeFollowUp", activityInputSchema.safeParse({ kind: "call", summary: "Reached them", completeFollowUp: true }).success);
  check("a touch still accepts a follow-up datetime", activityInputSchema.safeParse({ kind: "call", summary: "x", nextFollowUpAt: "2026-10-01T12:00:00.000Z" }).success);
}

// --- The services, against an in-memory database that models transactions ---------------
const ID = "5b8f6a1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b";
const AGENT: Actor = { userId: "11111111-1111-4111-8111-111111111111", role: "agent", brokerageKey: "fortmark" };
const OTHER_AGENT: Actor = { userId: "22222222-2222-4222-8222-222222222222", role: "agent", brokerageKey: "fortmark" };
const MEMBER_OWNER: Actor = { ...AGENT, role: "member" };
const BROKER: Actor = { userId: "33333333-3333-4333-8333-333333333333", role: "broker", brokerageKey: "fortmark" };
const OUTSIDER: Actor = { userId: "44444444-4444-4444-8444-444444444444", role: "admin", brokerageKey: "elsewhere" };

const LAST_CONTACT = new Date("2026-09-01T12:00:00.000Z");
const NOW = FLORIDA_EVENING;

function storedRow(nextFollowUpAt: Date | null) {
  return {
    id: ID, brokerageKey: "fortmark", assignedAgentUserId: AGENT.userId, createdByUserId: AGENT.userId, updatedByUserId: AGENT.userId,
    firstName: "Synthetic", lastName: "Lead", preferredName: null, email: null, phoneE164: null, company: null,
    source: "other", stage: "qualified", tags: [], notes: null,
    lastContactAt: LAST_CONTACT, nextFollowUpAt,
    createdAt: new Date("2026-08-20T12:00:00Z"), updatedAt: new Date("2026-09-01T12:00:00Z"),
  };
}

type Statement = { table: unknown; kind: "insert" | "update"; values: Record<string, unknown>; run: () => void };

/**
 * Selects return the one stored row (the WHERE is not evaluated, so the
 * service's own canSee/canWrite decide access — which is the point). Writes are
 * lazy statements: awaited singly they run at once; handed to `batch` they run
 * together or not at all, like a Neon transaction. `failOn` makes a statement
 * for that table throw, so atomicity is exercised for real.
 */
function memoryDb(row: ReturnType<typeof storedRow>, failOn?: unknown) {
  const applied: { table: unknown; kind: string; values: Record<string, unknown> }[] = [];
  let batches = 0;
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
  const statement = (table: unknown, kind: "insert" | "update", values: Record<string, unknown>) => {
    const s: Statement & { then: PromiseLike<unknown>["then"]; returning: () => Promise<unknown[]> } = {
      table, kind, values,
      run() {
        if (failOn !== undefined && table === failOn) throw new Error("simulated write failure");
        if (kind === "update") Object.assign(row, values);
        applied.push({ table, kind, values });
      },
      then(ok, fail) {
        return new Promise<unknown>((res) => { s.run(); res(undefined); }).then(ok, fail);
      },
      returning: () => Promise.resolve([]),
    };
    return s;
  };
  const db = {
    select,
    insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => statement(table, "insert", values) }),
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: () => statement(table, "update", values) }) }),
    async batch(stmts: Statement[]) {
      batches++;
      // All or nothing: check every statement can run before applying any.
      const snapshot = { ...row };
      const before = applied.length;
      try {
        for (const s of stmts) s.run();
      } catch (e) {
        Object.assign(row, snapshot);
        applied.length = before;
        throw e;
      }
    },
  };
  return { db, row, applied, batchCount: () => batches };
}

const writesTo = (m: ReturnType<typeof memoryDb>, table: unknown) => m.applied.filter((w) => w.table === table);
const auditOf = (m: ReturnType<typeof memoryDb>) => writesTo(m, auditEvents)[0]?.values.safeMetadata as Record<string, unknown> | undefined;

async function direct(actor: Actor, follow: Date | null, change: unknown, opts: { failOn?: unknown; viewerName?: () => Promise<string | null> } = {}) {
  const m = memoryDb(storedRow(follow), opts.failOn);
  const result = await changeFollowUp({ actor, db: m.db, viewerName: opts.viewerName } as unknown as Ctx, ID, followUpChangeSchema.parse(change), NOW);
  return { m, result };
}
async function touch(actor: Actor, follow: Date | null, input: Record<string, unknown>) {
  const m = memoryDb(storedRow(follow));
  const result = await logActivity({ actor, db: m.db } as unknown as Ctx, ID, activityInputSchema.parse({ kind: "call", summary: "Called", ...input }), NOW);
  return { m, result };
}

// Scenario A — schedule only.
{
  const r = await direct(AGENT, null, { action: "schedule", day: "2026-10-02" });
  check("A: schedule-only succeeds and reports 'scheduled'", r.result.ok && r.result.value.outcome === "scheduled");
  check("A: next follow-up changes", r.m.row.nextFollowUpAt?.toISOString() === "2026-10-02T12:00:00.000Z");
  check("A: last contact is UNCHANGED", r.m.row.lastContactAt?.getTime() === LAST_CONTACT.getTime());
  check("A: no touch activity is written", writesTo(r.m, contactActivities).length === 0);
  check("A: the audit records the change, atomically with it", r.m.batchCount() === 1 && auditOf(r.m)?.followUp === "scheduled" && auditOf(r.m)?.field === "nextFollowUpAt");
  check("A: the audit names the actor", writesTo(r.m, auditEvents)[0]?.values.actorUserId === AGENT.userId);
  check("A: the lead the screen gets carries the new day", r.result.ok && r.result.value.lead.nextFollowUpDate === "2026-10-02T12:00:00.000Z");
  const reschedule = await direct(AGENT, noon("2026-09-24"), { action: "schedule", day: "2026-10-09" });
  check("A: rescheduling is 'rescheduled' and still no touch, no last-contact move",
    reschedule.result.ok && reschedule.result.value.outcome === "rescheduled" && auditOf(reschedule.m)?.followUp === "rescheduled" &&
      reschedule.m.row.lastContactAt?.getTime() === LAST_CONTACT.getTime() && writesTo(reschedule.m, contactActivities).length === 0);
  const same = await direct(AGENT, noon("2026-10-02"), { action: "schedule", day: "2026-10-02" });
  check("A: scheduling the same day writes nothing at all", same.result.ok && same.result.value.outcome === "kept" && same.m.applied.length === 0);
}

// Scenario D — complete without a touch.
{
  const r = await direct(AGENT, noon("2026-09-24"), { action: "complete" });
  check("D: complete succeeds and reports 'completed'", r.result.ok && r.result.value.outcome === "completed");
  check("D: the follow-up is cleared", r.m.row.nextFollowUpAt === null && r.result.ok && r.result.value.lead.nextFollowUpDate === undefined);
  check("D: last contact is UNCHANGED", r.m.row.lastContactAt?.getTime() === LAST_CONTACT.getTime());
  check("D: no touch activity is written", writesTo(r.m, contactActivities).length === 0);
  check("D: audited as completed", auditOf(r.m)?.followUp === "completed");
  const none = await direct(AGENT, null, { action: "complete" });
  check("D: completing when nothing is set writes nothing", none.result.ok && none.result.value.outcome === "kept" && none.m.applied.length === 0);
}

// Scenario B — touch, keep the follow-up.
{
  const due = noon("2026-09-24");
  const r = await touch(AGENT, due, {});
  check("B: a touch on a due follow-up succeeds", r.result.ok);
  check("B: an activity IS created", writesTo(r.m, contactActivities).length === 1 && writesTo(r.m, contactActivities)[0].values.kind === "call");
  check("B: last contact MOVES (control for A and D)", r.m.row.lastContactAt?.getTime() === NOW.getTime() && NOW.getTime() !== LAST_CONTACT.getTime());
  check("B: the follow-up is kept", r.m.row.nextFollowUpAt?.getTime() === due.getTime());
  check("B: …and still classifies as due", r.result.ok && isFollowUpDue(followUpStatus(r.result.value.nextFollowUpDate, NOW)));
  check("B: audited as kept", auditOf(r.m)?.followUp === "kept" && auditOf(r.m)?.activity === "call");
  const future = await touch(AGENT, noon("2026-10-08"), {});
  check("B: a future follow-up is kept too", future.m.row.nextFollowUpAt?.getTime() === noon("2026-10-08").getTime());
}

// Scenario C — touch + new follow-up.
{
  const r = await touch(AGENT, noon("2026-09-24"), { nextFollowUpAt: "2026-10-02T12:00:00.000Z" });
  check("C: an activity is created", writesTo(r.m, contactActivities).length === 1);
  check("C: last contact moves", r.m.row.lastContactAt?.getTime() === NOW.getTime());
  check("C: the follow-up changes", r.m.row.nextFollowUpAt?.toISOString() === "2026-10-02T12:00:00.000Z");
  check("C: audited as rescheduled", auditOf(r.m)?.followUp === "rescheduled");
  const first = await touch(AGENT, null, { nextFollowUpAt: "2026-10-02T12:00:00.000Z" });
  check("C: a first follow-up set while logging is 'scheduled'", first.m.row.nextFollowUpAt?.toISOString() === "2026-10-02T12:00:00.000Z" && auditOf(first.m)?.followUp === "scheduled");
  const past = await touch(AGENT, noon("2026-09-24"), { nextFollowUpAt: "2026-09-20T12:00:00.000Z" });
  check("C: a past follow-up date is refused before anything is written", !past.result.ok && past.result.reason === "invalid_date" && past.m.applied.length === 0);
}

// Scenario E — touch + complete.
{
  const r = await touch(AGENT, noon("2026-09-20"), { completeFollowUp: true, summary: "Reached them, booked a showing" });
  check("E: an activity is created", writesTo(r.m, contactActivities).length === 1);
  check("E: last contact moves", r.m.row.lastContactAt?.getTime() === NOW.getTime());
  check("E: the follow-up is cleared", r.m.row.nextFollowUpAt === null);
  check("E: audited as completed", auditOf(r.m)?.followUp === "completed");
}

// Authorization — every refusal is paired with the authorized call succeeding.
{
  const due = noon("2026-09-24");
  const change = { action: "complete" };
  const owner = await direct(AGENT, due, change);
  check("auth control: the owning agent may complete", owner.result.ok && owner.m.row.nextFollowUpAt === null);
  const broker = await direct(BROKER, due, change);
  check("auth control: a broker may change an agent's follow-up in the brokerage", broker.result.ok && broker.m.row.nextFollowUpAt === null);

  const member = await direct(MEMBER_OWNER, due, change);
  check("member: forbidden, even on their own contact", !member.result.ok && member.result.reason === "forbidden");
  check("member: nothing written, follow-up intact", member.m.applied.length === 0 && member.m.row.nextFollowUpAt === due);
  const memberSchedule = await direct(MEMBER_OWNER, due, { action: "schedule", day: "2026-10-09" });
  check("member: scheduling is forbidden too", !memberSchedule.result.ok && memberSchedule.result.reason === "forbidden" && memberSchedule.m.applied.length === 0);

  const colleague = await direct(OTHER_AGENT, due, change);
  check("another agent: not found (no existence leak)", !colleague.result.ok && colleague.result.reason === "not_found");
  check("another agent: nothing written", colleague.m.applied.length === 0 && colleague.m.row.nextFollowUpAt === due);

  const outsider = await direct(OUTSIDER, due, change);
  check("foreign brokerage: not found", !outsider.result.ok && outsider.result.reason === "not_found" && outsider.m.applied.length === 0);

  const mal = await changeFollowUp({ actor: AGENT, db: memoryDb(storedRow(due)).db } as unknown as Ctx, "not-a-uuid", { action: "complete" }, NOW);
  check("a malformed id is not found", !mal.ok && mal.reason === "not_found");

  // The refusal comes before the date is even judged.
  const memberBad = await direct(MEMBER_OWNER, due, { action: "schedule", day: "2020-01-01" });
  check("permission is decided before the date: a member with a bad date is 'forbidden', not 'invalid_date'", !memberBad.result.ok && memberBad.result.reason === "forbidden");
  const agentBad = await direct(AGENT, due, { action: "schedule", day: "2020-01-01" });
  check("control: the same bad date from an authorized agent is 'invalid_date'", !agentBad.result.ok && agentBad.result.reason === "invalid_date" && agentBad.m.applied.length === 0);

  // Touch path: same permission model.
  const touchMember = await touch(MEMBER_OWNER, due, {});
  const touchColleague = await touch(OTHER_AGENT, due, {});
  check("touch: member forbidden, other agent not found, nothing written",
    !touchMember.result.ok && touchMember.result.reason === "forbidden" && !touchColleague.result.ok && touchColleague.result.reason === "not_found" &&
      touchMember.m.applied.length === 0 && touchColleague.m.applied.length === 0);
  const touchOwner = await touch(AGENT, due, {});
  check("touch control: the owner's identical request succeeds", touchOwner.result.ok && touchOwner.m.applied.length > 0);
}

// Atomicity — the contact update and its audit commit together or not at all.
{
  const due = noon("2026-09-24");
  const auditFails = await direct(AGENT, due, { action: "complete" }, { failOn: auditEvents });
  check("atomic: if the audit cannot be written, the request fails", !auditFails.result.ok && auditFails.result.reason === "unavailable");
  check("atomic: …and the contact is NOT changed", auditFails.m.row.nextFollowUpAt === due && auditFails.m.applied.length === 0);
  const contactFails = await direct(AGENT, due, { action: "complete" }, { failOn: contacts });
  check("atomic: if the contact update fails, no audit row exists", !contactFails.result.ok && writesTo(contactFails.m, auditEvents).length === 0 && contactFails.m.row.nextFollowUpAt === due);
  const ok = await direct(AGENT, due, { action: "complete" });
  check("atomic control: with no failure both writes land in one batch", ok.result.ok && writesTo(ok.m, contacts).length === 1 && writesTo(ok.m, auditEvents).length === 1 && ok.m.batchCount() === 1);
}

// Audit content: field, outcome and — for a scheduled reminder — the day it was set for (workflow
// data, and what lets the timeline say "scheduled for Oct 9"). Never the name or contact details.
{
  const r = await direct(AGENT, noon("2026-09-24"), { action: "schedule", day: "2026-10-09" });
  const meta = JSON.stringify(auditOf(r.m));
  check("audit: contact id, field, outcome, mechanism and the reminder's day", Object.keys(auditOf(r.m) ?? {}).sort().join(",") === "contactId,day,field,followUp,mechanism");
  check("audit: the only date is the reminder's own day", (meta.match(/\d{4}-\d{2}-\d{2}/g) ?? []).join() === "2026-10-09");
  check("audit: no name or contact detail", !/Synthetic|Lead|@|\+1/.test(meta.replace(ID, "")));
  const done = await direct(AGENT, noon("2026-09-24"), { action: "complete" });
  check("audit: completing a reminder records no date at all", Object.keys(auditOf(done.m) ?? {}).sort().join(",") === "contactId,field,followUp,mechanism");
}

// Assigned agent: profile name → the caller's own name → neutral. Never an id or email.
{
  const own = memoryDb(storedRow(null));
  const named = await getContact({ actor: AGENT, db: own.db, viewerName: async () => "Dana Reyes" } as unknown as Ctx, ID);
  check("assigned agent: no profile name falls back to the caller's own name", named?.assignedAgentName === "Dana Reyes");
  const none = await getContact({ actor: AGENT, db: memoryDb(storedRow(null)).db, viewerName: async () => null } as unknown as Ctx, ID);
  check("assigned agent: nothing known stays unset, never an id or email", none?.assignedAgentName === undefined);
  const others = await getContact({ actor: BROKER, db: memoryDb(storedRow(null)).db, viewerName: async () => "Broker Bob" } as unknown as Ctx, ID);
  check("assigned agent: someone else's contact never borrows the viewer's name", others?.assignedAgentName === undefined);
  let asked = false;
  await getContact({ actor: BROKER, db: memoryDb(storedRow(null)).db, viewerName: async () => { asked = true; return "x"; } } as unknown as Ctx, ID);
  check("assigned agent: the identity provider is not called unless needed", !asked);
}

// --- "No touch in 14 days" is independent of the follow-up ---------------------------------
{
  const quiet = "2026-09-01T12:00:00.000Z"; // 23 days before NOW
  check("premise: 23 days with no touch trips the heuristic", noRecentTouch(quiet, NOW));
  const scheduled = await direct(AGENT, null, { action: "schedule", day: "2026-10-02" });
  const lastAfterSchedule = scheduled.result.ok ? scheduled.result.value.lead.lastContactDate : "";
  check("scheduling a follow-up does NOT reset the no-touch clock", noRecentTouch(lastAfterSchedule, NOW) && lastAfterSchedule === quiet);
  const completed = await direct(AGENT, noon("2026-09-24"), { action: "complete" });
  check("completing one does not either", completed.result.ok && noRecentTouch(completed.result.value.lead.lastContactDate, NOW));
  const touched = await touch(AGENT, null, {});
  check("control: an actual touch DOES reset it", touched.result.ok && !noRecentTouch(touched.result.value.lastContactDate, NOW));
  check("the heuristic reads only last contact", (() => {
    const src = readFileSync("lib/contacts/follow-up.ts", "utf8");
    const body = src.slice(src.indexOf("export function noRecentTouch"), src.indexOf("// --- Words"));
    return !/nextFollowUp|followUpStatus/.test(body);
  })());
  check("the label is truthful", NO_TOUCH_LABEL === "No touch in 14 days");
  check("14 vs 15 days", noRecentTouch("2026-09-09T12:00:00.000Z", NOW) && !noRecentTouch("2026-09-11T12:00:00.000Z", NOW));
}

// --- Quick-create closing date -------------------------------------------------------------
{
  check("a blank close date stays unset", closeDateFromInput("") === undefined && closeDateFromInput("  ") === undefined && closeDateFromInput(null) === undefined);
  check("an entered close date is kept, at noon UTC", closeDateFromInput("2026-11-14") === "2026-11-14T12:00:00.000Z");
  check("a malformed close date is not invented into one", closeDateFromInput("11/14/2026") === undefined);
  const entered = closeDateFromInput("2026-11-14")!.slice(0, 10);
  const withDate = initialDeadlines({ closingDate: entered });
  check("an entered date creates exactly one real Closing deadline",
    withDate.length === 1 && withDate[0].kind === "closing" && withDate[0].label === "Closing" && withDate[0].dueDate === "2026-11-14");
  check("a blank date creates no deadline at all", initialDeadlines({ closingDate: undefined }).length === 0);
  check("an explicit closing deadline is not duplicated",
    initialDeadlines({ closingDate: "2026-11-14", deadlines: [{ kind: "closing", label: "Closing", dueDate: "2026-11-20" }] }).length === 1);
}

// --- Structure: one rule, wired everywhere --------------------------------------------------
{
  const read = (p: string) => readFileSync(p, "utf8");
  const drawer = read("components/leads/lead-drawer.tsx");
  const table = read("components/leads/leads-table.tsx");
  const quick = read("components/layout/quick-create-dialog.tsx");
  const adapter = read("lib/data/adapters/leads.ts");
  const service = read("lib/contacts/service.ts");
  const metrics = read("lib/contacts/metrics.ts");
  const sampleMetrics = read("lib/data/sample-metrics.ts");
  const route = read("app/api/contacts/[id]/follow-up/route.ts");
  const followUp = read("lib/contacts/follow-up.ts");
  const http = read("lib/contacts/http.ts");

  // Single source of truth for "due".
  check("Home's SQL bound comes from the shared rule, not a UTC end-of-day", metrics.includes("followUpDueBy(now)") && !/endOfToday|T23:59:59/.test(metrics));
  check("Home's attention items are classified by the shared rule", /followUpStatus\(row\.nextFollowUpAt/.test(metrics) && !/daysUntil|dayKey/.test(metrics));
  check("sample Home uses the same classifier", sampleMetrics.includes("isFollowUpDue(followUpStatus(l.nextFollowUpDate, at))") && !/nextFollowUpDate[^)]*slice\(0, 10\)/.test(sampleMetrics));
  check("the Leads column classifies with the shared rule", table.includes("followUpStatus(lead.nextFollowUpDate)") && table.includes("isFollowUpDue(followUp)"));
  check("the drawer classifies with the shared rule", drawer.includes("followUpStatus(lead?.nextFollowUpDate)") && drawer.includes("followUpLabel(followUp"));
  check("no component compares dates itself", !/new Date\([^)]*\)\s*[<>]=?\s*new Date|getTime\(\)\s*[<>]/.test(drawer) && !/dayKey|toISOString\(\)\.slice\(0, 10\)/.test(drawer + table));
  check("the states are named as the product names them", /"none" \| "overdue" \| "due_today" \| "future"/.test(followUp));
  check("the business timezone is one documented constant", /BUSINESS_TIME_ZONE = "America\/New_York"/.test(read("lib/metrics/business-day.ts")));
  check("the drawer's date floor is the business day, not the browser's", drawer.includes("businessDayKey(new Date())") && !/getFullYear\(\)|getMonth\(\)/.test(drawer));

  // Direct follow-up path.
  check("route: authentication first, then the body, then the service", route.indexOf("requireCaller()") < route.indexOf("request.json()") && route.indexOf("request.json()") < route.indexOf("changeFollowUp("));
  check("route: refusals map through the shared failure table", route.includes("failure(result.reason)") && http.includes('case "invalid_date"'));
  check("service: authorization precedes the date check and the write", (() => {
    const fn = service.slice(service.indexOf("export async function changeFollowUp"));
    return fn.indexOf("canSee(ctx.actor, row)") < fn.indexOf("canWrite(ctx.actor, row)") && fn.indexOf("canWrite(ctx.actor, row)") < fn.indexOf("checkFollowUpDay(") && fn.indexOf("checkFollowUpDay(") < fn.indexOf("ctx.db.batch");
  })());
  check("service: the direct change never writes last contact or an activity", (() => {
    const fn = service.slice(service.indexOf("export async function changeFollowUp"), service.indexOf("/** Agents a privileged caller may filter by"));
    return !/lastContactAt|contactActivities/.test(fn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""));
  })());
  check("service: the update and its audit are one batch", /ctx\.db\.batch\(\[[\s\S]*update\(contacts\)[\s\S]*insert\(auditEvents\)/.test(service));
  check("adapter: the direct control posts to the follow-up route, not the activity route", /\/follow-up`/.test(adapter) && /export async function changeFollowUp/.test(adapter));
  check("adapter: a touch still posts to the activity route", /\/activities`/.test(adapter));
  check("drawer: the direct control calls changeFollowUp, never logTouch", /changeFollowUp\(lead\.id, \{ action: "schedule", day \}\)/.test(drawer) && /changeFollowUp\(lead\.id, \{ action: "complete" \}\)/.test(drawer));
  check("drawer: Schedule / Change / Mark complete", drawer.includes('{hasFollowUp ? "Change" : "Schedule"}') && drawer.includes("Mark complete"));
  check("drawer: says a reminder is not contact", drawer.includes("A reminder only. It does not count as a touch."));
  check("drawer: Log a touch remains its own section", drawer.includes('id="log-touch-heading"') && drawer.includes("logTouch(lead.id"));
  check("drawer: completion inside a touch still needs a follow-up and no new date", drawer.includes("const completing = !day && complete && hasFollowUp;"));
  check("drawer: 'Mark contacted today' keeps the follow-up", drawer.includes("The follow-up is kept."));
  check("drawer: no lone separator when there is no email or phone", drawer.includes("[lead.email, lead.phone].filter(Boolean)") && !/\{lead\.email\} · \{lead\.phone\}/.test(drawer));
  check("drawer: an unnamed stored agent reads 'Unnamed agent', never an id", drawer.includes("Unnamed agent") && !/assignedAgentId\}/.test(drawer));
  check("table: the heuristic is labelled truthfully and separate", table.includes("{NO_TOUCH_LABEL}") && !table.includes("needsFollowUp"));
  check("touch path: last contact is only ever set from an actual touch", (() => {
    const fn = service.slice(service.indexOf("export async function logActivity"), service.indexOf("export async function changeFollowUp"));
    return /lastContactAt: row\.lastContactAt/.test(fn);
  })());
  check("service: the caller's name is fetched lazily, and only from the identity provider", /ctx\.viewerName\(\)/.test(service) && /currentUser\(\)/.test(http) && !/primaryEmailAddress|emailAddresses/.test(http));

  // Quick-create closing date.
  check("quick-create: no invented 45-day closing", !/45 \* 86400000/.test(quick) && quick.includes('closeDate: closeDateFromInput(get("closeDate"))'));
  check("quick-create: the field says optional", quick.includes('label="Close date (optional)"'));
}

const total = passed + failures.length;
console.log(`\n${passed}/${total} follow-up checks passed`);
if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
