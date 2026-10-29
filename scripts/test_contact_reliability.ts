/** Actual local PostgreSQL rollback, retry and stale-write checks; no live credentials. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Db } from "../lib/db/client.ts";
import { auditEvents, contactActivities, contacts, dashboardUsers } from "../lib/db/schema.ts";
import { createContact, editContact, getContact, logActivity, changeFollowUp, changeStage, type Ctx } from "../lib/contacts/service.ts";
import { activityInputSchema } from "../lib/contacts/domain.ts";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";

const { pg, db } = await createLocalContactDb();
const actor = { userId: "11111111-1111-4111-8111-111111111111", role: "agent" as const, brokerageKey: "fortmark" };
const other = { ...actor, userId: "22222222-2222-4222-8222-222222222222" };
const now = new Date("2026-10-29T15:00:00.000Z");
const ctx: Ctx = { actor, db };
let checks = 0;
function check(name: string, value: unknown) { assert.ok(value, name); checks++; }
const count = async (table: string) => Number((await pg.query<{ n: number }>(`select count(*)::int n from ${table}`)).rows[0].n);
const row = async (id: string) => (await pg.query<Record<string, unknown>>("select * from contacts where id=$1", [id])).rows[0];
async function reset() { await pg.exec("truncate contacts, audit_events cascade"); }
async function make() {
  const result = await createContact(ctx, { requestId: randomUUID(), firstName: "Local", email: "local@example.test" });
  assert.ok(result.ok); return result.value;
}
async function failIn(table: string) {
  await pg.exec(`create function fail_reliability_write() returns trigger language plpgsql as $$begin raise exception 'local injected failure'; end$$;
    create trigger reliability_failure before insert on ${table} for each row execute function fail_reliability_write()`);
  return async () => { await pg.exec(`drop trigger reliability_failure on ${table}; drop function fail_reliability_write()`); };
}
/** Inject a competing write after service authorization/read but before its SQL mutation. */
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

