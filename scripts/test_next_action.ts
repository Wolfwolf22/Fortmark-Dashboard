/** Next-action contracts, clock rules and actual isolated PostgreSQL mutations. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../lib/db/client.ts";
import { aiPreparedActions, auditEvents, contactActivities, contacts, dashboardUsers, professionalProfiles } from "../lib/db/schema.ts";
import { mutateNextAction, listNextActionAssignees } from "../lib/contacts/next-action-service.ts";
import { businessLocalToUtc, checkNextActionDueAt, nextActionDayMirror, nextActionInputSchema, nextActionLocalParts, nextActionStatus, type NextActionDraft } from "../lib/contacts/next-action.ts";
import { changeFollowUp, changeStage, getContact, logActivity, type Ctx } from "../lib/contacts/service.ts";
import { guardedLegacyFollowUpAt, isPendingNextActionConflict } from "../lib/contacts/reliability.ts";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";

let checks = 0;
function check(name: string, condition: unknown) { assert.ok(condition, name); checks++; }
const now = new Date("2026-10-29T16:00:00.000Z");
const oldTouch = new Date("2026-10-01T12:00:00.000Z");
const owner = { userId: "11111111-1111-4111-8111-111111111111", role: "agent" as const, brokerageKey: "fortmark" };
const admin = { ...owner, userId: "22222222-2222-4222-8222-222222222222", role: "admin" as const };
const other = { ...owner, userId: "33333333-3333-4333-8333-333333333333" };
const broker = { ...owner, userId: "44444444-4444-4444-8444-444444444444", role: "broker" as const };
const member = { ...owner, userId: "55555555-5555-4555-8555-555555555555", role: "member" as const };
const suspended = { ...admin, userId: "66666666-6666-4666-8666-666666666666" };
const { pg, db } = await createLocalContactDb();
const ctx: Ctx = { actor: owner, db };
const draft: NextActionDraft = { kind: "call", purpose: "Review the synthetic search", dueAt: "2026-10-30T02:30:00.000Z", assigneeId: owner.userId };
async function reset() { await pg.exec("truncate contacts, audit_events, ai_prepared_actions cascade"); }
async function seed(stage: typeof contacts.$inferSelect.stage = "lead") {
  const id = randomUUID();
  await db.insert(contacts).values({ id, brokerageKey: owner.brokerageKey, assignedAgentUserId: owner.userId, firstName: "Synthetic action", stage,
    lastContactAt: oldTouch, nextFollowUpAt: new Date("2026-10-28T12:00:00Z"), createdAt: oldTouch, updatedAt: now });
  return id;
}
async function row(id: string) { return (await db.select().from(contacts).where(eq(contacts.id, id)))[0]; }
async function revision(id: string) { return (await row(id)).updatedAt.toISOString(); }
const count = async (table: string) => Number((await pg.query<{ n: number }>(`select count(*)::int n from ${table}`)).rows[0].n);
async function set(id: string, next = draft, override: Record<string, unknown> = {}, context = ctx) {
  const before = await row(id);
  return mutateNextAction(context, id, { action: "set", expectedUpdatedAt: before.updatedAt.toISOString(), expectedActionId: before.nextActionId, next, ...override }, now);
}
function beforeExecute(work: () => Promise<void>): Db {
  let pending = true;
  return new Proxy(db, { get(target, property) {
    if (property === "execute") return async (...args: Parameters<Db["execute"]>) => {
      if (pending) { pending = false; await work(); }
      return target.execute(...args);
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
}
/** No-op sets perform a conditional SELECT rather than the mutation statement. */
function beforeNoOpRead(work: () => Promise<void>): Db {
  let pending = true;
  function wrap<T extends object>(builder: T): T {
    return new Proxy(builder, { get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      if (property === "then") return async (...args: unknown[]) => {
        if (pending) { pending = false; await work(); }
        return Reflect.apply(value, target, args);
      };
      return (...args: unknown[]) => {
        const result = Reflect.apply(value, target, args);
        return result && typeof result === "object" ? wrap(result) : result;
      };
    } });
  }
  return new Proxy(db, { get(target, property) {
    if (property === "select") return (...args: Parameters<Db["select"]>) => {
      const builder = target.select(...args);
      return (args[0] as { id?: unknown } | undefined)?.id === contacts.id ? wrap(builder) : builder;
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
}
async function failOn(table: string, createdOnly = false) {
  await pg.exec(`create function fail_next_action() returns trigger language plpgsql as $$begin raise exception 'local next action failure'; end$$;
    create trigger next_action_failure before ${table === "contacts" ? "update" : "insert"} on ${table} for each row ${createdOnly ? "when (NEW.safe_metadata->>'event' = 'next_action_created')" : ""} execute function fail_next_action()`);
  return async () => { await pg.exec(`drop trigger next_action_failure on ${table}; drop function fail_next_action()`); };
}
try {
  check("spring gap cannot become a different wall time", JSON.stringify(businessLocalToUtc("2026-03-08", "02:30")) === JSON.stringify({ ok: false, reason: "nonexistent_time" }));
  for (const [day, time, expected] of [["2026-03-08", "01:30", "2026-03-08T06:30:00.000Z"], ["2026-03-08", "03:30", "2026-03-08T07:30:00.000Z"], ["2026-11-01", "01:30", "2026-11-01T05:30:00.000Z"], ["2026-10-29", "23:45", "2026-10-30T03:45:00.000Z"]]) {
    const converted = businessLocalToUtc(day, time);
    check(`${day} ${time}: converts with the real Eastern offset`, converted.ok && converted.dueAt === expected);
    check(`${day} ${time}: local parts round-trip`, JSON.stringify(nextActionLocalParts(expected)) === JSON.stringify({ day, time }));
  }
  const fold = businessLocalToUtc("2026-11-01", "01:30");
  check("a repeated fall time is identified and takes its earlier instant", fold.ok && fold.ambiguous);
  check("invalid dates and wall times are refused", !businessLocalToUtc("2026-02-30", "12:00").ok && !businessLocalToUtc("2026-10-29", "24:00").ok);
  check("day mirror uses the business day, not UTC date", nextActionDayMirror(draft.dueAt) === "2026-10-29T12:00:00.000Z");
  check("earlier today is already overdue by its real time", nextActionStatus({ dueAt: "2026-10-29T15:59:00Z" }, now).state === "overdue" && nextActionStatus({ dueAt: "2026-10-29T15:59:00Z" }, now).daysAway === 0);
  check("later today and a future day stay distinct", nextActionStatus({ dueAt: "2026-10-29T17:00:00Z" }, now).state === "due_today" && nextActionStatus({ dueAt: "2026-10-30T17:00:00Z" }, now).state === "future");
  check("no action is not an invented deadline", nextActionStatus(null, now).state === "none");
  check("new past times and dates beyond the 730-day horizon are refused", !checkNextActionDueAt("2026-10-29T15:59:00Z", now).ok && !checkNextActionDueAt("2030-01-01T12:00:00Z", now).ok);
  check("the due-time helper itself refuses malformed ISO/calendar values", !checkNextActionDueAt("2026-02-30T12:00:00Z", now).ok && !checkNextActionDueAt("tomorrow", now).ok);
  check("unchanged overdue time can survive a content-only edit", checkNextActionDueAt("2026-10-28T14:00:00Z", now, "2026-10-28T14:00:00.000Z").ok && !checkNextActionDueAt("2026-10-28T15:00:00Z", now, "2026-10-28T14:00:00Z").ok);
  const base = { action: "set", expectedUpdatedAt: now.toISOString(), expectedActionId: null, next: draft };
  for (const invalid of [{ ...base, extra: true }, { ...base, next: { ...draft, purpose: " " } }, { ...base, next: { ...draft, purpose: "x".repeat(241) } }, { ...base, next: { ...draft, purpose: "bad\0text" } }, { ...base, next: { ...draft, kind: "task" } }, { ...base, next: { ...draft, dueAt: "2026-10-29T15:00" } }, { ...base, next: { ...draft, assigneeId: "someone" } }]) check("strict action schema rejects malformed or unbounded input", !nextActionInputSchema.safeParse(invalid).success);
  check("completion and cancellation require their written result", !nextActionInputSchema.safeParse({ action: "complete", expectedUpdatedAt: now.toISOString(), actionId: randomUUID(), outcome: " " }).success && !nextActionInputSchema.safeParse({ action: "cancel", expectedUpdatedAt: now.toISOString(), actionId: randomUUID(), reason: "x".repeat(501) }).success);
  await db.insert(dashboardUsers).values([owner, admin, other, broker, member, suspended].map(actor => ({ id: actor.userId, clerkUserId: `user_nextaction${actor.userId.replaceAll("-", "")}`, primaryEmail: `${actor.userId}@example.test`, role: actor.role, status: actor.userId === suspended.userId ? "suspended" as const : "active" as const })));
  await db.insert(professionalProfiles).values([{ userId: owner.userId, preferredDisplayName: "Synthetic owner" }, { userId: admin.userId, preferredDisplayName: "Synthetic admin" }]);
  let id = await seed();
  for (const dueAt of ["2026-10-29T15:59:00Z", "2030-01-01T12:00:00Z"]) {
    const badDate = await set(id, { ...draft, dueAt });
    check("mutation enforces future-time and maximum-horizon rules", !badDate.ok && badDate.reason === "invalid_date" && !(await row(id)).nextActionId);
  }
  const eligible = await listNextActionAssignees(ctx, id);
  check("only active existing readers can be assigned", eligible.ok && eligible.value.map(user => user.id).sort().join() === [owner.userId, admin.userId].sort().join());
  check("assignee names are safe display names", eligible.ok && eligible.value.every(user => user.name.startsWith("Synthetic")));
  const foreignList = await listNextActionAssignees({ actor: other, db }, id);
  const memberList = await listNextActionAssignees({ actor: { ...owner, role: "member" }, db }, id);
  check("out-of-scope assignee lists are not found and read-only callers are refused", !foreignList.ok && foreignList.reason === "not_found" && !memberList.ok && memberList.reason === "forbidden");
  const created = await set(id); let stored = await row(id);
  check("one pending action is created with its full data", created.ok && stored.nextActionId && stored.nextActionKind === "call" && stored.nextActionPurpose === draft.purpose && stored.nextActionDueAt?.toISOString() === draft.dueAt);
  check("creation mirrors its business day and advances the public revision", stored.nextFollowUpAt?.toISOString() === nextActionDayMirror(draft.dueAt) && stored.updatedAt > now);
  check("creating an action never counts as outreach", stored.lastContactAt?.toISOString() === oldTouch.toISOString());
  check("creation records mandatory history and audit", await count("contact_activities") === 1 && await count("audit_events") === 1);
  const unchangedRevision = stored.updatedAt.toISOString();
  const noOp = await set(id);
  check("identical set writes no history or revision", noOp.ok && await revision(id) === unchangedRevision && await count("contact_activities") === 1);
  const oldId = stored.nextActionId!;
  const edited = await set(id, { ...draft, kind: "email", purpose: "Edited private purpose", assigneeId: admin.userId }); stored = await row(id);
  check("editing preserves the action identity and supports an existing admin reader", edited.ok && stored.nextActionId === oldId && stored.nextActionAssignedUserId === admin.userId);
  const rescheduled = await set(id, { ...draft, dueAt: "2026-10-30T03:00:00.000Z" });
  check("same-day time changes are reschedules and retain ID", rescheduled.ok && (await row(id)).nextActionId === oldId && (await row(id)).nextFollowUpAt?.toISOString() === "2026-10-29T12:00:00.000Z");
  const events = (await db.select().from(contactActivities)).map(activity => activity.safeMetadata?.event);
  check("history distinguishes creation, edit and reschedule", events.join() === "next_action_created,next_action_edited,next_action_rescheduled");
  const staleId = await set(id, draft, { expectedActionId: randomUUID() });
  const staleRevision = await set(id, draft, { expectedUpdatedAt: now.toISOString() });
  check("both stale IDs and stale contact revisions are refused", !staleId.ok && staleId.reason === "conflict" && !staleRevision.ok && staleRevision.reason === "conflict");
  for (const assignee of [other, broker, member, suspended]) {
    const refused = await set(id, { ...draft, assigneeId: assignee.userId });
    check("an ineligible assignee never gains contact access", !refused.ok && refused.reason === "invalid_assignee");
  }
  const completed = await mutateNextAction(ctx, id, { action: "complete", expectedUpdatedAt: await revision(id), actionId: oldId, outcome: "Private result for authorized contact readers", next: { ...draft, kind: "meeting", dueAt: "2026-11-02T17:00:00Z" } }, now);
  stored = await row(id);
  check("completion and successor commit with a fresh action ID", completed.ok && stored.nextActionId && stored.nextActionId !== oldId && stored.nextActionKind === "meeting");
  check("completion writes both completed and created task events", await count("contact_activities") === 5 && await count("audit_events") === 5);
  check("successor owns the new business-day mirror without a fake touch", stored.nextFollowUpAt?.toISOString() === "2026-11-02T12:00:00.000Z" && stored.lastContactAt?.toISOString() === oldTouch.toISOString());
  const staleCompletion = await mutateNextAction(ctx, id, { action: "complete", expectedUpdatedAt: await revision(id), actionId: oldId, outcome: "Stale result" }, now);
  check("an old completion can never complete a replacement action", !staleCompletion.ok && staleCompletion.reason === "conflict");
  const cancelled = await mutateNextAction(ctx, id, { action: "cancel", expectedUpdatedAt: await revision(id), actionId: stored.nextActionId, reason: "Private cancellation reason" }, now);
  stored = await row(id);
  check("cancellation clears all pending fields and its mirror", cancelled.ok && [stored.nextActionId, stored.nextActionKind, stored.nextActionPurpose, stored.nextActionDueAt, stored.nextActionAssignedUserId, stored.nextFollowUpAt].every(value => value === null));
  const audits = JSON.stringify((await db.select().from(auditEvents)).map(event => event.safeMetadata));
  const histories = JSON.stringify((await db.select().from(contactActivities)).map(event => event.safeMetadata));
  check("authorized activity retains purpose, result and reason", histories.includes("Private result") && histories.includes("Private cancellation") && histories.includes("Edited private purpose"));
  check("audit carries no action content or due timestamps", !/Private|private|Review the synthetic|2026-|purpose|outcome|reason/.test(audits));

  await reset(); id = await seed(); await set(id); stored = await row(id);
  const laterClock = new Date("2026-10-30T16:00:00.000Z");
  const overdueEdit = await mutateNextAction(ctx, id, { action: "set", expectedUpdatedAt: await revision(id), expectedActionId: stored.nextActionId, next: { ...draft, purpose: "Clarified overdue task" } }, laterClock);
  check("an overdue action can be edited without inventing a new due time", overdueEdit.ok && (await row(id)).nextActionDueAt?.toISOString() === draft.dueAt);
  const overdueSuccessor = await mutateNextAction(ctx, id, { action: "complete", expectedUpdatedAt: await revision(id), actionId: stored.nextActionId, outcome: "Completed", next: draft }, laterClock);
  check("completion cannot reuse an overdue deadline for a new successor", !overdueSuccessor.ok && overdueSuccessor.reason === "invalid_date" && (await row(id)).nextActionId === stored.nextActionId);
  const overdueDone = await mutateNextAction(ctx, id, { action: "complete", expectedUpdatedAt: await revision(id), actionId: stored.nextActionId, outcome: "Completed overdue work" }, laterClock);
  check("overdue actions can complete without a successor", overdueDone.ok && !(await row(id)).nextActionId);

  for (const stage of ["closed", "past_client", "lost", "archived"] as const) {
    await reset(); id = await seed(stage); const refused = await set(id);
    check(`${stage} cannot acquire a new pending action`, !refused.ok && refused.reason === "invalid_transition");
  }
  await reset(); id = await seed(); await set(id); stored = await row(id);
  const closed = await changeStage(ctx, id, "closed", now, { expectedStage: "lead" }); assert.ok(closed.ok);
  const refusedSuccessor = await mutateNextAction(ctx, id, { action: "complete", expectedUpdatedAt: await revision(id), actionId: stored.nextActionId, outcome: "Done", next: draft }, now);
  check("an exited contact cannot receive a successor while completing", !refusedSuccessor.ok && refusedSuccessor.reason === "invalid_transition");
  const completeClosed = await mutateNextAction(ctx, id, { action: "complete", expectedUpdatedAt: await revision(id), actionId: stored.nextActionId, outcome: "Completed after closing" }, now);
  check("an existing action can still be completed after closing", completeClosed.ok && !(await row(id)).nextActionId);
  for (const stage of ["closed", "past_client", "lost", "archived"] as const) {
    await reset(); id = await seed(); await set(id);
    const exit = await changeStage(ctx, id, stage, now, { expectedStage: "lead" }); assert.ok(exit.ok);
    stored = await row(id);
    const cancelledAfterExit = await mutateNextAction(ctx, id, { action: "cancel", expectedUpdatedAt: await revision(id), actionId: stored.nextActionId, reason: "Explicitly cancelled after exit" }, now);
    check(`${stage}: an existing pending action can be explicitly cancelled`, cancelledAfterExit.ok && !(await row(id)).nextActionId);
  }

  for (const table of ["contacts", "contact_activities", "audit_events"]) {
    await reset(); id = await seed(); const release = await failOn(table); const failed = await set(id); const after = await row(id);
    check(`${table} failure reports failure and rolls back pending state`, !failed.ok && failed.reason === "unavailable" && !after.nextActionId && after.updatedAt.toISOString() === now.toISOString());
    check(`${table} failure leaves no history or audit`, await count("contact_activities") === 0 && await count("audit_events") === 0);
    await release();
  }
  await reset(); id = await seed(); await set(id); stored = await row(id);
  const releaseSuccessor = await failOn("contact_activities", true);
  const failedSuccessor = await mutateNextAction(ctx, id, { action: "complete", expectedUpdatedAt: await revision(id), actionId: stored.nextActionId, outcome: "Cannot partially complete", next: draft }, now);
  check("a successor history failure rolls back completion too", !failedSuccessor.ok && (await row(id)).nextActionId === stored.nextActionId && await count("contact_activities") === 1);
  await releaseSuccessor();

  await reset(); id = await seed(); const opening = await revision(id);
  const concurrentSets = await Promise.all([mutateNextAction(ctx, id, { ...base, expectedUpdatedAt: opening }, now), mutateNextAction(ctx, id, { ...base, expectedUpdatedAt: opening, next: { ...draft, purpose: "Competing action" } }, now)]);
  check("concurrent opening snapshots create exactly one pending action", concurrentSets.filter(result => result.ok).length === 1 && concurrentSets.some(result => !result.ok && result.reason === "conflict") && await count("contact_activities") === 1);
  stored = await row(id); const pendingId = stored.nextActionId!, pendingRevision = stored.updatedAt.toISOString();
  const concurrentEnds = await Promise.all([mutateNextAction(ctx, id, { action: "complete", actionId: pendingId, expectedUpdatedAt: pendingRevision, outcome: "Completed once" }, now), mutateNextAction(ctx, id, { action: "cancel", actionId: pendingId, expectedUpdatedAt: pendingRevision, reason: "Cancelled once" }, now)]);
  check("completion/cancellation race resolves once without duplicate history", concurrentEnds.filter(result => result.ok).length === 1 && concurrentEnds.some(result => !result.ok && result.reason === "conflict") && await count("contact_activities") === 2 && !(await row(id)).nextActionId);
  await reset(); id = await seed();
  const eligibilityRace = beforeExecute(async () => { await db.update(dashboardUsers).set({ status: "suspended" }).where(eq(dashboardUsers.id, admin.userId)); });
  const ineligible = await set(id, { ...draft, assigneeId: admin.userId }, {}, { actor: owner, db: eligibilityRace });
  check("assignment eligibility race is a recoverable field refusal when contact identity stayed unchanged", !ineligible.ok && ineligible.reason === "invalid_assignee" && !(await row(id)).nextActionId && await count("contact_activities") === 0 && await revision(id) === now.toISOString());
  const retryEligible = await set(id, draft, { expectedUpdatedAt: now.toISOString(), expectedActionId: null });
  check("a preserved draft can select an eligible owner without adopting a fictitious newer revision", retryEligible.ok && (await row(id)).nextActionAssignedUserId === owner.userId);
  await db.update(dashboardUsers).set({ status: "active" }).where(eq(dashboardUsers.id, admin.userId));
  await reset(); id = await seed(); await set(id, { ...draft, assigneeId: admin.userId });
  const beforeNoOp = await row(id);
  const noOpEligibilityRace = beforeNoOpRead(async () => { await db.update(dashboardUsers).set({ status: "suspended" }).where(eq(dashboardUsers.id, admin.userId)); });
  const refusedNoOp = await set(id, { ...draft, assigneeId: admin.userId }, {}, { actor: owner, db: noOpEligibilityRace });
  check("a no-op eligibility race is a recoverable field refusal without a fictitious contact conflict", !refusedNoOp.ok && refusedNoOp.reason === "invalid_assignee" && await revision(id) === beforeNoOp.updatedAt.toISOString() && (await row(id)).nextActionId === beforeNoOp.nextActionId && await count("contact_activities") === 1 && await count("audit_events") === 1);
  const recoverNoOp = await set(id, draft, { expectedUpdatedAt: beforeNoOp.updatedAt.toISOString(), expectedActionId: beforeNoOp.nextActionId });
  check("an unchanged draft can recover by selecting an eligible person after the no-op refusal", recoverNoOp.ok && (await row(id)).nextActionAssignedUserId === owner.userId);
  await db.update(dashboardUsers).set({ status: "active" }).where(eq(dashboardUsers.id, admin.userId));

  await reset(); id = await seed(); await set(id); stored = await row(id);
  for (const change of [{ action: "schedule", day: "2026-10-29" }, { action: "complete" }] as const) {
    const refused = await changeFollowUp(ctx, id, change, now);
    check("legacy date controls cannot overwrite a structured action", !refused.ok && refused.reason === "conflict");
  }
  for (const follow of [{ nextFollowUpAt: draft.dueAt }, { completeFollowUp: true }]) {
    const refused = await logActivity(ctx, id, { kind: "call", summary: "Do not bypass action", ...follow }, now);
    check("a logged touch cannot change a pending action's reminder", !refused.ok && refused.reason === "conflict" && await count("contact_activities") === 1);
  }
  const ordinaryTouch = await logActivity(ctx, id, { kind: "call", summary: "A real outreach touch" }, now);
  check("ordinary outreach remains allowed while keeping the pending action", ordinaryTouch.ok && (await row(id)).nextActionId === stored.nextActionId && (await row(id)).lastContactAt?.toISOString() === now.toISOString());
  await reset(); id = await seed();
  const legacyRace = beforeExecute(async () => { const created = await set(id); assert.ok(created.ok); });
  const racedLegacy = await changeFollowUp({ actor: owner, db: legacyRace }, id, { action: "complete" }, now);
  check("locked legacy SQL refuses a pending action created after preflight", !racedLegacy.ok && racedLegacy.reason === "conflict" && (await row(id)).nextActionId && await count("contact_activities") === 1);
  await reset(); id = await seed();
  const touchRace = beforeExecute(async () => { const created = await set(id); assert.ok(created.ok); });
  const racedTouch = await logActivity({ actor: owner, db: touchRace }, id, { kind: "call", summary: "Must not clear new action", completeFollowUp: true }, now);
  check("locked log-touch SQL also protects a concurrently created action", !racedTouch.ok && racedTouch.reason === "conflict" && (await row(id)).nextActionId && await count("contact_activities") === 1);

  // AI's legacy writer shares a DB-enforced guard, even for an identical day.
  const actionId = randomUUID();
  await db.insert(aiPreparedActions).values({ id: actionId, brokerageKey: owner.brokerageKey, actorUserId: owner.userId, actionType: "contact_followup", targetType: "contact", targetId: id, payload: {}, preview: {}, expectedFingerprint: "fixture", expiresAt: new Date(now.getTime() + 60000) });
  await assert.rejects(db.batch([
    db.update(contacts).set({ nextFollowUpAt: guardedLegacyFollowUpAt(new Date(nextActionDayMirror(draft.dueAt))) }).where(eq(contacts.id, id)),
    db.insert(auditEvents).values({ eventType: "contact_updated", actorUserId: owner.userId, safeMetadata: { mechanism: "guard-test" } }),
    db.update(aiPreparedActions).set({ status: "executed" }).where(eq(aiPreparedActions.id, actionId)),
  ]), isPendingNextActionConflict); checks++;
  check("AI guard rolls back its audit/action transition even on the same day", (await db.select().from(aiPreparedActions).where(eq(aiPreparedActions.id, actionId)))[0].status === "prepared" && await count("audit_events") === 1);
  const outsider = await mutateNextAction({ actor: other, db }, id, base, now);
  const readonly = await mutateNextAction({ actor: { ...owner, role: "member" }, db }, id, base, now);
  check("mutation authorization remains scoped and read-only members stay read-only", !outsider.ok && outsider.reason === "not_found" && !readonly.ok && readonly.reason === "forbidden");
  await assert.rejects(pg.query("update contacts set next_action_kind=null where id=$1", [id])); checks++;
  await assert.rejects(pg.query("update contacts set next_follow_up_at='2026-11-10T12:00:00Z' where id=$1", [id])); checks++;
  await assert.rejects(pg.query("update contacts set next_action_purpose=$1 where id=$2", [" ".repeat(240) + "x", id])); checks++;
  await assert.rejects(pg.query("update contacts set next_action_purpose='   ' where id=$1", [id])); checks++;
  check("DB constraints preserve a complete pending action and its day mirror", (await row(id)).nextActionKind === "call" && (await row(id)).nextFollowUpAt?.toISOString() === nextActionDayMirror(draft.dueAt));
  console.log(`${checks}/${checks} next action checks passed (isolated PostgreSQL)`);
} finally { await pg.close(); }
