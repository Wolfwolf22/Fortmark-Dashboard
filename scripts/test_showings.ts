/** Showing plans/actual visits against isolated PostgreSQL; no live feed or environment. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";
import { auditEvents, contacts, contactActivities, contactProperties, dashboardUsers, propertyLists, showings, showingMutationRequests } from "../lib/db/schema.ts";
import type { Db } from "../lib/db/client.ts";
import type { Ctx } from "../lib/contacts/service.ts";
import type { Listing } from "../lib/data/types.ts";
import { createPropertyList } from "../lib/contacts/property-lists-service.ts";
import { updatePropertyResearch } from "../lib/contacts/property-research-service.ts";
import { checkShowingSchedule, checkShowingVisit, createShowingInputSchema, readShowingQuery, showingMutationSchema, showingsOverlap, type CreateShowingInput, type ShowingMutation, type ShowingView } from "../lib/showings/domain.ts";
import { createShowing, getShowing, getShowingAgenda, getShowings, getShowingSummary, mutateShowing } from "../lib/showings/service.ts";
import type { PropertyMlsProvider } from "../lib/contacts/properties.ts";

let passed = 0;
function check(name: string, value: unknown): asserts value { assert.ok(value, name); passed++; }
const now = new Date("2026-11-02T15:00:00.000Z");
const schedule = (hour: number, minute = 0) => ({ startsAt: new Date(Date.UTC(2026, 10, 3, hour, minute)).toISOString(), endsAt: new Date(Date.UTC(2026, 10, 3, hour, minute + 30)).toISOString() });
check("duration bounds include15/240minutes", checkShowingSchedule({ startsAt: "2026-11-03T15:00:00Z", endsAt: "2026-11-03T15:15:00Z" }, now) && checkShowingSchedule({ startsAt: "2026-11-03T15:00:00Z", endsAt: "2026-11-03T19:00:00Z" }, now));
for (const value of [{ startsAt: "2026-11-03T15:00:00Z", endsAt: "2026-11-03T15:14:00Z" }, { startsAt: "2026-11-03T15:00:00Z", endsAt: "2026-11-03T19:01:00Z" }, { startsAt: "2026-11-03T15:00:00", endsAt: "2026-11-03T16:00:00" }, { startsAt: "2026-11-01T15:00:00Z", endsAt: "2026-11-01T16:00:00Z" }, { startsAt: "2029-11-03T15:00:00Z", endsAt: "2029-11-03T16:00:00Z" }]) check("invalid/outofrange schedule refused", !checkShowingSchedule(value, now));
check("overlap is interval-based and backtobackallowed", showingsOverlap(schedule(15), schedule(15, 10)) && !showingsOverlap(schedule(15), schedule(15, 30)));
check("actual visit must be explicitpastwithin730days", checkShowingVisit("2026-11-02T14:00:00Z", now) && !checkShowingVisit("2026-11-03T14:00:00Z", now) && !checkShowingVisit("2020-11-02T14:00:00Z", now));
check("property status and revision must be submitted together", !showingMutationSchema.safeParse({ action: "complete", requestId: randomUUID(), expectedUpdatedAt: now.toISOString(), visitedAt: now.toISOString(), likes: "", concerns: "", summary: "", reviewStatus: "shortlisted" }).success);
check("clientcannotinjectMLSdisplayorowner", !createShowingInputSchema.safeParse({ requestId: randomUUID(), propertyId: randomUUID(), contactId: randomUUID(), ...schedule(15), meetingDetails: "", notes: "", address: "Injected" }).success);
for (const query of ["from=2026-11-01&to=2026-11-30", "from=2026-11-01T00:00:00Z&to=2027-03-01T00:00:00Z", "from=2026-11-01T00:00:00Z&to=2026-11-30T00:00:00Z&pageSize=25", "from=2026-11-01T00:00:00Z&to=2026-11-30T00:00:00Z&notes=private"]) check("agendaqueryboundedandstrict", readShowingQuery(new URLSearchParams(query)) === null);

const { pg, db } = await createLocalContactDb();
const actor = { userId: randomUUID(), role: "agent" as const, brokerageKey: "fortmark" }, other = { userId: randomUUID(), role: "agent" as const, brokerageKey: "fortmark" }, admin = { userId: randomUUID(), role: "admin" as const, brokerageKey: "fortmark" };
const ctx: Ctx = { actor, db }, otherCtx: Ctx = { actor: other, db }, adminCtx: Ctx = { actor: admin, db }, reader: Ctx = { actor: { ...actor, role: "member" }, db };
const contactId = randomUUID(), otherContactId = randomUUID(), sourcePropertyId = randomUUID();
const query = { from: "2026-11-01T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z", status: "all" as const };
let sourceListId = "";
async function plan(hour: number, minute = 0, context = ctx, extra: Partial<CreateShowingInput> = {}) {
  const input: CreateShowingInput = { requestId: randomUUID(), propertyId: sourcePropertyId, contactId, ...schedule(hour, minute), meetingDetails: "Private meeting details", notes: "Private planning note", ...extra };
  const result = await createShowing(context, input, now); check("synthetic showing plans", result.ok); return { showing: result.value, input };
}
function beforeBatch(work: () => Promise<void>, after = false, capture?: string[]): Db {
  let pending = true;
  return new Proxy(db, { get(target, property) { if (property === "batch") return async (writes: Parameters<Db["batch"]>[0]) => {
    if (capture) for (const write of writes) capture.push((write as unknown as { toSQL(): { sql: string } }).toSQL().sql);
    if (pending && !after) { pending = false; await work(); } const result = await target.batch(writes); if (pending && after) { pending = false; await work(); } return result;
  }; const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; } });
}
async function visitCount() { return (await db.select().from(contactActivities)).filter(row => row.kind === "showing").length; }
async function mutate(showing: ShowingView, input: Omit<Extract<ShowingMutation, { action: "complete" }>, "requestId" | "expectedUpdatedAt">, context = ctx) {
  const body = { requestId: randomUUID(), expectedUpdatedAt: showing.updatedAt, ...input };
  return { body, result: await mutateShowing(context, showing.id, body, now) };
}
try {
  await db.insert(dashboardUsers).values([actor, other, admin].map((user, index) => ({ id: user.userId, role: user.role, clerkUserId: `synthetic_showing_${index}`, primaryEmail: `showing${index}@example.test`, status: "active" as const })));
  const nextActionId = randomUUID();
  await db.insert(contacts).values([{ id: contactId, assignedAgentUserId: actor.userId, firstName: "Showing contact", updatedAt: now, lastContactAt: new Date("2026-11-01T17:00:00Z"), nextActionId, nextActionKind: "call", nextActionPurpose: "Existing next action", nextActionDueAt: new Date("2026-11-04T16:00:00Z"), nextActionAssignedUserId: admin.userId, nextFollowUpAt: new Date("2026-11-04T12:00:00Z") }, { id: otherContactId, assignedAgentUserId: other.userId, firstName: "Other contact" }]);
  const list = await createPropertyList(ctx, { requestId: randomUUID(), name: "Showing source", contactId }, now); check("source list creates", list.ok); sourceListId = list.value.id;
  await db.insert(contactProperties).values({ id: sourcePropertyId, listId: sourceListId, contactId, dataset: "synthetic", listingId: "source-key", mlsNumber: "A123", notes: "Private property notes never copied", createdAt: now, updatedAt: now });
  const [contactBefore] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  const nextFields = (row: typeof contactBefore) => JSON.stringify([row.nextActionId, row.nextActionKind, row.nextActionPurpose, row.nextActionDueAt, row.nextActionAssignedUserId, row.nextFollowUpAt]);
  const planned = await plan(15);
  check("plan stores stable references and no listing snapshot", planned.showing.listing === null && planned.showing.sourceProperty?.id === sourcePropertyId && planned.showing.dataset === "synthetic" && !JSON.stringify(planned.showing).includes("Private property notes"));
  check("plan is not outreach and does not change nextaction", await visitCount() === 0 && (await db.select().from(contacts).where(eq(contacts.id, contactId)))[0].lastContactAt?.toISOString() === contactBefore.lastContactAt?.toISOString() && nextFields((await db.select().from(contacts).where(eq(contacts.id, contactId)))[0]) === nextFields(contactBefore));
  const replay = await createShowing(ctx, planned.input, now); check("identical create retries same showing", replay.ok && replay.value.id === planned.showing.id && (await db.select().from(showings)).length === 1);
  const changedCreate = await createShowing(ctx, { ...planned.input, notes: "Changed payload" }, now); check("create request key is payloadbound", !changedCreate.ok && changedCreate.reason === "request_conflict");
  const collision = await createShowing(ctx, { ...planned.input, requestId: randomUUID(), ...schedule(15, 10) }, now); check("sameowner overlap refuses with no partialrow", !collision.ok && collision.reason === "time_conflict" && (await db.select().from(showings)).length === 1);
  const adjacent = await plan(15, 30);
  check("adjacent interval is accepted", adjacent.showing.startsAt === planned.showing.endsAt);
  await db.update(dashboardUsers).set({ role: "member" }).where(eq(dashboardUsers.id, actor.userId));
  check("member cannot create or mutate", !(await createShowing(reader, { ...planned.input, requestId: randomUUID(), ...schedule(18) }, now)).ok && !(await mutateShowing(reader, planned.showing.id, { action: "cancel", requestId: randomUUID(), expectedUpdatedAt: planned.showing.updatedAt, reason: "No" }, now)).ok);
  const memberRead = await getShowing(reader, planned.showing.id);
  check("member can read own showing without writeabilities", memberRead.ok && memberRead.value.canEdit === false);
  check("stale agent role does not retain showing access after demotion", !(await getShowing(ctx, planned.showing.id)).ok);
  await db.update(dashboardUsers).set({ role: "agent" }).where(eq(dashboardUsers.id, actor.userId));
  check("admin cannot read colleague-owned appointment evenvisiblecontact", !(await getShowing(adminCtx, planned.showing.id)).ok);
  const otherList = await createPropertyList(otherCtx, { requestId: randomUUID(), name: "Other source", contactId: otherContactId }, now); check("other list creates", otherList.ok);
  const otherPropertyId = randomUUID(); await db.insert(contactProperties).values({ id: otherPropertyId, listId: otherList.value.id, contactId: otherContactId, dataset: "synthetic", listingId: "other-key", mlsNumber: "O123" });
  const otherPlan = await createShowing(otherCtx, { ...planned.input, requestId: randomUUID(), contactId: otherContactId, propertyId: otherPropertyId }, now);
  check("overlapneverblocksotherowner", otherPlan.ok);
  check("otherowner records absent fromagenda", (await getShowings(ctx, query) as { ok: true; value: { total: number } }).value.total === 2);
  check("otherowner property cannot be used evenadmin", !(await createShowing(adminCtx, { ...planned.input, requestId: randomUUID(), propertyId: sourcePropertyId, ...schedule(18) }, now)).ok);
  const concurrentInputs = [0, 1].map(() => ({ ...planned.input, requestId: randomUUID(), ...schedule(16) }));
  const concurrent = await Promise.all(concurrentInputs.map(input => createShowing(ctx, input, now)));
  check("actor serialization makes concurrent overlappingplans chooseone", concurrent.filter(result => result.ok).length === 1 && concurrent.some(result => !result.ok && result.reason === "time_conflict"));
  const winner = concurrent.find(result => result.ok)!; assert.ok(winner.ok);
  const sameInput = { ...planned.input, requestId: randomUUID(), ...schedule(17) }, captures: string[] = [];
  const sameCreates = await Promise.all([createShowing({ actor, db: beforeBatch(async () => {}, false, captures) }, sameInput, now), createShowing(ctx, sameInput, now)]);
  check("concurrent identicalcreateretry returnsone durableplan", sameCreates.every(result => result.ok) && sameCreates[0].ok && sameCreates[1].ok && sameCreates[0].value.id === sameCreates[1].value.id);
  check("ownerlock serializes without blocking auditFKkeyshare", captures.some(sql => /from "dashboard_users".*for no key update/.test(sql)) && !captures.some(sql => /from "dashboard_users".*for update/.test(sql)));
  const stale = await mutateShowing(ctx, adjacent.showing.id, { action: "update", requestId: randomUUID(), expectedUpdatedAt: "2020-01-01T00:00:00Z", ...schedule(18), meetingDetails: "", notes: "" }, now); check("stale showingedit refused", !stale.ok && stale.reason === "conflict");
  const rescheduleConflict = await mutateShowing(ctx, adjacent.showing.id, { action: "reschedule", requestId: randomUUID(), expectedUpdatedAt: adjacent.showing.updatedAt, ...schedule(16, 10), meetingDetails: "New meeting", notes: "New plan" }, now); check("reschedule overlaps checkedbeforewrite", !rescheduleConflict.ok && rescheduleConflict.reason === "time_conflict");
  const cancelledInput = { action: "cancel" as const, requestId: randomUUID(), expectedUpdatedAt: winner.value.updatedAt, reason: "Private cancellation reason" };
  const cancelled = await mutateShowing(ctx, winner.value.id, cancelledInput, now); check("cancelledplan hasreasonandnofaketouch", cancelled.ok && cancelled.value.status === "cancelled" && await visitCount() === 0);
  check("cancel retry historyidempotent", (await mutateShowing(ctx, winner.value.id, cancelledInput, now)).ok && (await db.select().from(showingMutationRequests)).filter(row => row.requestId === cancelledInput.requestId).length === 1);
  const replaceCancelled = await plan(16); check("cancelledinterval no longerblocks", replaceCancelled.showing.status === "scheduled");
  const rescheduledInput = { action: "reschedule" as const, requestId: randomUUID(), expectedUpdatedAt: adjacent.showing.updatedAt, ...schedule(18), meetingDetails: "Private new meeting", notes: "Private new plan" };
  const rescheduled = await mutateShowing(ctx, adjacent.showing.id, rescheduledInput, now); check("scheduledplan canreschedulewithouttouch", rescheduled.ok && rescheduled.value.startsAt === schedule(18).startsAt && await visitCount() === 0);

  const completion = { action: "complete" as const, requestId: randomUUID(), expectedUpdatedAt: planned.showing.updatedAt, visitedAt: "2026-11-02T14:00:00Z", likes: "Private liked pool", concerns: "Private concern", summary: "Private visit feedback", reviewStatus: "shortlisted" as const, expectedPropertyUpdatedAt: now.toISOString() };
  const completed = await mutateShowing(ctx, planned.showing.id, completion, now);
  check("completionstoresfeedbackandexplicitactualvisit", completed.ok && completed.value.status === "completed" && completed.value.visitedAt === "2026-11-02T14:00:00.000Z" && completed.value.feedbackLikes === completion.likes);
  const [contactAfter] = await db.select().from(contacts).where(eq(contacts.id, contactId)), [propertyAfter] = await db.select().from(contactProperties).where(eq(contactProperties.id, sourcePropertyId));
  check("explicitvisitadvancesactualcontactbutpreservespendingaction", contactAfter.lastContactAt?.toISOString() === "2026-11-02T14:00:00.000Z" && nextFields(contactAfter) === nextFields(contactBefore));
  check("optionalreviewupdatesONLYoriginalmembershipstatus", propertyAfter.reviewStatus === "shortlisted" && propertyAfter.notes === "Private property notes never copied");
  const activity = (await db.select().from(contactActivities)).find(row => row.kind === "showing")!;
  check("completionactivitygenericwithactualtimeandsafeIDsonly", activity.summary === "Showing completed" && activity.occurredAt.toISOString() === completed.value.visitedAt && Object.keys(activity.safeMetadata!).sort().join() === "event,showingId,sourcePropertyId" && !JSON.stringify(activity.safeMetadata).includes("Private"));
  const repeat = await mutateShowing(ctx, planned.showing.id, completion, now); check("completedretrycreatesnorepeattouch", repeat.ok && await visitCount() === 1);
  const changedComplete = await mutateShowing(ctx, planned.showing.id, { ...completion, summary: "Changed retry" }, now); check("changedmutationpayloadrequestconflict", !changedComplete.ok && changedComplete.reason === "request_conflict");
  const completeAgain = await mutateShowing(ctx, planned.showing.id, { ...completion, requestId: randomUUID(), expectedUpdatedAt: completed.value.updatedAt }, now); check("completedshowingcannotbecompletedagain", !completeAgain.ok && completeAgain.reason === "invalid_transition" && await visitCount() === 1);
  const lateVisit = await mutate(replaceCancelled.showing, { action: "complete", visitedAt: "2026-11-01T14:00:00Z", likes: "", concerns: "", summary: "Earlier actual visit" }); check("earliervisitsave succeeds", lateVisit.result.ok);
  check("lastContactneverregressesforbackdatedvisit", (await db.select().from(contacts).where(eq(contacts.id, contactId)))[0].lastContactAt?.toISOString() === "2026-11-02T14:00:00.000Z");
  const futureVisit = await mutateShowing(ctx, rescheduled.value.id, { ...completion, requestId: randomUUID(), expectedUpdatedAt: rescheduled.value.updatedAt, visitedAt: "2026-11-03T14:00:00Z" }, now); check("futureactualvisitrefused", !futureVisit.ok && futureVisit.reason === "invalid_date");

  const stalePropertyPlan = await plan(19);
  const editedProperty = await updatePropertyResearch(ctx, sourceListId, sourcePropertyId, { notes: "New private property note", reviewStatus: "ruled_out", expectedUpdatedAt: propertyAfter.updatedAt.toISOString() }, now); check("propertyCASfixtureupdated", editedProperty.ok);
  const stalePropertyCompletion = await mutateShowing(ctx, stalePropertyPlan.showing.id, { ...completion, requestId: randomUUID(), expectedUpdatedAt: stalePropertyPlan.showing.updatedAt, expectedPropertyUpdatedAt: propertyAfter.updatedAt.toISOString() }, now);
  check("staleoptionalpropertyreviewblockswholecompletion", !stalePropertyCompletion.ok && stalePropertyCompletion.reason === "property_conflict" && (await getShowing(ctx, stalePropertyPlan.showing.id) as { ok: true; value: ShowingView }).value.status === "scheduled");
  await db.update(contactProperties).set({ removedAt: now }).where(eq(contactProperties.id, sourcePropertyId));
  const removedSourceCreate = await createShowing(ctx, { ...planned.input, requestId: randomUUID(), ...schedule(20) }, now); check("newplanrequiresactivesavedproperty", !removedSourceCreate.ok);
  const stillEditable = await mutateShowing(ctx, stalePropertyPlan.showing.id, { action: "update", requestId: randomUUID(), expectedUpdatedAt: stalePropertyPlan.showing.updatedAt, ...schedule(19), meetingDetails: "Changed details with removed source", notes: "Still a legitimate plan" }, now); check("existingplanretainseditabilityafterremovalsource", stillEditable.ok);
  const removedSourceReview = await mutateShowing(ctx, stalePropertyPlan.showing.id, { ...completion, requestId: randomUUID(), expectedUpdatedAt: stillEditable.value.updatedAt, expectedPropertyUpdatedAt: editedProperty.value.updatedAt }, now); check("removedsourcecannotbeupdatedimplicitly", !removedSourceReview.ok && removedSourceReview.reason === "property_conflict");
  const withoutReview = await mutateShowing(ctx, stalePropertyPlan.showing.id, { action: "complete", requestId: randomUUID(), expectedUpdatedAt: stillEditable.value.updatedAt, visitedAt: "2026-11-02T14:30:00Z", likes: "Visit despite removed source", concerns: "", summary: "" }, now); check("feedbackcancompletewithoutpropertyupdateafterremoval", withoutReview.ok && withoutReview.value.status === "completed");
  await db.update(contactProperties).set({ removedAt: null }).where(eq(contactProperties.id, sourcePropertyId));

  const lostInput = { ...planned.input, requestId: randomUUID(), ...schedule(20) };
  const lostCreate = await createShowing({ actor, db: beforeBatch(async () => { throw new Error("Synthetic lost response"); }, true) }, lostInput, now); check("lostcreateanswerrecoversdurableplan", lostCreate.ok);
  const lostMutationInput = { action: "complete" as const, requestId: randomUUID(), expectedUpdatedAt: lostCreate.value.updatedAt, visitedAt: "2026-11-02T14:45:00Z", likes: "", concerns: "", summary: "Lost reply feedback" };
  const visitsBeforeLost = await visitCount();
  const lostMutation = await mutateShowing({ actor, db: beforeBatch(async () => { throw new Error("Synthetic lost mutation response"); }, true) }, lostCreate.value.id, lostMutationInput, now);
  check("lostcompletedanswerrecoversreceiptwithoutdoubleactivity", lostMutation.ok && await visitCount() === visitsBeforeLost + 1 && (await mutateShowing(ctx, lostCreate.value.id, lostMutationInput, now)).ok && await visitCount() === visitsBeforeLost + 1);
  const injectedPlan = await plan(21), injectedInput = { action: "cancel" as const, requestId: randomUUID(), expectedUpdatedAt: injectedPlan.showing.updatedAt, reason: "Should not overwrite newer plan" };
  const injectedDb = beforeBatch(async () => { const changed = await mutateShowing(ctx, injectedPlan.showing.id, { action: "update", requestId: randomUUID(), expectedUpdatedAt: injectedPlan.showing.updatedAt, ...schedule(21), meetingDetails: "Newer private details", notes: "Newer private plan" }, now); assert.ok(changed.ok); });
  const injected = await mutateShowing({ actor, db: injectedDb }, injectedPlan.showing.id, injectedInput, now); check("lockedCAScatcheschangeafterpreflight", !injected.ok && injected.reason === "conflict" && (await getShowing(ctx, injectedPlan.showing.id) as { ok: true; value: ShowingView }).value.meetingDetails === "Newer private details");

  const beforeAtomicRows = (await db.select().from(showings)).length, beforeAtomicVisits = await visitCount();
  await pg.exec("create function fail_showing_audit() returns trigger language plpgsql as $$begin raise exception 'local audit failure'; end$$; create trigger showing_audit_failure before insert on audit_events for each row execute function fail_showing_audit()");
  const failedCreate = await createShowing(ctx, { ...planned.input, requestId: randomUUID(), ...schedule(22) }, now); check("failedcreateauditrollsbackplan", !failedCreate.ok && (await db.select().from(showings)).length === beforeAtomicRows);
  const failedComplete = await mutateShowing(ctx, injectedPlan.showing.id, { action: "complete", requestId: randomUUID(), expectedUpdatedAt: (await getShowing(ctx, injectedPlan.showing.id) as { ok: true; value: ShowingView }).value.updatedAt, visitedAt: "2026-11-02T14:55:00Z", likes: "Should rollback", concerns: "", summary: "" }, now); check("failedcompletionauditrollsbackvisitstatusandtouch", !failedComplete.ok && await visitCount() === beforeAtomicVisits && (await getShowing(ctx, injectedPlan.showing.id) as { ok: true; value: ShowingView }).value.status === "scheduled");
  await pg.exec("drop trigger showing_audit_failure on audit_events; drop function fail_showing_audit()");

  const propertyRacePlan = await plan(22), propertyRaceSnapshot = (await db.select().from(contactProperties).where(eq(contactProperties.id, sourcePropertyId)))[0], visitsBeforePropertyRace = await visitCount();
  const propertyRaceDb = beforeBatch(async () => { const saved = await updatePropertyResearch(ctx, sourceListId, sourcePropertyId, { notes: "Newer source research during completion", reviewStatus: "to_review", expectedUpdatedAt: propertyRaceSnapshot.updatedAt.toISOString() }, now); assert.ok(saved.ok); });
  const propertyRace = await mutateShowing({ actor, db: propertyRaceDb }, propertyRacePlan.showing.id, { ...completion, requestId: randomUUID(), expectedUpdatedAt: propertyRacePlan.showing.updatedAt, expectedPropertyUpdatedAt: propertyRaceSnapshot.updatedAt.toISOString() }, now);
  check("optionalpropertyCASrechecksafterpreflightandrollsbackentirevisit", !propertyRace.ok && propertyRace.reason === "property_conflict" && await visitCount() === visitsBeforePropertyRace && (await getShowing(ctx, propertyRacePlan.showing.id) as { ok: true; value: ShowingView }).value.status === "scheduled" && (await db.select().from(contactProperties).where(eq(contactProperties.id, sourcePropertyId)))[0].notes === "Newer source research during completion");
  const removedRaceInput = { ...planned.input, requestId: randomUUID(), ...schedule(22, 30) };
  const removedRace = await createShowing({ actor, db: beforeBatch(async () => { await db.update(contactProperties).set({ removedAt: now }).where(eq(contactProperties.id, sourcePropertyId)); }) }, removedRaceInput, now);
  check("sourcewithdrawnafterpreflightcannotleavepartialplan", !removedRace.ok && !(await db.select().from(showings)).some(row => row.createRequestId === removedRaceInput.requestId));
  await db.update(contactProperties).set({ removedAt: null }).where(eq(contactProperties.id, sourcePropertyId));
  const raceContactId = randomUUID(); await db.insert(contacts).values({ id: raceContactId, assignedAgentUserId: actor.userId, firstName: "Revoked visit contact" });
  const contactRacePlan = await plan(23, 0, ctx, { contactId: raceContactId }), beforeRevokedVisits = await visitCount();
  const contactRaceDb = beforeBatch(async () => { await db.update(contacts).set({ assignedAgentUserId: other.userId }).where(eq(contacts.id, raceContactId)); });
  const revokedCompletion = await mutateShowing({ actor, db: contactRaceDb }, contactRacePlan.showing.id, { action: "complete", requestId: randomUUID(), expectedUpdatedAt: contactRacePlan.showing.updatedAt, visitedAt: "2026-11-02T14:57:00Z", likes: "", concerns: "", summary: "Must not save after revocation" }, now);
  check("contactscopeisrecheckedatomicallybeforevisitfeedbackandtouch", !revokedCompletion.ok && revokedCompletion.reason === "not_found" && await visitCount() === beforeRevokedVisits && (await db.select().from(showings).where(eq(showings.id, contactRacePlan.showing.id)))[0].status === "scheduled");
  await db.update(contacts).set({ assignedAgentUserId: actor.userId }).where(eq(contacts.id, raceContactId));
  const concurrentVisit = await plan(23, 30), beforeConcurrentVisits = await visitCount();
  const concurrentVisitInput = { action: "complete" as const, requestId: randomUUID(), expectedUpdatedAt: concurrentVisit.showing.updatedAt, visitedAt: "2026-11-02T14:58:00Z", likes: "", concerns: "", summary: "One actual visit" };
  const completedTogether = await Promise.all([mutateShowing(ctx, concurrentVisit.showing.id, concurrentVisitInput, now), mutateShowing(ctx, concurrentVisit.showing.id, concurrentVisitInput, now)]);
  check("concurrentidenticalcompletionrecordsonevisitandbothrecoverreceipt", completedTogether.every(result => result.ok) && await visitCount() === beforeConcurrentVisits + 1);

  let inFlight = 0, maxFlight = 0, feedCalls = 0;
  const provider: PropertyMlsProvider = { lookup: async () => { throw new Error("Showing page never searches"); }, get: async (dataset, id, number) => { feedCalls++; inFlight++; maxFlight = Math.max(maxFlight, inFlight); await new Promise(resolve => setTimeout(resolve, 1)); inFlight--; return { ok: true, value: { dataset, listing: { id, mlsNumber: number, source: "mls", address: "Fresh synthetic home", city: "Sample", zip: "00000", status: "active", propertyType: "condo", listPrice: 200, beds: 1, baths: 1, sqft: 1, listedDate: now.toISOString(), agentId: "", photos: [], description: "", priceHistory: [] } as Listing } }; } };
  const hydrated = await getShowings(ctx, { ...query, pageSize: 4 }, provider); check("selectedpagehydratesfreshMLSmaxfour", hydrated.ok && hydrated.value.items.length === 4 && feedCalls === 4 && maxFlight === 4 && hydrated.value.items.every(item => item.listing?.listPrice === 200));
  const beforeHiddenRead = feedCalls; check("unauthorizedshowingreadnevercallsfeed", !(await getShowing(adminCtx, planned.showing.id, provider)).ok && feedCalls === beforeHiddenRead);
  const outage = await getShowing(ctx, planned.showing.id, { ...provider, get: async () => ({ ok: false, reason: "unavailable" }) }); check("MLSoutageretainsstableidentifiersandprivatefeedback", outage.ok && outage.value.mlsNumber === "A123" && outage.value.listing === null && outage.value.feedbackSummary === completion.summary);
  await db.update(propertyLists).set({ ownerUserId: other.userId }).where(eq(propertyLists.id, sourceListId));
  const sourceHidden = await getShowing(ctx, planned.showing.id); check("historicalownshowinghidesnowprivate sourcelistcontext", sourceHidden.ok && sourceHidden.value.sourceProperty === null && sourceHidden.value.contactId === contactId);
  await db.update(propertyLists).set({ ownerUserId: actor.userId }).where(eq(propertyLists.id, sourceListId));
  const agenda = await getShowingAgenda(ctx, { ...query, pageSize: 1, page: 2 }); check("agendagroupskeeprequestedpagewithoutrepeatingexhaustedactions", agenda.ok && agenda.value.showings.page === 2 && agenda.value.nextActions.page === 2 && agenda.value.nextActions.total === 1 && agenda.value.nextActions.items.length === 0);
  const actionAgenda = await getShowingAgenda(ctx, query); check("contactnextactionsreadonlyanddistinctfromshowings", actionAgenda.ok && actionAgenda.value.nextActions.items[0].action.id === nextActionId && actionAgenda.value.nextActions.items[0].action.assigneeId === admin.userId);
  const summary = await getShowingSummary(ctx, undefined, 3, now); check("Homesummaryfuturewindowcountandexcludesterminal", summary.ok && summary.value.items.length <= 3 && summary.value.items.every(item => item.status === "scheduled" && Date.parse(item.endsAt) > now.getTime()));
  const ongoingSummary = await getShowingSummary(ctx, undefined, 3, new Date("2026-11-03T18:10:00Z"));
  check("upcomingsummaryincludesongoingandexcludesendedappointments", ongoingSummary.ok && ongoingSummary.value.items.some(item => item.id === rescheduled.value.id) && ongoingSummary.value.items.every(item => Date.parse(item.endsAt) > Date.parse("2026-11-03T18:10:00Z")));
  const serialized = JSON.stringify((await db.select().from(auditEvents)).map(row => row.safeMetadata)) + JSON.stringify((await db.select().from(showingMutationRequests)).map(row => row.result));
  check("auditsandreceiptsnevercontainprivateplanorfeedback", !/Private meeting|Private planning|Private liked|Private concern|Private visit|Private cancellation|Newer private|Lost reply feedback/.test(serialized));
  await db.update(contacts).set({ assignedAgentUserId: other.userId }).where(eq(contacts.id, contactId));
  const revoked = await getShowing(ctx, planned.showing.id); check("everyreadreauthorizescurrentcontactscope", !revoked.ok && revoked.reason === "not_found");
  const revokedReplay = await mutateShowing(ctx, planned.showing.id, completion, now); check("mutationreplaycannotbypasslostcontactscope", !revokedReplay.ok && revokedReplay.reason === "not_found");
  check("createreplaycannotbypasslostcontactscope", !(await createShowing(ctx, planned.input, now)).ok);
  console.log(`${passed}/${passed} showing checks passed (isolated PostgreSQL and fake MLS; no live access)`);
} finally { await pg.close(); }