try {
  await db.insert(dashboardUsers).values([
    { id: actor.userId, clerkUserId: "user_localowner0001", primaryEmail: "owner@example.test", status: "active", role: "agent" },
    { id: other.userId, clerkUserId: "user_localowner0002", primaryEmail: "other@example.test", status: "active", role: "agent" },
  ]);

  // Concurrent creation and retries are serialized by an actual unique key.
  const request = { requestId: randomUUID(), firstName: "Retry", opportunities: [{ kind: "buyer" as const, area: "Synthetic district" }] };
  const pair = await Promise.all([createContact(ctx, request), createContact(ctx, request)]);
  check("both concurrent retries succeed", pair.every((r) => r.ok));
  check("both retries return one contact", pair[0].ok && pair[1].ok && pair[0].value.id === pair[1].value.id);
  for (const table of ["contacts", "contact_opportunities", "contact_activities", "audit_events", "contact_create_requests"]) {
    check(`one ${table} record survives retries`, await count(table) === 1);
  }
  const mismatch = await createContact(ctx, { ...request, firstName: "Different" });
  check("one request key cannot silently create a different payload", !mismatch.ok && mismatch.reason === "request_conflict");
  check("a rejected retry changes no records", await count("contacts") === 1);
  const scoped = await createContact({ actor: other, db }, request);
  check("idempotency keys are scoped to the verified owner", scoped.ok && await count("contacts") === 2);

  // Every creation write is mandatory, including its audit and durable receipt.
  for (const table of ["contact_opportunities", "contact_activities", "audit_events", "contact_create_requests"]) {
    await reset(); const release = await failIn(table);
    const failed = await createContact(ctx, { ...request, requestId: randomUUID() });
    check(`creation reports failure when ${table} fails`, !failed.ok && failed.reason === "unavailable");
    for (const affected of ["contacts", "contact_opportunities", "contact_activities", "audit_events", "contact_create_requests"]) {
      check(`${table} failure rolls back ${affected}`, await count(affected) === 0);
    }
    await release();
  }

  // A response failure after durable creation is recoverable through its receipt.
  await reset();
  let failRead = false;
  const responseFailureDb = new Proxy(db, { get(target, property) {
    if (property === "batch") return async (queries: Parameters<Db["batch"]>[0]) => { const result = await target.batch(queries); failRead = true; return result; };
    if (property === "select") return (...args: Parameters<Db["select"]>) => {
      const selection = target.select(...args);
      return new Proxy(selection, { get(builder, method) {
        if (method === "from") return (table: unknown) => {
          if (table === contacts && failRead) { failRead = false; throw new Error("local response read failure"); }
          return builder.from(table as never);
        };
        const value = Reflect.get(builder, method); return typeof value === "function" ? value.bind(builder) : value;
      } });
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  const retryRequest = { requestId: randomUUID(), firstName: "Durable" };
  await assert.rejects(createContact({ actor, db: responseFailureDb }, retryRequest)); checks++;
  const recovered = await createContact(ctx, retryRequest);
  check("retry recovers a lost response", recovered.ok && await count("contacts") === 1);

  // Millisecond DTO tokens must work on old PostgreSQL microsecond timestamps.
  await reset(); let contact = await make();
  await pg.query("update contacts set updated_at='2026-10-29T15:00:00.123456Z' where id=$1", [contact.id]);
  contact = (await getContact(ctx, contact.id))!;
  check("public token truncates PostgreSQL microseconds", contact.updatedAt === "2026-10-29T15:00:00.123Z");
  const edited = await editContact(ctx, contact.id, { company: "First", expectedUpdatedAt: contact.updatedAt }, now);
  check("a valid millisecond token edits the microsecond row", edited.ok);
  check("revision advances despite an earlier request clock", edited.ok && Date.parse(edited.value.lead.updatedAt!) > Date.parse(contact.updatedAt!));
  const stale = await editContact(ctx, contact.id, { company: "Overwrite", expectedUpdatedAt: contact.updatedAt }, now);
  check("a stale editor is refused", !stale.ok && stale.reason === "conflict");
  check("stale values never land", (await row(contact.id)).company === "First");
  const noToken = await editContact(ctx, contact.id, { company: "No token" }, now);
  check("a missing revision is refused", !noToken.ok && noToken.reason === "invalid_revision");
  const token = (await getContact(ctx, contact.id))!.updatedAt;
  const races = await Promise.all([
    editContact(ctx, contact.id, { company: "Race A", expectedUpdatedAt: token }, now),
    editContact(ctx, contact.id, { company: "Race B", expectedUpdatedAt: token }, now),
  ]);
  check("only one concurrent editor commits", races.filter((r) => r.ok).length === 1);
  check("the second editor receives a conflict", races.some((r) => !r.ok && r.reason === "conflict"));
  const current = (await getContact(ctx, contact.id))!;
  const auditBefore = await count("audit_events");
  const duringRead = beforeExecute(async () => { await pg.query("update contacts set company='Competing', updated_at=updated_at+interval '1 millisecond' where id=$1", [contact.id]); });
  const lostRace = await editContact({ actor, db: duringRead }, contact.id, { email: "draft@example.test", expectedUpdatedAt: current.updatedAt }, now);
  check("conditional update catches a race after the preflight", !lostRace.ok && lostRace.reason === "conflict");
  check("a losing conditional update writes no audit", await count("audit_events") === auditBefore);
  check("a losing edit preserves the other editor's state", (await row(contact.id)).company === "Competing" && (await row(contact.id)).email === "local@example.test");
  const releaseEdit = await failIn("audit_events");
  const editRollback = await editContact(ctx, contact.id, { company: "Rollback", expectedUpdatedAt: (await getContact(ctx, contact.id))!.updatedAt }, now);
  check("edit audit failure is reported", !editRollback.ok && editRollback.reason === "unavailable");
  check("edit data rolls back with its audit", (await row(contact.id)).company === "Competing");
  await releaseEdit();

  // Touch semantics and mandatory history/audit atomicity.
  for (const table of ["contact_activities", "audit_events"]) {
    await reset(); const item = await make();
    const before = await row(item.id); const activities = await count("contact_activities");
    const release = await failIn(table);
    const failed = await logActivity(ctx, item.id, { kind: "call", summary: "Local call", nextFollowUpAt: "2026-10-30T12:00:00.000Z" }, now);
    check(`touch reports ${table} failure`, !failed.ok && failed.reason === "unavailable");
    const after = await row(item.id);
    check("failed touch changes neither last-contact nor reminder", after.last_contact_at === before.last_contact_at && after.next_follow_up_at === before.next_follow_up_at);
    check("failed touch leaves no activity", await count("contact_activities") === activities);
    await release();
  }
  await reset(); contact = await make();
  for (const kind of ["note", "task"] as const) {
    const internal = await logActivity(ctx, contact.id, { kind, summary: "Internal work" }, now);
    check(`${kind} is recorded without claiming outreach`, internal.ok && !internal.value.lastTouchDate);
  }
  check("a malformed explicit mark is rejected", !activityInputSchema.safeParse({ kind: "task", summary: "Internal", markContacted: true }).success);
  const marked = await logActivity(ctx, contact.id, { kind: "note", summary: "Marked contacted", markContacted: true }, now);
  check("quick mark counts as contact", marked.ok && marked.value.lastTouchDate === now.toISOString());
  const [markedActivity] = (await pg.query<{ safe_metadata: { event: string } }>("select safe_metadata from contact_activities where summary='Marked contacted'")).rows;
  check("quick mark is explicitly identified in history", markedActivity.safe_metadata.event === "contact_marked");
  const future = await logActivity(ctx, contact.id, { kind: "call", summary: "Future", occurredAt: "2030-01-01T00:00:00Z" }, now);
  check("a future touch cannot suppress follow-up heuristics", !future.ok && future.reason === "invalid_date");
  const later = new Date("2026-10-29T17:00:00.000Z");
  await Promise.all([
    logActivity(ctx, contact.id, { kind: "email", summary: "Newer", occurredAt: later.toISOString() }, later),
    logActivity(ctx, contact.id, { kind: "call", summary: "Older", occurredAt: now.toISOString() }, later),
  ]);
  check("concurrent backdated touch cannot move last-contact backwards", (await getContact(ctx, contact.id))!.lastTouchDate === later.toISOString());
  const oldTouch = (await getContact(ctx, contact.id))!.lastTouchDate;
  const reminder = await changeFollowUp(ctx, contact.id, { action: "schedule", day: "2026-10-30" }, now);
  check("scheduling is not a touch", reminder.ok && reminder.value.lead.lastTouchDate === oldTouch);
  const concurrentReminder = beforeExecute(async () => {
    const changed = await changeFollowUp(ctx, contact.id, { action: "schedule", day: "2026-11-02" }, now); assert.ok(changed.ok);
  });
  const kept = await logActivity({ actor, db: concurrentReminder }, contact.id, { kind: "call", summary: "Keep current reminder" }, later);
  check("a keep-reminder touch preserves a concurrent reschedule", kept.ok && kept.value.nextFollowUpDate === "2026-11-02T12:00:00.000Z");
  const none = await changeFollowUp(ctx, contact.id, { action: "complete" }, later);
  check("completion clears only the reminder", none.ok && !none.value.lead.nextFollowUpDate && none.value.lead.lastTouchDate === later.toISOString());
  const noOpAudit = await count("audit_events");
  const completedAgain = await changeFollowUp(ctx, contact.id, { action: "complete" }, later);
  check("completing nothing writes nothing", completedAgain.ok && completedAgain.value.outcome === "kept" && await count("audit_events") === noOpAudit);
  const beforeStage = (await getContact(ctx, contact.id))!.updatedAt!;
  const stage = await changeStage(ctx, contact.id, "contacted", now);
  check("stage writes also advance the edit token", stage.ok && Date.parse(stage.value.updatedAt!) > Date.parse(beforeStage));

  // Permissions remain enforced before writes or replaying another person's request.
  const otherRead = await editContact({ actor: other, db }, contact.id, { company: "Private", expectedUpdatedAt: stage.ok ? stage.value.updatedAt : beforeStage }, now);
  check("another agent's contact is not found", !otherRead.ok && otherRead.reason === "not_found");
  const member = await logActivity({ actor: { ...actor, role: "member" }, db }, contact.id, { kind: "call", summary: "Forbidden" }, now);
  check("member stays read-only", !member.ok && member.reason === "forbidden");
  const metadata = (await pg.query<{ safe_metadata: Record<string, unknown> }>("select safe_metadata from audit_events")).rows;
  check("audit never stores contact names, email or touch summaries", !JSON.stringify(metadata).match(/local@example|draft@example|Keep current reminder|Internal work|Synthetic district/));
  console.log(`${checks}/${checks} contact reliability checks passed (embedded PostgreSQL)`);
} finally { await pg.close(); }
