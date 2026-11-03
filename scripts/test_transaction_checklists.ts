/** Real isolated PostgreSQL migration, per-file attestations and guarded stage progression. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { and, eq, inArray } from "drizzle-orm";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";
import { auditEvents, dashboardUsers, transactionChecklistItems, transactionDeadlines, transactionEvents, transactionWriteRequests, transactions } from "../lib/db/schema.ts";
import { DEFAULT_TRANSACTION_CHECKLIST, TRANSACTION_CHECKLIST_VERSION, checklistRequiredStages, type TransactionChecklistMutation } from "../lib/transactions/checklist-domain.ts";
import { createTransaction, changeStage, planStageChange, commitStageChange, type TransactionContext } from "../lib/transactions/service.ts";
import { getTransactionWorkspace, mutateTransactionChecklist, mutateTransactionDeadline } from "../lib/transactions/workspace-service.ts";
import type { TransactionWorkspace } from "../lib/transactions/workspace-domain.ts";

let passed = 0; function check(name: string, value: unknown): asserts value { assert.ok(value, name); passed++; }
const now = new Date("2026-11-03T15:00:00Z");
const migrationDb = new PGlite(), migrationRoot = new URL("../lib/db/migrations/", import.meta.url);
const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", migrationRoot), "utf8")) as { entries: { idx: number; tag: string }[] };
try {
  for (const entry of journal.entries.filter(entry => entry.idx < 25)) await migrationDb.exec(readFileSync(new URL(`${entry.tag}.sql`, migrationRoot), "utf8"));
  const actorId = randomUUID(); await migrationDb.query("insert into dashboard_users(id,clerk_user_id,primary_email,role,status) values($1,'synthetic_migration_checklist','fixture@example.test','agent','active')", [actorId]);
  const beforeIds = [randomUUID(), randomUUID()];
  for (let i = 0; i < beforeIds.length; i++) await migrationDb.query("insert into transactions(id,agent_user_id,transaction_type,side,stage,address_line1,city) values($1,$2,'residential_sale','buyer',$3,'Synthetic','Sample')", [beforeIds[i], actorId, i ? "closed" : "financing"]);
  const entry = journal.entries.find(entry => entry.idx === 25)!; await migrationDb.exec(readFileSync(new URL(`${entry.tag}.sql`, migrationRoot), "utf8"));
  const seeded = await migrationDb.query<{ transaction_id: string; template_key: string; label: string; stage: string; required: boolean; sort_order: number; completed_at: string | null; completed_by_user_id: string | null }>("select * from transaction_checklist_items order by transaction_id,sort_order");
  check("migrationbackfillsEVERYexistingfileincludingterminal", seeded.rows.length === beforeIds.length * DEFAULT_TRANSACTION_CHECKLIST.length && beforeIds.every(id => seeded.rows.filter(row => row.transaction_id === id).length === DEFAULT_TRANSACTION_CHECKLIST.length));
  check("backfillneverfabricatespastcompletion", seeded.rows.every(row => row.completed_at === null && row.completed_by_user_id === null));
  check("SQLsnapshotexactlymatchesversionedpuredefaults", beforeIds.every(id => JSON.stringify(seeded.rows.filter(row => row.transaction_id === id).map(row => ({ templateKey: row.template_key, label: row.label, stage: row.stage, required: row.required, sortOrder: row.sort_order }))) === JSON.stringify(DEFAULT_TRANSACTION_CHECKLIST.map(({ attachmentRequired: _attachmentRequired, ...item }) => item))));
  const versions = await migrationDb.query<{ checklist_template_version: string }>("select checklist_template_version from transactions"); check("backfillpinsfiletemplateversion", versions.rows.every(row => row.checklist_template_version === TRANSACTION_CHECKLIST_VERSION));
  await assert.rejects(migrationDb.query("insert into transaction_checklist_items(transaction_id,template_key,label,stage,sort_order) values($1,'bad','Bad','closed',0)", [beforeIds[0]])); check("databasecheckliststagesrestrictedtoactiveworkflow", true);
} finally { await migrationDb.close(); }

const { pg, db } = await createLocalContactDb();
const owner = { userId: randomUUID(), role: "agent" as const, brokerageKey: "fortmark" }, other = { userId: randomUUID(), role: "agent" as const, brokerageKey: "fortmark" }, admin = { userId: randomUUID(), role: "admin" as const, brokerageKey: "fortmark" };
const ctx: TransactionContext = { actor: owner, db }, member: TransactionContext = { actor: { ...owner, role: "member" }, db };
async function file(id: string) { const result = await getTransactionWorkspace(ctx, id, {}, now); check("authorizedfileloadschecklistsnapshot", result.ok); return result.value; }
async function make() { const result = await createTransaction(ctx, { requestId: randomUUID(), transactionType: "residential_sale", side: "buyer", addressLine1: "Private property address", city: "Sample", notes: "Private transaction note", deadlines: [{ kind: "inspection", label: "Private deadline", dueDate: "2026-11-06" }] }, now); check("atomiccreatesucceedswithtriggeredsnapshot", result.ok); return file(result.value.id); }
function mutation(workspace: TransactionWorkspace, itemId: string, action: "complete" | "reopen" = "complete"): TransactionChecklistMutation { return { requestId: randomUUID(), expectedUpdatedAt: workspace.updatedAt, itemId, expectedItemUpdatedAt: workspace.checklist.items.find(item => item.id === itemId)!.updatedAt, action }; }
async function complete(workspace: TransactionWorkspace, stages: readonly string[]) { let current = workspace; for (const item of current.checklist.items.filter(item => stages.includes(item.stage) && item.required && !item.completedAt)) { const result = await mutateTransactionChecklist(ctx, current.transaction.id, mutation(current, item.id), now); check("explicititemcompletionpersists", result.ok); current = result.value; } return current; }
const originalBatch = db.batch.bind(db);
async function race<T>(change: () => Promise<void>, operation: () => Promise<T>) { let once = false; db.batch = (async (...args: Parameters<typeof db.batch>) => { if (!once) { once = true; await change(); } return originalBatch(...args); }) as unknown as typeof db.batch; try { return await operation(); } finally { db.batch = originalBatch; } }
async function state() { return (await pg.query<{ value: string }>("select (select coalesce(jsonb_agg(t order by t.id),'[]'::jsonb)::text from transactions t)||'|'||(select coalesce(jsonb_agg(t order by t.id),'[]'::jsonb)::text from transaction_checklist_items t)||'|'||(select count(*) from transaction_write_requests)||'|'||(select count(*) from transaction_events)||'|'||(select count(*) from audit_events) as value")).rows[0].value; }
try {
  await db.insert(dashboardUsers).values([owner, other, admin].map((actor, index) => ({ id: actor.userId, role: actor.role, clerkUserId: `checklist_${index}`, primaryEmail: `check${index}@example.test`, status: "active" as const })));
  let first = await make(), second = await make();
  check("everynewfilesnapshotisindependentpending12", first.checklist.items.length === 12 && second.checklist.items.length === 12 && first.checklist.progress.completed === 0 && first.checklist.progress.required === 12 && !first.checklist.items.some(item => second.checklist.items.some(otherItem => otherItem.id === item.id)));
  const initial = await state(), blocked = await changeStage(ctx, first.transaction.id, "offer", now, { requestId: randomUUID(), expectedUpdatedAt: first.updatedAt });
  check("uncheckedrequireditemsblockserverstagewritewithoutsideeffects", !blocked.ok && blocked.reason === "checklist_incomplete" && await state() === initial);
  const input = mutation(first, first.checklist.items[0].id), completed = await mutateTransactionChecklist(ctx, first.transaction.id, input, now); check("itemcompletionadvancesparentandchildrevisions", completed.ok && completed.value.updatedAt !== first.updatedAt && completed.value.checklist.items[0].updatedAt !== first.checklist.items[0].updatedAt && completed.value.checklist.progress.completed === 1); first = completed.value;
  const [stored] = await db.select().from(transactionChecklistItems).where(eq(transactionChecklistItems.id, input.itemId)); check("completionrecordsactualactorandtime", stored.completedByUserId === owner.userId && stored.completedAt?.toISOString() === now.toISOString());
  check("completiondoesnotadvancefileorcompletelegaldeadline", first.transaction.stage === "opportunity" && first.deadlines.every(deadline => deadline.completedAt === null));
  const afterCompletion = await state(); check("exactUUIDretryhasnoextrahistory", (await mutateTransactionChecklist(ctx, first.transaction.id, input, now)).ok && await state() === afterCompletion);
  const keyConflict = await mutateTransactionChecklist(ctx, first.transaction.id, { ...input, action: "reopen" }, now); check("sameUUIDcannotbinddifferentchecklistaction", !keyConflict.ok && keyConflict.reason === "request_conflict");
  const staleParent = await mutateTransactionChecklist(ctx, first.transaction.id, { ...mutation(first, first.checklist.items[1].id), expectedUpdatedAt: input.expectedUpdatedAt }, now); check("parentCASpreventschecklistlostupdates", !staleParent.ok && staleParent.reason === "conflict");
  const staleChild = await mutateTransactionChecklist(ctx, first.transaction.id, { ...mutation(first, input.itemId, "reopen"), expectedItemUpdatedAt: input.expectedItemUpdatedAt }, now); check("childCASindependentlyrequired", !staleChild.ok && staleChild.reason === "conflict");
  const wrongChild = await mutateTransactionChecklist(ctx, first.transaction.id, { ...mutation(first, first.checklist.items[1].id), itemId: second.checklist.items[0].id }, now); check("otherfileitemcannotbereboundbyID", !wrongChild.ok && wrongChild.reason === "not_found");
  await db.update(dashboardUsers).set({ role: "member" }).where(eq(dashboardUsers.id, owner.userId));
  const memberWrite = await mutateTransactionChecklist(member, first.transaction.id, mutation(first, first.checklist.items[1].id), now); check("membercannotattestchecklist", !memberWrite.ok && memberWrite.reason === "forbidden");
  await db.update(dashboardUsers).set({ role: "agent" }).where(eq(dashboardUsers.id, owner.userId));
  const stranger = await mutateTransactionChecklist({ actor: other, db }, first.transaction.id, mutation(first, first.checklist.items[1].id), now); check("otheragentcannotlearnormutatechecklist", !stranger.ok && stranger.reason === "not_found");
  const supervised = await mutateTransactionChecklist({ actor: admin, db }, first.transaction.id, mutation(first, first.checklist.items[1].id), now); check("brokerageadministratorkeepsauthorizedsupervision", supervised.ok); first = supervised.value;
  const offer = await changeStage(ctx, first.transaction.id, "offer", now, { requestId: randomUUID(), expectedUpdatedAt: first.updatedAt }); check("completedopportunityallowsenteringoffer", offer.ok); first = await file(first.transaction.id);
  const skipped = await changeStage(ctx, first.transaction.id, "financing", now, { requestId: randomUUID(), expectedUpdatedAt: first.updatedAt }); check("jumpingaheadrequiresallpriorstagechecklists", !skipped.ok && skipped.reason === "checklist_incomplete");
  first = await complete(first, checklistRequiredStages("offer", "financing"));
  const financing = await changeStage(ctx, first.transaction.id, "financing", now, { requestId: randomUUID(), expectedUpdatedAt: first.updatedAt }); check("allrequiredcrossedstagesallowskip", financing.ok); first = await file(first.transaction.id);
  const reopened = await mutateTransactionChecklist(ctx, first.transaction.id, mutation(first, first.checklist.items[0].id, "reopen"), now); check("explicitreopenclearsactorandcompletion", reopened.ok && reopened.value.checklist.items[0].completedAt === null && (await db.select().from(transactionChecklistItems).where(eq(transactionChecklistItems.id, first.checklist.items[0].id)))[0].completedByUserId === null); first = reopened.value;
  const oldStageBlocks = await changeStage(ctx, first.transaction.id, "closing_prep", now, { requestId: randomUUID(), expectedUpdatedAt: first.updatedAt }); check("reopenedearlierstageblocksforwardprogresstoo", !oldStageBlocks.ok && oldStageBlocks.reason === "checklist_incomplete");
  const back = await changeStage(ctx, first.transaction.id, "due_diligence", now, { requestId: randomUUID(), expectedUpdatedAt: first.updatedAt }); check("backwardmoveallowedwithoutpretendingcheckscomplete", back.ok); first = await file(first.transaction.id);
  const pause = await changeStage(ctx, first.transaction.id, "on_hold", now, { requestId: randomUUID(), expectedUpdatedAt: first.updatedAt }); check("pauseallowedwhileincomplete", pause.ok); first = await file(first.transaction.id);
  const resumed = await changeStage(ctx, first.transaction.id, "offer", now, { requestId: randomUUID(), expectedUpdatedAt: first.updatedAt }); check("onholdresumechecksallpriorstages", !resumed.ok && resumed.reason === "checklist_incomplete");
  const resumeStart = await changeStage(ctx, first.transaction.id, "opportunity", now, { requestId: randomUUID(), expectedUpdatedAt: first.updatedAt }); check("onholdcanreturntostartforreview", resumeStart.ok); first = await file(first.transaction.id);
  first = await complete(first, checklistRequiredStages("opportunity", "closing_prep"));
  const prep = await changeStage(ctx, first.transaction.id, "closing_prep", now, { requestId: randomUUID(), expectedUpdatedAt: first.updatedAt }); check("readypriorcheckpointsallowclosingprep", prep.ok); first = await file(first.transaction.id);
  const closeBlocked = await changeStage(ctx, first.transaction.id, "closed", now, { requestId: randomUUID(), expectedUpdatedAt: first.updatedAt }); check("closeexplicitlyrequiresclosingprepitems", !closeBlocked.ok && closeBlocked.reason === "checklist_incomplete");
  first = await complete(first, checklistRequiredStages("closing_prep", "closed"));
  const plan = await planStageChange(ctx, first.transaction.id, "closed", { now, expectedUpdatedAt: first.updatedAt }); check("readycloseplanexists", plan.ok);
  // Deliberately reopen without touching parent: the SQL receipt gate still refuses it.
  await db.update(transactionChecklistItems).set({ completedAt: null, completedByUserId: null }).where(eq(transactionChecklistItems.id, first.checklist.items[11].id));
  await assert.rejects(commitStageChange(db, plan.value.writes)); check("atomicstageguardrechecksafterpreflight", (await file(first.transaction.id)).transaction.stage === "closing_prep");
  first = await file(first.transaction.id); first = await complete(first, ["closing_prep"]);
  const closeInput = { requestId: randomUUID(), expectedUpdatedAt: first.updatedAt }, closed = await changeStage(ctx, first.transaction.id, "closed", now, closeInput); check("fullyreviewedfilecanclose", closed.ok); first = await file(first.transaction.id);
  check("closedsnapshotreadonlyandretained", !first.canEdit && first.checklist.progress.completed === 12 && !(await mutateTransactionChecklist(ctx, first.transaction.id, mutation(first, first.checklist.items[0].id, "reopen"), now)).ok);
  const closedState = await state(); check("stagecommitreceiptstillreplaysafterterminal", (await changeStage(ctx, first.transaction.id, "closed", now, closeInput)).ok && await state() === closedState);
  check("otherfilesneverautocompletedbyprogress", (await file(second.transaction.id)).checklist.progress.completed === 0);
  const cancel = await changeStage(ctx, second.transaction.id, "cancelled", now, { requestId: randomUUID(), expectedUpdatedAt: second.updatedAt }); check("cancellationdoesnotrequirechecklist", cancel.ok && (await file(second.transaction.id)).checklist.progress.completed === 0);
  const missing = await make(); await db.delete(transactionChecklistItems).where(andIdStage(missing.transaction.id, "opportunity"));
  const missingMove = await changeStage(ctx, missing.transaction.id, "offer", now, { requestId: randomUUID(), expectedUpdatedAt: missing.updatedAt }); check("missingstagesnapshotfailsclosedratherthanvacuouslypassing", !missingMove.ok && missingMove.reason === "checklist_not_ready");
  let rollbackFile = await make(), beforeRollback = await state(); db.batch = (async (writes: Parameters<typeof db.batch>[0]) => originalBatch([...writes, db.insert(auditEvents).values({ actorUserId: randomUUID(), eventType: "transaction_updated", safeMetadata: {} })] as unknown as Parameters<typeof db.batch>[0])) as unknown as typeof db.batch;
  const rollback = await mutateTransactionChecklist(ctx, rollbackFile.transaction.id, mutation(rollbackFile, rollbackFile.checklist.items[0].id), now); db.batch = originalBatch; check("historyfailureafterlastwriterollsbackcompletionreceiptandparent", !rollback.ok && await state() === beforeRollback);
  const lateScope = await race(async () => { await db.update(transactions).set({ agentUserId: other.userId }).where(eq(transactions.id, rollbackFile.transaction.id)); }, () => mutateTransactionChecklist(ctx, rollbackFile.transaction.id, mutation(rollbackFile, rollbackFile.checklist.items[0].id), now));
  check("scopewithdrawalinsidebatchneverattestsitem", !lateScope.ok && lateScope.reason === "not_found" && (await db.select().from(transactionChecklistItems).where(eq(transactionChecklistItems.id, rollbackFile.checklist.items[0].id)))[0].completedAt === null);
  await db.update(transactions).set({ agentUserId: owner.userId }).where(eq(transactions.id, rollbackFile.transaction.id));
  const deadlineDone = await mutateTransactionDeadline(ctx, rollbackFile.transaction.id, { action: "complete", requestId: randomUUID(), expectedUpdatedAt: rollbackFile.updatedAt, deadlineId: rollbackFile.deadlines[0].id, expectedDeadlineUpdatedAt: rollbackFile.deadlines[0].updatedAt }, now); check("deadlinecompletionneverchecksoperationalitems", deadlineDone.ok && deadlineDone.value.checklist.progress.completed === 0);
  const audit = await db.select().from(auditEvents), events = await db.select().from(transactionEvents); check("checklistattestationauditusesIDsandactionsonlynotlabels", !/Confirm the|Record the|Private property|Private transaction/.test(JSON.stringify([...audit.map(a => a.safeMetadata), ...events.map(e => e.safeMetadata)])));
  console.log(`${passed}/${passed} transaction checklist checks passed (isolated PostgreSQL; no live access)`);
} finally { db.batch = originalBatch; await pg.close(); }
function andIdStage(id: string, stage: "opportunity") { return and(eq(transactionChecklistItems.transactionId, id), inArray(transactionChecklistItems.stage, [stage])); }
