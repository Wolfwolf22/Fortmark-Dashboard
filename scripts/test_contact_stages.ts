/** Contact stage surfaces and race/rollback checks against isolated PostgreSQL. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../lib/db/client.ts";
import { aiPreparedActions, auditEvents, contactActivities, contacts, dashboardUsers, transactionParties, transactions } from "../lib/db/schema.ts";
import { ALL_CONTACT_STAGES, ACTIVE_CLIENT_STAGES, OPEN_PIPELINE_STAGES, allowedStageTransitions, canTransition, requiresEngagementNotice, type ContactStage } from "../lib/contacts/stages.ts";
import { changeStage, commitStageChange, contactSnapshot, getContact, listContactsPage, planStageChange, StageChangeConflict, type Ctx } from "../lib/contacts/service.ts";
import { contactAttention, contactMetrics } from "../lib/contacts/metrics.ts";
import { snapshotOf, applyQuery } from "../lib/contacts/windows.ts";
import { contactStageChangeSchema } from "../lib/contacts/domain.ts";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";
import { listSampleLeads, updateSampleLeadStage } from "../lib/data/sample-leads.ts";

const { pg, db } = await createLocalContactDb();
const actor = { userId: "11111111-1111-4111-8111-111111111111", role: "agent" as const, brokerageKey: "fortmark" };
const other = { ...actor, userId: "22222222-2222-4222-8222-222222222222" };
const ctx: Ctx = { actor, db };
const now = new Date("2026-10-29T16:00:00.000Z");
const due = new Date("2026-10-28T12:00:00.000Z");
const createdAt = new Date("2026-09-01T12:00:00.000Z");
let checks = 0;
function check(name: string, value: unknown) { assert.ok(value, name); checks++; }
const count = async (table: string) => Number((await pg.query<{ n: number }>(`select count(*)::int n from ${table}`)).rows[0].n);
async function reset() { await pg.exec("truncate contacts, audit_events, ai_prepared_actions, transactions cascade"); }
async function seed(stage: ContactStage = "lead", owner = actor, tenant = owner.brokerageKey) {
  const id = randomUUID();
  await db.insert(contacts).values({ id, brokerageKey: tenant, assignedAgentUserId: owner.userId,
    createdByUserId: owner.userId, updatedByUserId: owner.userId, firstName: "Stage fixture", stage,
    nextFollowUpAt: due, createdAt, updatedAt: now });
  return id;
}
function beforeBatch(work: () => Promise<void>): Db {
  let pending = true;
  return new Proxy(db, { get(target, property) {
    if (property === "batch") return async (queries: Parameters<Db["batch"]>[0]) => {
      if (pending) { pending = false; await work(); }
      return target.batch(queries);
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
}
async function failOn(table: string) {
  await pg.exec(`create function fail_stage_write() returns trigger language plpgsql as $$begin raise exception 'local stage failure'; end$$;
    create trigger stage_failure before ${table === "contacts" ? "update" : "insert"} on ${table} for each row execute function fail_stage_write()`);
  return async () => { await pg.exec(`drop trigger stage_failure on ${table}; drop function fail_stage_write()`); };
}

try {
  await db.insert(dashboardUsers).values([actor, other].map(owner => ({ id: owner.userId, clerkUserId: `user_stage${owner.userId.replaceAll("-", "")}`,
    primaryEmail: `${owner.userId}@example.test`, status: "active" as const, role: "agent" as const })));
  check("unknown runtime destinations and sources are refused", !canTransition("lead", "unknown" as ContactStage) && !canTransition("unknown" as ContactStage, "lead"));
  check("the API accepts only known expected source stages", contactStageChangeSchema.safeParse({ stage: "lead", expectedStage: "archived" }).success && !contactStageChangeSchema.safeParse({ stage: "lead", expectedStage: "unknown" }).success);
  check("archived has only explicit Lead restoration", allowedStageTransitions("archived").join() === "lead");
  check("lost only reopens to lifecycle stages", !allowedStageTransitions("lost").includes("archived") && !allowedStageTransitions("lost").includes("lost") && allowedStageTransitions("lost").includes("qualified"));
  const sampleContact = listSampleLeads()[0];
  const originalSample = { ...sampleContact };
  sampleContact.stage = "lead";
  sampleContact.lastContactDate = createdAt.toISOString();
  sampleContact.lastTouchDate = due.toISOString();
  const sampleChanged = updateSampleLeadStage(sampleContact.id, "qualified");
  check("sample source executes a permitted stage change", sampleChanged?.stage === "qualified");
  check("sample stage changes preserve both outreach date fields", sampleChanged?.lastContactDate === createdAt.toISOString() && sampleChanged.lastTouchDate === due.toISOString());
  Object.assign(sampleContact, originalSample);

  // Every destination offered by the shared graph agrees with actual server planning.
  for (const from of ALL_CONTACT_STAGES) {
    await reset(); const id = await seed(from);
    for (const to of ALL_CONTACT_STAGES) {
      const plan = await planStageChange(ctx, id, to, { now, expectedStage: from });
      check(`${from} -> ${to}: graph, choices and authorized plan agree`, plan.ok === canTransition(from, to) && plan.ok === allowedStageTransitions(from).includes(to));
    }
    check(`${from}: planning never mutates stage or history`, (await getContact(ctx, id))?.stage === from && await count("contact_activities") === 0 && await count("audit_events") === 0);
  }

  // A successful change must agree on the drawer DTO, list filters, snapshot,
  // Home Active Clients/follow-up counts and the equivalent sample predicates.
  for (const stage of ALL_CONTACT_STAGES) {
    await reset(); const id = await seed();
    await seed("active_client", other); await seed("active_client", actor, "elsewhere");
    if (stage !== "lead") {
      const result = await changeStage(ctx, id, stage, now, { expectedStage: "lead", engagementAcknowledged: true });
      check(`${stage}: the stage writer succeeds`, result.ok && result.value.stage === stage);
    }
    const lead = (await getContact(ctx, id))!;
    const list = await listContactsPage(ctx, { stage: [stage], page: 1, pageSize: 25 }, now);
    const snapshot = await contactSnapshot(ctx, now);
    const metrics = await contactMetrics(ctx, now);
    const attention = await contactAttention(ctx, now);
    const activeList = await listContactsPage(ctx, { active: true }, now);
    const sample = snapshotOf([lead], now);
    const open = (OPEN_PIPELINE_STAGES as readonly string[]).includes(stage);
    const active = (ACTIVE_CLIENT_STAGES as readonly string[]).includes(stage);
    check(`${stage}: drawer and scoped filtered list agree`, lead.stage === stage && list.total === 1 && list.items.length === 1 && list.items[0].id === id);
    check(`${stage}: list snapshot and sample stage counts agree`, snapshot.byStage[stage] === 1 && sample.byStage[stage] === 1 && snapshot.total === 1);
    check(`${stage}: pipeline filters and snapshot agree`, snapshot.active === Number(open) && activeList.total === Number(open) && applyQuery([lead], { active: true }, now).total === Number(open));
    check(`${stage}: Home Active Clients use their distinct documented set`, metrics.activeClients === Number(active));
    check(`${stage}: Home due reminders track the open pipeline without deleting dates`, metrics.followUpsDue === Number(open) && attention.length === Number(open) && lead.nextFollowUpDate === due.toISOString());
    check(`${stage}: a stage move never changes either outreach date field`, !lead.lastTouchDate && lead.lastContactDate === createdAt.toISOString());
  }

  await reset(); let id = await seed("qualified");
  for (const table of ["contacts", "contact_activities", "audit_events"]) {
    const release = await failOn(table);
    const failed = await changeStage(ctx, id, "representation", now, { expectedStage: "qualified", engagementAcknowledged: true });
    check(`${table} failure is reported`, !failed.ok && failed.reason === "unavailable");
    check(`${table} failure rolls back stage/history/audit`, (await getContact(ctx, id))?.stage === "qualified" && await count("contact_activities") === 0 && await count("audit_events") === 0);
    await release();
  }
  const acknowledged = await changeStage(ctx, id, "representation", now, { expectedStage: "qualified", engagementAcknowledged: true });
  check("engagement acknowledgement is recorded without changing the graph", acknowledged.ok && requiresEngagementNotice("qualified", "representation"));
  const [event] = (await pg.query<{ safe_metadata: Record<string, unknown> }>("select safe_metadata from contact_activities")).rows;
  check("engagement history records the explicit acknowledgement", event.safe_metadata.engagementAcknowledged === true && event.safe_metadata.from === "qualified" && event.safe_metadata.to === "representation");
  const optedOut = await changeStage(ctx, id, "active_client", now, { expectedStage: "representation" });
  check("acknowledgement remains a recorded fact rather than a new document gate", optedOut.ok);

  // Stale UI and stale plans must not restore an archive or invent from-history.
  await reset(); id = await seed("archived");
  const staleRestore = await changeStage(ctx, id, "lead", now, { expectedStage: "qualified" });
  check("an old drawer cannot accidentally restore a newer archive", !staleRestore.ok && staleRestore.reason === "conflict" && (await getContact(ctx, id))?.stage === "archived" && await count("audit_events") === 0);
  const restored = await changeStage(ctx, id, "lead", now, { expectedStage: "archived" });
  check("explicit restore works with its observed archived source", restored.ok && restored.value.stage === "lead");
  await reset(); id = await seed();
  const first = await planStageChange(ctx, id, "qualified", { now, expectedStage: "lead" });
  const second = await planStageChange(ctx, id, "archived", { now, expectedStage: "lead" });
  assert.ok(first.ok && second.ok);
  const actionId = randomUUID();
  await db.insert(aiPreparedActions).values({ id: actionId, brokerageKey: actor.brokerageKey, actorUserId: actor.userId,
    actionType: "contact_stage_change", targetType: "contact", targetId: id, payload: {}, preview: {},
    expectedFingerprint: "synthetic", expiresAt: new Date(now.getTime() + 60000) });
  await commitStageChange(db, first.value.writes);
  await assert.rejects(commitStageChange(db, [...second.value.writes,
    db.update(aiPreparedActions).set({ status: "executed", executedAt: now }).where(eq(aiPreparedActions.id, actionId))]), StageChangeConflict); checks++;
  check("losing plan preserves the winning stage and one truthful history", (await getContact(ctx, id))?.stage === "qualified" && await count("contact_activities") === 1 && await count("audit_events") === 1);
  check("losing stage plan rolls back appended AI execution too", (await db.select().from(aiPreparedActions).where(eq(aiPreparedActions.id, actionId)))[0].status === "prepared");
  const raceDb = beforeBatch(async () => { const result = await changeStage(ctx, id, "archived", now, { expectedStage: "qualified" }); assert.ok(result.ok); });
  const race = await changeStage({ actor, db: raceDb }, id, "closed", now, { expectedStage: "qualified" });
  check("a transition race after planning reports conflict and cannot undo archive", !race.ok && race.reason === "conflict" && (await getContact(ctx, id))?.stage === "archived" && await count("contact_activities") === 2);
  const bad = await changeStage(ctx, id, "qualified", now, { expectedStage: "archived" });
  check("invalid archived transition writes no additional history", !bad.ok && bad.reason === "invalid_transition" && await count("contact_activities") === 2);

  await reset(); id = await seed();
  const ownerRaceDb = beforeBatch(async () => { await pg.query("update contacts set assigned_agent_user_id=$1 where id=$2", [other.userId, id]); });
  const moved = await changeStage({ actor, db: ownerRaceDb }, id, "qualified", now, { expectedStage: "lead" });
  check("ownership changed after preflight aborts every planned write", !moved.ok && moved.reason === "conflict" && await count("contact_activities") === 0 && await count("audit_events") === 0);
  const privateWrite = await changeStage(ctx, id, "qualified", now);
  check("another owner's contact stays not found", !privateWrite.ok && privateWrite.reason === "not_found");
  const member = await changeStage({ actor: { ...other, role: "member" }, db }, id, "qualified", now);
  check("a member's own contact remains read-only", !member.ok && member.reason === "forbidden");

  // The relationship stage is independent of each deal's transactional stage.
  await reset(); id = await seed("active_client"); const transactionId = randomUUID();
  await db.insert(transactions).values({ id: transactionId, brokerageKey: actor.brokerageKey, agentUserId: actor.userId,
    transactionType: "residential_sale", side: "buyer", stage: "under_contract", addressLine1: "1 Synthetic Way", city: "Fixture" });
  await db.insert(transactionParties).values({ transactionId, contactId: id, role: "buyer", displayName: "Synthetic contact" });
  const closedContact = await changeStage(ctx, id, "closed", now, { expectedStage: "active_client" });
  check("closing the relationship does not close its linked transaction", closedContact.ok && (await db.select().from(transactions).where(eq(transactions.id, transactionId)))[0].stage === "under_contract");

  console.log(`${checks}/${checks} contact stage checks passed (isolated PostgreSQL)`);
} finally { await pg.close(); }
