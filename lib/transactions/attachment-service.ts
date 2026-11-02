import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { auditEvents, dashboardUsers, transactions, transactionChecklistItems, transactionChecklistAttachments, transactionChecklistTemplateSettings, transactionSetupWriteRequests, transactionWriteRequests, transactionEvents, type TransactionRow, type TransactionChecklistItemRow } from "../db/schema.ts";
import { isRecordId } from "../db/ids.ts";
import { createPayloadHash, revisionMatches } from "../contacts/reliability.ts";
import { canSee, canWrite } from "./domain.ts";
import { isTerminalStage } from "./stages.ts";
import { getTransactionWorkspace } from "./workspace-service.ts";
import { visibleTo, transactionWriteLocks, transactionRevisionGuard, transactionWriteReplay, nextTransactionRevision, isTransactionGuardConflict, type TransactionContext, type ServiceResult } from "./service.ts";
import { DEFAULT_TRANSACTION_CHECKLIST } from "./checklist-domain.ts";
import { transactionAttachmentUploadSchema, transactionAttachmentRemoveSchema, transactionAttachmentRequirementSchema, checklistAttachmentDefaultSchema, type ChecklistAttachmentDefaults } from "./attachment-domain.ts";
import { detectTransactionAttachment, normalizeTransactionAttachmentFilename, MAX_TRANSACTION_ATTACHMENT_BYTES } from "./attachment-format.ts";
import type { TransactionFileStorage } from "./transaction-file-storage.ts";
import type { TransactionWorkspace } from "./workspace-domain.ts";

type Batch = Parameters<TransactionContext["db"]["batch"]>[0];
type Write = Batch[number];
type Scope = { row: TransactionRow; item: TransactionChecklistItemRow };
function actorGuard(ctx: TransactionContext) { return sql`exists(select 1 from ${dashboardUsers} where ${dashboardUsers.id}=${ctx.actor.userId}::uuid and ${dashboardUsers.role}=${ctx.actor.role} and ${dashboardUsers.status}='active')`; }
function adminGuard(ctx: TransactionContext) { return sql`exists(select 1 from ${dashboardUsers} where ${dashboardUsers.id}=${ctx.actor.userId}::uuid and ${dashboardUsers.role}='admin' and ${dashboardUsers.status}='active')`; }
async function currentActor(ctx: TransactionContext, admin = false) { const [row] = await ctx.db.select({ id: dashboardUsers.id }).from(dashboardUsers).where(and(eq(dashboardUsers.id, ctx.actor.userId), eq(dashboardUsers.status, "active"), eq(dashboardUsers.role, admin ? "admin" : ctx.actor.role))).limit(1); return Boolean(row); }
async function load(ctx: TransactionContext, id: string, itemId?: string, write = false): Promise<ServiceResult<{ row: TransactionRow; item?: TransactionChecklistItemRow }>> {
  if (!isRecordId(id) || itemId !== undefined && !isRecordId(itemId)) return { ok: false, reason: "not_found" };
  const [row] = await ctx.db.select().from(transactions).where(and(eq(transactions.id, id), visibleTo(ctx.actor), actorGuard(ctx))).limit(1);
  if (!row || !canSee(ctx.actor, row)) return { ok: false, reason: "not_found" };
  if (write && !canWrite(ctx.actor, row)) return { ok: false, reason: "forbidden" };
  if (write && isTerminalStage(row.stage)) return { ok: false, reason: "invalid_transition" };
  if (!itemId) return { ok: true, value: { row } };
  const [item] = await ctx.db.select().from(transactionChecklistItems).where(and(eq(transactionChecklistItems.id, itemId), eq(transactionChecklistItems.transactionId, id))).limit(1);
  return item ? { ok: true, value: { row, item } } : { ok: false, reason: "not_found" };
}
async function scopeFor(ctx: TransactionContext, id: string, itemId: string): Promise<ServiceResult<Scope>> { const result = await load(ctx, id, itemId, true); return result.ok ? { ok: true, value: { row: result.value.row, item: result.value.item! } } : result; }
function itemGuard(item: TransactionChecklistItemRow, expected: string) { return and(eq(transactionChecklistItems.id, item.id), eq(transactionChecklistItems.transactionId, item.transactionId), sql`date_trunc('milliseconds',${transactionChecklistItems.updatedAt})=${expected}::timestamptz`, eq(transactionChecklistItems.attachmentRequired, item.attachmentRequired), sql`date_trunc('milliseconds',${transactionChecklistItems.completedAt}) is not distinct from ${item.completedAt?.toISOString() ?? null}::timestamptz`); }
function itemLocks(ctx: TransactionContext, id: string): Write { return ctx.db.select({ id: transactionChecklistItems.id }).from(transactionChecklistItems).where(eq(transactionChecklistItems.transactionId, id)).orderBy(transactionChecklistItems.id).for("update"); }
function attachmentLocks(ctx: TransactionContext, id: string): Write { return ctx.db.select({ id: transactionChecklistAttachments.id }).from(transactionChecklistAttachments).where(eq(transactionChecklistAttachments.transactionId, id)).orderBy(transactionChecklistAttachments.id).for("update"); }
function activeAttachments(id: string, itemId: string) { return and(eq(transactionChecklistAttachments.transactionId, id), eq(transactionChecklistAttachments.checklistItemId, itemId), isNull(transactionChecklistAttachments.removedAt)); }
function activeCountSql(id: string, itemId: string) { return sql`(select count(*) from ${transactionChecklistAttachments} where ${activeAttachments(id, itemId)})`; }
function history(ctx: TransactionContext, id: string, itemId: string, action: string, now: Date, attachmentId?: string): Write[] { const safe = { action, fields: action === "set_attachment_requirement" ? ["attachmentRequired"] : ["attachments"], checklistItemId: itemId, ...(attachmentId ? { attachmentId } : {}) };
  return [ctx.db.insert(transactionEvents).values({ transactionId: id, actorUserId: ctx.actor.userId, eventType: "transaction_updated", safeMetadata: safe, createdAt: now }), ctx.db.insert(auditEvents).values({ actorUserId: ctx.actor.userId, eventType: "transaction_updated", safeMetadata: { transactionId: id, ...safe }, createdAt: now })]; }
function touch(ctx: TransactionContext, scope: Scope, expected: string, next: Date): Write[] { return [ctx.db.update(transactions).set({ updatedAt: next, updatedByUserId: ctx.actor.userId }).where(transactionRevisionGuard(ctx, scope.row, expected)), ctx.db.update(transactionChecklistItems).set({ updatedAt: sql`greatest(date_trunc('milliseconds',${transactionChecklistItems.updatedAt})+interval '1 millisecond',${next.toISOString()}::timestamptz)` }).where(eq(transactionChecklistItems.id, scope.item.id))]; }
async function replay(ctx: TransactionContext, requestId: string, hash: string, action: string, now: Date): Promise<ServiceResult<TransactionWorkspace> | null> { if (!await currentActor(ctx)) return { ok: false, reason: "forbidden" }; const result = await transactionWriteReplay(ctx, requestId, hash, action, now); return result ? result.ok ? getTransactionWorkspace(ctx, result.value.id, {}, now) : result : null; }
function knownRollback(error: unknown): boolean { let value = error; for (let i = 0; value && typeof value === "object" && i < 8; i++) { const v = value as { code?: string; cause?: unknown }; if (v.code && /^(?:23|40)/.test(v.code)) return true; value = v.cause; } return false; }
/** Only a confirmed PostgreSQL rollback plus absent metadata can authorize orphan cleanup. */
async function cleanupOrphan(ctx: TransactionContext, path: string, attachmentId: string, storage: TransactionFileStorage, error: unknown): Promise<void> {
  if (!knownRollback(error)) return;
  try { const [metadata] = await ctx.db.select({ id: transactionChecklistAttachments.id }).from(transactionChecklistAttachments).where(eq(transactionChecklistAttachments.storagePath, path)).limit(1); if (metadata) return;
    const [receipt] = await ctx.db.select({ requestId: transactionWriteRequests.requestId }).from(transactionWriteRequests).where(sql`${transactionWriteRequests.result}->>'attachmentId'=${attachmentId}`).limit(1); if (receipt) return;
    await storage.removeOrphan(path);
  } catch { /* Unknown storage/database outcomes remain retained rather than risking committed bytes. */ }
}
export async function uploadTransactionChecklistAttachment(ctx: TransactionContext, id: string, itemId: string, input: unknown, file: { name: string; bytes: Uint8Array }, storage: TransactionFileStorage, now = new Date()): Promise<ServiceResult<TransactionWorkspace>> {
  const parsed = transactionAttachmentUploadSchema.safeParse(input); if (!parsed.success || parsed.data.itemId !== itemId) return { ok: false, reason: "invalid_attachment" };
  const d = parsed.data; if (file.bytes.length > MAX_TRANSACTION_ATTACHMENT_BYTES) return { ok: false, reason: "file_too_large" };
  const format = detectTransactionAttachment(file.bytes); if (!format) return { ok: false, reason: "invalid_attachment" };
  const filename = normalizeTransactionAttachmentFilename(file.name, format.extension), sha256 = createHash("sha256").update(file.bytes).digest("hex"), hash = createPayloadHash({ id, ...d, filename, contentType: format.contentType, sizeBytes: file.bytes.length, sha256 });
  const previous = await replay(ctx, d.requestId, hash, "upload_attachment", now); if (previous) return previous;
  const loaded = await scopeFor(ctx, id, itemId); if (!loaded.ok) return loaded; const scope = loaded.value;
  if (!revisionMatches(scope.row.updatedAt, d.expectedUpdatedAt) || !revisionMatches(scope.item.updatedAt, d.expectedItemUpdatedAt)) return { ok: false, reason: "conflict" };
  const [count] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(transactionChecklistAttachments).where(activeAttachments(id, itemId)); if (count.n >= 10) return { ok: false, reason: "attachment_limit" };
  if (!storage.enabled) return { ok: false, reason: "attachment_not_configured" };
  const attachmentId = randomUUID(), path = `transaction-files/${id}/${randomUUID()}.${format.extension}`, result = await storage.put(path, file.bytes, format.contentType);
  if (!result.ok) return { ok: false, reason: result.reason === "not_configured" ? "attachment_not_configured" : "attachment_unavailable" };
  const next = nextTransactionRevision(scope.row, now), guard = sql`${actorGuard(ctx)} and exists(select 1 from ${transactions} where ${transactionRevisionGuard(ctx, scope.row, d.expectedUpdatedAt)}) and exists(select 1 from ${transactionChecklistItems} where ${itemGuard(scope.item, d.expectedItemUpdatedAt)}) and ${activeCountSql(id, itemId)}<10`;
  const writes: Write[] = [...transactionWriteLocks(ctx, id), itemLocks(ctx, id), attachmentLocks(ctx, id), ctx.db.insert(transactionWriteRequests).values({ actorUserId: ctx.actor.userId, requestId: d.requestId, transactionId: id, action: "upload_attachment", payloadHash: sql`case when ${guard} then ${hash}::text else null end`, result: { transactionId: id, updatedAt: next.toISOString(), attachmentId }, createdAt: now }),
    ctx.db.insert(transactionChecklistAttachments).values({ id: attachmentId, transactionId: id, checklistItemId: itemId, storagePath: path, filename, contentType: format.contentType, sizeBytes: file.bytes.length, sha256, uploadedByUserId: ctx.actor.userId, createdAt: now, updatedAt: now }), ...touch(ctx, scope, d.expectedUpdatedAt, next), ...history(ctx, id, itemId, "upload_attachment", now, attachmentId)];
  try { await ctx.db.batch(writes as unknown as Batch); }
  catch (error) { await cleanupOrphan(ctx, path, attachmentId, storage, error); const recovered = await replay(ctx, d.requestId, hash, "upload_attachment", now); if (recovered) return recovered; const current = await scopeFor(ctx, id, itemId); if (!current.ok) return current; return { ok: false, reason: isTransactionGuardConflict(error) ? "conflict" : "unavailable" }; }
  return getTransactionWorkspace(ctx, id, {}, now);
}
export async function removeTransactionChecklistAttachment(ctx: TransactionContext, id: string, attachmentId: string, input: unknown, now = new Date()): Promise<ServiceResult<TransactionWorkspace>> {
  if (!isRecordId(attachmentId)) return { ok: false, reason: "not_found" };
  const parsed = transactionAttachmentRemoveSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_attachment" };
  const d = parsed.data, hash = createPayloadHash({ id, attachmentId, ...d }), previous = await replay(ctx, d.requestId, hash, "remove_attachment", now); if (previous) return previous;
  const loaded = await scopeFor(ctx, id, d.itemId); if (!loaded.ok) return loaded; const scope = loaded.value;
  if (!revisionMatches(scope.row.updatedAt, d.expectedUpdatedAt) || !revisionMatches(scope.item.updatedAt, d.expectedItemUpdatedAt)) return { ok: false, reason: "conflict" };
  const [attachment] = await ctx.db.select().from(transactionChecklistAttachments).where(and(eq(transactionChecklistAttachments.id, attachmentId), activeAttachments(id, d.itemId))).limit(1); if (!attachment) return { ok: false, reason: "not_found" };
  if (!revisionMatches(attachment.updatedAt, d.expectedAttachmentUpdatedAt)) return { ok: false, reason: "conflict" };
  if (scope.item.attachmentRequired && scope.item.completedAt) return { ok: false, reason: "attachment_requires_reopen" };
  const next = nextTransactionRevision(scope.row, now), child = and(eq(transactionChecklistAttachments.id, attachmentId), activeAttachments(id, d.itemId), sql`date_trunc('milliseconds',${transactionChecklistAttachments.updatedAt})=${d.expectedAttachmentUpdatedAt}::timestamptz`);
  const guard = sql`${actorGuard(ctx)} and exists(select 1 from ${transactions} where ${transactionRevisionGuard(ctx, scope.row, d.expectedUpdatedAt)}) and exists(select 1 from ${transactionChecklistItems} where ${itemGuard(scope.item, d.expectedItemUpdatedAt)} and (not ${transactionChecklistItems.attachmentRequired} or ${transactionChecklistItems.completedAt} is null)) and exists(select 1 from ${transactionChecklistAttachments} where ${child})`;
  const writes: Write[] = [...transactionWriteLocks(ctx, id), itemLocks(ctx, id), attachmentLocks(ctx, id), ctx.db.insert(transactionWriteRequests).values({ actorUserId: ctx.actor.userId, requestId: d.requestId, transactionId: id, action: "remove_attachment", payloadHash: sql`case when ${guard} then ${hash}::text else null end`, result: { transactionId: id, updatedAt: next.toISOString(), attachmentId }, createdAt: now }),
    ctx.db.update(transactionChecklistAttachments).set({ removedAt: now, updatedAt: sql`greatest(date_trunc('milliseconds',${transactionChecklistAttachments.updatedAt})+interval '1 millisecond',${next.toISOString()}::timestamptz)` }).where(child), ...touch(ctx, scope, d.expectedUpdatedAt, next), ...history(ctx, id, d.itemId, "remove_attachment", now, attachmentId)];
  try { await ctx.db.batch(writes as unknown as Batch); } catch (error) { const recovered = await replay(ctx, d.requestId, hash, "remove_attachment", now); if (recovered) return recovered; const current = await scopeFor(ctx, id, d.itemId); if (!current.ok) return current; return { ok: false, reason: isTransactionGuardConflict(error) ? "conflict" : "unavailable" }; }
  return getTransactionWorkspace(ctx, id, {}, now);
}
export async function getTransactionChecklistAttachment(ctx: TransactionContext, id: string, attachmentId: string, storage: TransactionFileStorage): Promise<ServiceResult<{ stream: ReadableStream<Uint8Array>; filename: string; contentType: string; sizeBytes: number }>> {
  if (!isRecordId(attachmentId)) return { ok: false, reason: "not_found" };
  const loaded = await load(ctx, id); if (!loaded.ok) return loaded;
  const [attachment] = await ctx.db.select().from(transactionChecklistAttachments).where(and(eq(transactionChecklistAttachments.id, attachmentId), eq(transactionChecklistAttachments.transactionId, id), isNull(transactionChecklistAttachments.removedAt))).limit(1); if (!attachment) return { ok: false, reason: "not_found" };
  const item = await load(ctx, id, attachment.checklistItemId); if (!item.ok) return item;
  const result = await storage.get(attachment.storagePath); if (!result.ok) return { ok: false, reason: result.reason === "not_configured" ? "attachment_not_configured" : "attachment_unavailable" };
  const current = await load(ctx, id, attachment.checklistItemId), [stillActive] = current.ok ? await ctx.db.select({ id: transactionChecklistAttachments.id }).from(transactionChecklistAttachments).where(and(eq(transactionChecklistAttachments.id, attachmentId), activeAttachments(id, attachment.checklistItemId), eq(transactionChecklistAttachments.storagePath, attachment.storagePath), sql`date_trunc('milliseconds',${transactionChecklistAttachments.updatedAt})=${attachment.updatedAt.toISOString()}::timestamptz`)).limit(1) : [];
  if (!current.ok || !stillActive || result.sizeBytes !== attachment.sizeBytes) { await result.stream.cancel(); return !current.ok ? current : { ok: false, reason: stillActive ? "attachment_unavailable" : "not_found" }; }
  return { ok: true, value: { stream: result.stream, filename: attachment.filename, contentType: attachment.contentType, sizeBytes: attachment.sizeBytes } };
}
export async function setTransactionAttachmentRequirement(ctx: TransactionContext, id: string, input: unknown, now = new Date()): Promise<ServiceResult<TransactionWorkspace>> {
  if (ctx.actor.role !== "admin") return { ok: false, reason: "forbidden" };
  if (!await currentActor(ctx, true)) return { ok: false, reason: "forbidden" };
  const parsed = transactionAttachmentRequirementSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_attachment" };
  const d = parsed.data, hash = createPayloadHash({ id, ...d }), previous = await replay(ctx, d.requestId, hash, "set_attachment_requirement", now); if (previous) return previous;
  const loaded = await scopeFor(ctx, id, d.itemId); if (!loaded.ok) return loaded; const scope = loaded.value;
  if (!revisionMatches(scope.row.updatedAt, d.expectedUpdatedAt) || !revisionMatches(scope.item.updatedAt, d.expectedItemUpdatedAt)) return { ok: false, reason: "conflict" };
  if (d.attachmentRequired && scope.item.completedAt) { const [proof] = await ctx.db.select({ id: transactionChecklistAttachments.id }).from(transactionChecklistAttachments).where(activeAttachments(id, d.itemId)).limit(1); if (!proof) return { ok: false, reason: "attachment_requires_reopen" }; }
  const next = nextTransactionRevision(scope.row, now), guard = sql`${adminGuard(ctx)} and exists(select 1 from ${transactions} where ${transactionRevisionGuard(ctx, scope.row, d.expectedUpdatedAt)}) and exists(select 1 from ${transactionChecklistItems} where ${itemGuard(scope.item, d.expectedItemUpdatedAt)} and (${!d.attachmentRequired} or ${transactionChecklistItems.completedAt} is null or ${activeCountSql(id, d.itemId)}>0))`;
  const writes: Write[] = [...transactionWriteLocks(ctx, id), itemLocks(ctx, id), attachmentLocks(ctx, id), ctx.db.insert(transactionWriteRequests).values({ actorUserId: ctx.actor.userId, requestId: d.requestId, transactionId: id, action: "set_attachment_requirement", payloadHash: sql`case when ${guard} then ${hash}::text else null end`, result: { transactionId: id, updatedAt: next.toISOString() }, createdAt: now }), ...touch(ctx, scope, d.expectedUpdatedAt, next),
    ctx.db.update(transactionChecklistItems).set({ attachmentRequired: d.attachmentRequired }).where(eq(transactionChecklistItems.id, d.itemId)), ...history(ctx, id, d.itemId, "set_attachment_requirement", now)];
  try { await ctx.db.batch(writes as unknown as Batch); } catch (error) { const recovered = await replay(ctx, d.requestId, hash, "set_attachment_requirement", now); if (recovered) return recovered; const current = await scopeFor(ctx, id, d.itemId); if (!current.ok) return current; return { ok: false, reason: isTransactionGuardConflict(error) ? "conflict" : "unavailable" }; }
  return getTransactionWorkspace(ctx, id, {}, now);
}
export async function getChecklistAttachmentDefaults(ctx: TransactionContext): Promise<ServiceResult<ChecklistAttachmentDefaults>> {
  const rows = await ctx.db.select().from(transactionChecklistTemplateSettings).where(eq(transactionChecklistTemplateSettings.brokerageKey, ctx.actor.brokerageKey));
  const byKey = new Map(rows.map(row => [row.templateKey, row]));
  return { ok: true, value: { items: DEFAULT_TRANSACTION_CHECKLIST.map(item => ({ templateKey: item.templateKey, label: item.label, stage: item.stage, attachmentRequired: byKey.get(item.templateKey)?.attachmentRequired ?? false, updatedAt: byKey.get(item.templateKey)?.updatedAt.toISOString() ?? null })), canManage: ctx.actor.role === "admin" } };
}
export async function updateChecklistAttachmentDefault(ctx: TransactionContext, input: unknown, now = new Date()): Promise<ServiceResult<ChecklistAttachmentDefaults>> {
  if (ctx.actor.role !== "admin") return { ok: false, reason: "forbidden" };
  if (!await currentActor(ctx, true)) return { ok: false, reason: "forbidden" };
  const parsed = checklistAttachmentDefaultSchema.safeParse(input); if (!parsed.success || !DEFAULT_TRANSACTION_CHECKLIST.some(item => item.templateKey === parsed.data.templateKey)) return { ok: false, reason: "invalid_attachment" };
  const d = parsed.data, hash = createPayloadHash({ ...d }), receiptWhere = and(eq(transactionSetupWriteRequests.actorUserId, ctx.actor.userId), eq(transactionSetupWriteRequests.requestId, d.requestId));
  const replayDefault = async (): Promise<ServiceResult<ChecklistAttachmentDefaults> | null> => { const [receipt] = await ctx.db.select().from(transactionSetupWriteRequests).where(receiptWhere).limit(1); if (!receipt) return null; if (receipt.brokerageKey !== ctx.actor.brokerageKey) return { ok: false, reason: "not_found" }; return receipt.payloadHash === hash ? getChecklistAttachmentDefaults(ctx) : { ok: false, reason: "request_conflict" }; };
  const previous = await replayDefault(); if (previous) return previous;
  const where = and(eq(transactionChecklistTemplateSettings.brokerageKey, ctx.actor.brokerageKey), eq(transactionChecklistTemplateSettings.templateKey, d.templateKey)), [current] = await ctx.db.select().from(transactionChecklistTemplateSettings).where(where).limit(1);
  if (current ? !d.expectedUpdatedAt || !revisionMatches(current.updatedAt, d.expectedUpdatedAt) : d.expectedUpdatedAt !== null) return { ok: false, reason: "conflict" };
  const next = new Date(Math.max(current ? current.updatedAt.getTime() + 1 : 0, now.getTime()));
  const changed = ctx.db.$with("checklist_default_changed").as(d.expectedUpdatedAt === null ? ctx.db.insert(transactionChecklistTemplateSettings).select(ctx.db.select({ brokerageKey: sql<string>`${ctx.actor.brokerageKey}::text`.as("brokerage_key"), templateKey: sql<string>`${d.templateKey}::text`.as("template_key"), attachmentRequired: sql<boolean>`${d.attachmentRequired}::boolean`.as("attachment_required"), updatedByUserId: sql<string>`${ctx.actor.userId}::uuid`.as("updated_by_user_id"), updatedAt: sql<Date>`${next.toISOString()}::timestamptz`.as("updated_at") }).from(sql`(select 1) as setting_creation`).where(adminGuard(ctx))).onConflictDoNothing().returning({ templateKey: transactionChecklistTemplateSettings.templateKey })
    : ctx.db.update(transactionChecklistTemplateSettings).set({ attachmentRequired: d.attachmentRequired, updatedByUserId: ctx.actor.userId, updatedAt: next }).where(and(where, adminGuard(ctx), sql`date_trunc('milliseconds',${transactionChecklistTemplateSettings.updatedAt})=${d.expectedUpdatedAt}::timestamptz`)).returning({ templateKey: transactionChecklistTemplateSettings.templateKey }));
  const receipt = ctx.db.$with("checklist_default_receipt").as(ctx.db.insert(transactionSetupWriteRequests).select(ctx.db.select({ actorUserId: sql<string>`${ctx.actor.userId}::uuid`.as("actor_user_id"), requestId: sql<string>`${d.requestId}::uuid`.as("request_id"), brokerageKey: sql<string>`${ctx.actor.brokerageKey}::text`.as("brokerage_key"), action: sql<string>`'checklist_default'::text`.as("action"), payloadHash: sql<string>`${hash}::text`.as("payload_hash"), result: sql<{ templateKey: string; updatedAt: string }>`jsonb_build_object('templateKey',${d.templateKey}::text,'updatedAt',${next.toISOString()}::text)`.as("result"), createdAt: sql<Date>`${now.toISOString()}::timestamptz`.as("created_at") }).from(changed)).returning({ requestId: transactionSetupWriteRequests.requestId }));
  try { await ctx.db.batch([ctx.db.select({ id: dashboardUsers.id }).from(dashboardUsers).where(eq(dashboardUsers.id, ctx.actor.userId)).for("no key update"), ctx.db.select({ templateKey: transactionChecklistTemplateSettings.templateKey }).from(transactionChecklistTemplateSettings).where(where).for("update"),
    ctx.db.with(changed, receipt).insert(auditEvents).select(ctx.db.select({ id: sql<string>`${randomUUID()}::uuid`.as("id"), actorUserId: sql<string>`${ctx.actor.userId}::uuid`.as("actor_user_id"), targetUserId: sql<null>`null::uuid`.as("target_user_id"), eventType: sql<string>`'transaction_updated'::text`.as("event_type"), safeMetadata: sql<Record<string, unknown>>`jsonb_build_object('action','checklist_default','templateKey',${d.templateKey}::text,'fields',jsonb_build_array('attachmentRequired'))`.as("safe_metadata"), createdAt: sql<Date>`${now.toISOString()}::timestamptz`.as("created_at") }).from(receipt))] as unknown as Batch); }
  catch { if (!await currentActor(ctx, true)) return { ok: false, reason: "forbidden" }; return await replayDefault() ?? { ok: false, reason: "unavailable" }; }
  if (!await currentActor(ctx, true)) return { ok: false, reason: "forbidden" };
  return await replayDefault() ?? { ok: false, reason: "conflict" };
}
