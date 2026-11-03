import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { auditEvents, contacts, transactionDeadlines, transactionEvents, transactionParties, transactionWriteRequests, transactionChecklistItems, transactionChecklistAttachments, transactions, type TransactionDeadlineRow, type TransactionRow } from "../db/schema.ts";
import { isRecordId } from "../db/ids.ts";
import { visibleTo as visibleContacts } from "../contacts/visibility.ts";
import { createPayloadHash, revisionMatches } from "../contacts/reliability.ts";
import { canSee, canWrite } from "./domain.ts";
import { transactionDeadlineState } from "./calendar-days.ts";
import { ALL_STAGES, isTerminalStage } from "./stages.ts";
import { getTransaction, visibleTo, transactionRevisionGuard, transactionWriteLocks, nextTransactionRevision, transactionWriteReplay, isTransactionGuardConflict, type TransactionContext, type ServiceResult } from "./service.ts";
import { updateTransactionWorkspaceSchema, transactionDeadlineMutationSchema, type TransactionDetails, type TransactionWorkspace, type TransactionHistoryView } from "./workspace-domain.ts";
import { transactionChecklistMutationSchema, checklistProgress, type TransactionChecklistItem } from "./checklist-domain.ts";
import { transactionFilesEnabled } from "./transaction-file-storage.ts";
import { readTransactionVendorSelections } from "./vendor-service.ts";
import { DEFAULT_VENDOR_DETAIL_FIELDS } from "./vendor-detail-domain.ts";

type Write = Parameters<TransactionContext["db"]["batch"]>[0][number];
type Batch = Parameters<TransactionContext["db"]["batch"]>[0];
async function load(ctx: TransactionContext, id: string, write = false): Promise<ServiceResult<TransactionRow>> {
  if (!isRecordId(id)) return { ok: false, reason: "not_found" };
  const [row] = await ctx.db.select().from(transactions).where(and(eq(transactions.id, id), visibleTo(ctx.actor))).limit(1);
  if (!row || !canSee(ctx.actor, row)) return { ok: false, reason: "not_found" };
  if (write && !canWrite(ctx.actor, row)) return { ok: false, reason: "forbidden" };
  if (write && row.side === "gc") return { ok: false, reason: "gc_not_configured" };
  if (write && isTerminalStage(row.stage)) return { ok: false, reason: "invalid_transition" };
  return { ok: true, value: row };
}
function details(row: TransactionRow): TransactionDetails { return { transactionType: row.transactionType, addressLine1: row.addressLine1, addressLine2: row.addressLine2, city: row.city, state: row.state, postalCode: row.postalCode, listingKey: row.listingKey, mlsNumber: row.mlsNumber,
  contractPriceCents: row.contractPriceCents, listPriceCents: row.listPriceCents, commissionRateBps: row.commissionRateBps, commissionFlatCents: row.commissionFlatCents, agentSplitBps: row.agentSplitBps, transactionFeeCents: row.transactionFeeCents, referralFeeBps: row.referralFeeBps,
  contractExecutionDate: row.contractExecutionDate, closingDate: row.closingDate, notes: row.notes ?? "" }; }
const SAFE_FIELDS = ["transactionType", "addressLine1", "addressLine2", "city", "state", "postalCode", "county", "listingKey", "mlsNumber", "listingDataset", "listingLinkedAt", "tourId", "contractPriceCents", "listPriceCents", "commissionRateBps", "commissionFlatCents", "agentSplitBps", "transactionFeeCents", "referralFeeBps", "contractExecutionDate", "closingDate", "notes", "kind", "label", "dueDate", "note", "completedAt", "removedAt", "attachments", "attachmentRequired", "vendorId", "vendorStatus", "vendorDetails", "vendorAttachments", ...Object.keys(DEFAULT_VENDOR_DETAIL_FIELDS)];
const SAFE_ACTIONS = ["create", "edit", "stage", "add_deadline", "edit_deadline", "complete_deadline", "reopen_deadline", "remove_deadline", "complete_checklist", "reopen_checklist", "upload_attachment", "remove_attachment", "set_attachment_requirement", "set_vendor", "edit_vendor_details", "upload_vendor_attachment", "remove_vendor_attachment", "link_property", "unlink_property", "link_tour", "unlink_tour"];
export async function getTransactionWorkspace(ctx: TransactionContext, id: string, options: { historyPage?: number } = {}, now = new Date()): Promise<ServiceResult<TransactionWorkspace>> {
  const loaded = await load(ctx, id); if (!loaded.ok) return loaded; const row = loaded.value;
  const historyPage = options.historyPage ?? 1; if (!Number.isInteger(historyPage) || historyPage < 1 || historyPage > 1000000) return { ok: false, reason: "invalid_transaction" };
  const [transaction, deadlines, checklistRows, attachmentRows, parties, vendors, [count]] = await Promise.all([getTransaction(ctx, id, now),
    ctx.db.select().from(transactionDeadlines).where(and(eq(transactionDeadlines.transactionId, id), isNull(transactionDeadlines.removedAt))).orderBy(transactionDeadlines.sortOrder, transactionDeadlines.dueDate, transactionDeadlines.id),
    ctx.db.select().from(transactionChecklistItems).where(eq(transactionChecklistItems.transactionId, id)).orderBy(transactionChecklistItems.sortOrder, transactionChecklistItems.id),
    ctx.db.select({ id: transactionChecklistAttachments.id, itemId: transactionChecklistAttachments.checklistItemId, filename: transactionChecklistAttachments.filename, contentType: transactionChecklistAttachments.contentType, sizeBytes: transactionChecklistAttachments.sizeBytes, createdAt: transactionChecklistAttachments.createdAt, updatedAt: transactionChecklistAttachments.updatedAt }).from(transactionChecklistAttachments).where(and(eq(transactionChecklistAttachments.transactionId, id), isNull(transactionChecklistAttachments.removedAt))).orderBy(transactionChecklistAttachments.createdAt, transactionChecklistAttachments.id),
    ctx.db.select().from(transactionParties).where(eq(transactionParties.transactionId, id)).orderBy(transactionParties.createdAt, transactionParties.id),
    readTransactionVendorSelections(ctx, id),
    ctx.db.select({ n: sql<number>`count(*)::int` }).from(transactionEvents).where(eq(transactionEvents.transactionId, id)),
  ]);
  if (!transaction) return { ok: false, reason: "not_found" };
  const total = count?.n ?? 0, page = Math.min(historyPage, Math.max(1, Math.ceil(total / 20)));
  const events = await ctx.db.select().from(transactionEvents).where(eq(transactionEvents.transactionId, id)).orderBy(desc(transactionEvents.createdAt), desc(transactionEvents.id)).limit(20).offset((page - 1) * 20);
  const ids = [...new Set(parties.flatMap(p => p.contactId ? [p.contactId] : []))], allowedContacts = ids.length ? await ctx.db.select({ id: contacts.id }).from(contacts).where(and(inArray(contacts.id, ids), visibleContacts(ctx.actor))) : [];
  const canOpen = new Set(allowedContacts.map(c => c.id));
  const checklistItems: TransactionChecklistItem[] = checklistRows.map(item => ({ id: item.id, templateKey: item.templateKey, label: item.label, stage: item.stage as TransactionChecklistItem["stage"], required: item.required, attachmentRequired: item.attachmentRequired, attachments: attachmentRows.filter(a => a.itemId === item.id).map(a => ({ ...a, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString() })), sortOrder: item.sortOrder, completedAt: item.completedAt?.toISOString() ?? null, updatedAt: item.updatedAt.toISOString() }));
  const history: TransactionHistoryView[] = events.map(event => { const meta = event.safeMetadata ?? {}, action = typeof meta.action === "string" && SAFE_ACTIONS.includes(meta.action) ? meta.action : event.eventType === "transaction_created" ? "create" : event.eventType === "transaction_stage_changed" ? "stage" : "edit";
    return { id: event.id, eventType: event.eventType, action, fields: Array.isArray(meta.fields) ? meta.fields.filter((field): field is string => typeof field === "string" && SAFE_FIELDS.includes(field)) : [],
      ...(typeof meta.from === "string" && ALL_STAGES.includes(meta.from as never) ? { fromStage: meta.from } : {}), ...(typeof meta.to === "string" && ALL_STAGES.includes(meta.to as never) ? { toStage: meta.to } : {}), createdAt: event.createdAt.toISOString() }; });
  // A fresh parent scope/revision check keeps this multi-query file internally consistent.
  const current = await load(ctx, id); if (!current.ok) return current; if (!revisionMatches(current.value.updatedAt, row.updatedAt.toISOString())) return { ok: false, reason: "conflict" };
  return { ok: true, value: { transaction, details: details(row), deadlines: deadlines.map(d => ({ id: d.id, kind: d.kind, label: d.label, dueDate: d.dueDate, note: d.note ?? "", completedAt: d.completedAt?.toISOString() ?? null, updatedAt: d.updatedAt.toISOString(), state: transactionDeadlineState(d.dueDate, d.completedAt, now) })),
    parties: parties.map(p => ({ id: p.id, role: p.role, displayName: p.displayName, company: p.company, email: p.email, phone: p.phoneE164, isPrimary: p.isPrimary, contactId: p.contactId && canOpen.has(p.contactId) ? p.contactId : null, canOpenContact: Boolean(p.contactId && canOpen.has(p.contactId)) })),
    checklist: { templateVersion: row.checklistTemplateVersion, items: checklistItems, progress: checklistProgress(checklistItems) }, attachmentUploadsEnabled: row.side !== "gc" && transactionFilesEnabled(), canManageTransactionSetup: row.side !== "gc" && ctx.actor.role === "admin", vendors, history: { items: history, total, page, pageSize: 20 }, canEdit: row.side !== "gc" && canWrite(ctx.actor, row) && !isTerminalStage(row.stage), updatedAt: row.updatedAt.toISOString() } };
}
function deadlineGuard(rows: TransactionDeadlineRow[], id: string) {
  return sql`(select count(*) from ${transactionDeadlines} where ${transactionDeadlines.transactionId}=${id}::uuid and ${transactionDeadlines.removedAt} is null)=${rows.length}
    ${rows.length ? sql`and ${sql.join(rows.map(d => sql`exists(select 1 from ${transactionDeadlines} where ${transactionDeadlines.id}=${d.id}::uuid and ${transactionDeadlines.transactionId}=${id}::uuid and ${transactionDeadlines.removedAt} is null and ${transactionDeadlines.kind}=${d.kind} and ${transactionDeadlines.dueDate}=${d.dueDate}::date and date_trunc('milliseconds',${transactionDeadlines.completedAt}) is not distinct from ${d.completedAt?.toISOString() ?? null}::timestamptz and date_trunc('milliseconds',${transactionDeadlines.updatedAt})=${d.updatedAt.toISOString()}::timestamptz)`), sql` and `)}` : sql``}`;
}
function historyWrites(ctx: TransactionContext, id: string, action: string, fields: string[], now: Date, deadlineId?: string, checklistItemId?: string): Write[] {
  const safe = { action, fields, ...(deadlineId ? { deadlineId } : {}), ...(checklistItemId ? { checklistItemId } : {}) };
  return [ctx.db.insert(transactionEvents).values({ transactionId: id, actorUserId: ctx.actor.userId, eventType: "transaction_updated", safeMetadata: safe, createdAt: now }), ctx.db.insert(auditEvents).values({ eventType: "transaction_updated", actorUserId: ctx.actor.userId, safeMetadata: { transactionId: id, ...safe }, createdAt: now })];
}
function childLocks(ctx: TransactionContext, id: string): Write { return ctx.db.select({ id: transactionDeadlines.id }).from(transactionDeadlines).where(eq(transactionDeadlines.transactionId, id)).orderBy(transactionDeadlines.id).for("update"); }
function childRevision(next: Date) { return sql`greatest(date_trunc('milliseconds',${transactionDeadlines.updatedAt})+interval '1 millisecond',${next.toISOString()}::timestamptz)`; }
async function replayWorkspace(ctx: TransactionContext, requestId: string, hash: string, action: string, now: Date): Promise<ServiceResult<TransactionWorkspace> | null> {
  const replay = await transactionWriteReplay(ctx, requestId, hash, action, now); return replay ? replay.ok ? getTransactionWorkspace(ctx, replay.value.id, {}, now) : replay : null;
}
async function recover(ctx: TransactionContext, id: string, requestId: string, hash: string, action: string, error: unknown, now: Date): Promise<ServiceResult<TransactionWorkspace>> {
  const replay = await replayWorkspace(ctx, requestId, hash, action, now); if (replay) return replay;
  const latest = await load(ctx, id, true); if (!latest.ok) return latest;
  return { ok: false, reason: isTransactionGuardConflict(error) ? "conflict" : "unavailable" };
}
/** A Closing milestone is entered evidence; a completed one is never silently rescheduled. */
function closingMetadataWrites(ctx: TransactionContext, row: TransactionRow, rows: TransactionDeadlineRow[], day: string | null, next: Date): ServiceResult<Write[]> {
  if (day === row.closingDate) return { ok: true, value: [] };
  const closing = rows.filter(d => d.kind === "closing"); if (closing.length > 1) return { ok: false, reason: "closing_deadline_conflict" };
  const current = closing[0];
  if (current?.completedAt && current.dueDate !== day) return { ok: false, reason: "closing_deadline_conflict" };
  if (current) return { ok: true, value: [ctx.db.update(transactionDeadlines).set(day ? { dueDate: day, updatedAt: childRevision(next) } : { removedAt: next, updatedAt: childRevision(next) }).where(eq(transactionDeadlines.id, current.id))] };
  return { ok: true, value: day ? [ctx.db.insert(transactionDeadlines).values({ transactionId: row.id, kind: "closing", label: "Closing", dueDate: day, sortOrder: rows.reduce((max, d) => Math.max(max, d.sortOrder + 1), 0), createdAt: next, updatedAt: next })] : [] };
}
export async function updateTransactionWorkspace(ctx: TransactionContext, id: string, input: unknown, now = new Date()): Promise<ServiceResult<TransactionWorkspace>> {
  const parsed = updateTransactionWorkspaceSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_transaction" };
  const d = parsed.data, hash = createPayloadHash({ id, ...d }), previous = await replayWorkspace(ctx, d.requestId, hash, "edit", now); if (previous) return previous;
  const loaded = await load(ctx, id, true); if (!loaded.ok) return loaded; const row = loaded.value;
  if (d.details.transactionType === "general_contractor") return { ok: false, reason: "gc_not_configured" };
  if (!revisionMatches(row.updatedAt, d.expectedUpdatedAt)) return { ok: false, reason: "conflict" };
  if (row.listingDataset && (d.details.listingKey !== row.listingKey || d.details.mlsNumber !== row.mlsNumber)) return { ok: false, reason: "property_linked" };
  const rows = await ctx.db.select().from(transactionDeadlines).where(and(eq(transactionDeadlines.transactionId, id), isNull(transactionDeadlines.removedAt))), next = nextTransactionRevision(row, now);
  const closing = closingMetadataWrites(ctx, row, rows, d.details.closingDate, next); if (!closing.ok) return closing;
  const fields = Object.keys(d.details).filter(key => (details(row) as unknown as Record<string, unknown>)[key] !== (d.details as unknown as Record<string, unknown>)[key]);
  const guard = sql`exists(select 1 from ${transactions} where ${transactionRevisionGuard(ctx, row, d.expectedUpdatedAt)} and (${transactions.listingDataset} is null or (${transactions.listingKey} is not distinct from ${d.details.listingKey}::text and ${transactions.mlsNumber} is not distinct from ${d.details.mlsNumber}::text))) and ${deadlineGuard(rows, id)}`;
  const writes: Write[] = [...transactionWriteLocks(ctx, id), childLocks(ctx, id), ctx.db.insert(transactionWriteRequests).values({ actorUserId: ctx.actor.userId, requestId: d.requestId, transactionId: id, action: "edit", payloadHash: sql`case when ${guard} then ${hash}::text else null end`, result: { transactionId: id, updatedAt: next.toISOString() }, createdAt: now }),
    ctx.db.update(transactions).set({ ...d.details, state: d.details.state.toUpperCase(), updatedByUserId: ctx.actor.userId, updatedAt: next }).where(transactionRevisionGuard(ctx, row, d.expectedUpdatedAt)), ...closing.value, ...historyWrites(ctx, id, "edit", fields, now)];
  try { await ctx.db.batch(writes as unknown as Batch); } catch (error) { return recover(ctx, id, d.requestId, hash, "edit", error, now); }
  return getTransactionWorkspace(ctx, id, {}, now);
}
export async function mutateTransactionDeadline(ctx: TransactionContext, id: string, input: unknown, now = new Date()): Promise<ServiceResult<TransactionWorkspace>> {
  const parsed = transactionDeadlineMutationSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_transaction" };
  const d = parsed.data, action = `${d.action}_deadline`, hash = createPayloadHash({ id, ...d }), previous = await replayWorkspace(ctx, d.requestId, hash, action, now); if (previous) return previous;
  const loaded = await load(ctx, id, true); if (!loaded.ok) return loaded; const row = loaded.value;
  if (!revisionMatches(row.updatedAt, d.expectedUpdatedAt)) return { ok: false, reason: "conflict" };
  const rows = await ctx.db.select().from(transactionDeadlines).where(and(eq(transactionDeadlines.transactionId, id), isNull(transactionDeadlines.removedAt))), current = d.action === "add" ? undefined : rows.find(deadline => deadline.id === d.deadlineId);
  if (d.action !== "add" && !current) return { ok: false, reason: "not_found" };
  if (d.action !== "add" && current && !revisionMatches(current.updatedAt, d.expectedDeadlineUpdatedAt)) return { ok: false, reason: "conflict" };
  if (d.action === "complete" && current?.completedAt || d.action === "reopen" && !current?.completedAt) return { ok: false, reason: "invalid_deadline_transition" };
  const next = nextTransactionRevision(row, now), deadlineId = current?.id ?? randomUUID(), otherClosing = rows.filter(item => item.kind === "closing" && item.id !== current?.id);
  let closingDate = row.closingDate;
  if (d.action === "add" || d.action === "edit") {
    if (d.deadline.kind === "closing") { if (otherClosing.length || current?.completedAt && (current.kind !== "closing" || current.dueDate !== d.deadline.dueDate) || !current && row.closingDate && row.closingDate !== d.deadline.dueDate) return { ok: false, reason: "closing_deadline_conflict" }; closingDate = d.deadline.dueDate; }
    else if (current?.kind === "closing") { if (current.completedAt || otherClosing.length || row.closingDate && row.closingDate !== current.dueDate) return { ok: false, reason: "closing_deadline_conflict" }; closingDate = null; }
  } else if (current?.kind === "closing") {
    if (d.action === "remove") { if (current.completedAt) return { ok: false, reason: "closing_deadline_conflict" }; if (!otherClosing.length && row.closingDate === current.dueDate) closingDate = null; }
    else if (otherClosing.length || row.closingDate !== current.dueDate) return { ok: false, reason: "closing_deadline_conflict" };
  }
  const guard = sql`exists(select 1 from ${transactions} where ${transactionRevisionGuard(ctx, row, d.expectedUpdatedAt)}) and ${deadlineGuard(rows, id)}`;
  const writes: Write[] = [...transactionWriteLocks(ctx, id), childLocks(ctx, id), ctx.db.insert(transactionWriteRequests).values({ actorUserId: ctx.actor.userId, requestId: d.requestId, transactionId: id, action, payloadHash: sql`case when ${guard} then ${hash}::text else null end`, result: { transactionId: id, updatedAt: next.toISOString(), deadlineId }, createdAt: now }),
    ctx.db.update(transactions).set({ closingDate, updatedAt: next, updatedByUserId: ctx.actor.userId }).where(transactionRevisionGuard(ctx, row, d.expectedUpdatedAt))];
  if (d.action === "add") writes.push(ctx.db.insert(transactionDeadlines).values({ id: deadlineId, transactionId: id, ...d.deadline, note: d.deadline.note ?? null, sortOrder: rows.reduce((max, item) => Math.max(max, item.sortOrder + 1), 0), createdAt: now, updatedAt: next }));
  else if (d.action === "edit") writes.push(ctx.db.update(transactionDeadlines).set({ ...d.deadline, note: d.deadline.note ?? null, updatedAt: childRevision(next) }).where(and(eq(transactionDeadlines.id, deadlineId), eq(transactionDeadlines.transactionId, id))));
  else writes.push(ctx.db.update(transactionDeadlines).set({ ...(d.action === "remove" ? { removedAt: now } : { completedAt: d.action === "complete" ? now : null }), updatedAt: childRevision(next) }).where(and(eq(transactionDeadlines.id, deadlineId), eq(transactionDeadlines.transactionId, id))));
  const fields = d.action === "add" || d.action === "edit" ? ["kind", "label", "dueDate", "note"] : [d.action === "remove" ? "removedAt" : "completedAt"];
  writes.push(...historyWrites(ctx, id, action, fields, now, deadlineId));
  try { await ctx.db.batch(writes as unknown as Batch); } catch (error) { return recover(ctx, id, d.requestId, hash, action, error, now); }
  return getTransactionWorkspace(ctx, id, {}, now);
}

/** Explicit attestation, scoped to this file. It never completes a deadline or changes the stage. */
export async function mutateTransactionChecklist(ctx: TransactionContext, id: string, input: unknown, now = new Date()): Promise<ServiceResult<TransactionWorkspace>> {
  const parsed = transactionChecklistMutationSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_transaction" };
  const d = parsed.data, action = `${d.action}_checklist`, hash = createPayloadHash({ id, ...d }), previous = await replayWorkspace(ctx, d.requestId, hash, action, now); if (previous) return previous;
  const loaded = await load(ctx, id, true); if (!loaded.ok) return loaded; const row = loaded.value;
  if (!revisionMatches(row.updatedAt, d.expectedUpdatedAt)) return { ok: false, reason: "conflict" };
  const [item] = await ctx.db.select().from(transactionChecklistItems).where(and(eq(transactionChecklistItems.id, d.itemId), eq(transactionChecklistItems.transactionId, id))).limit(1);
  if (!item) return { ok: false, reason: "not_found" };
  if (!revisionMatches(item.updatedAt, d.expectedItemUpdatedAt)) return { ok: false, reason: "conflict" };
  if (d.action === "complete" && item.completedAt || d.action === "reopen" && !item.completedAt) return { ok: false, reason: "invalid_checklist_transition" };
  if (d.action === "complete" && item.attachmentRequired) { const [proof] = await ctx.db.select({ id: transactionChecklistAttachments.id }).from(transactionChecklistAttachments).where(and(eq(transactionChecklistAttachments.transactionId, id), eq(transactionChecklistAttachments.checklistItemId, item.id), isNull(transactionChecklistAttachments.removedAt))).limit(1); if (!proof) return { ok: false, reason: "attachment_required" }; }
  const next = nextTransactionRevision(row, now), childGuard = and(eq(transactionChecklistItems.id, d.itemId), eq(transactionChecklistItems.transactionId, id), sql`date_trunc('milliseconds',${transactionChecklistItems.updatedAt})=${d.expectedItemUpdatedAt}::timestamptz`, d.action === "complete" ? isNull(transactionChecklistItems.completedAt) : sql`${transactionChecklistItems.completedAt} is not null`);
  const guard = sql`exists(select 1 from ${transactions} where ${transactionRevisionGuard(ctx, row, d.expectedUpdatedAt)}) and exists(select 1 from ${transactionChecklistItems} where ${childGuard}) ${d.action === "complete" ? sql`and (not exists(select 1 from ${transactionChecklistItems} where ${transactionChecklistItems.id}=${item.id}::uuid and ${transactionChecklistItems.attachmentRequired}=true) or exists(select 1 from ${transactionChecklistAttachments} where ${transactionChecklistAttachments.transactionId}=${id}::uuid and ${transactionChecklistAttachments.checklistItemId}=${item.id}::uuid and ${transactionChecklistAttachments.removedAt} is null))` : sql``}`;
  const writes: Write[] = [...transactionWriteLocks(ctx, id), ctx.db.select({ id: transactionChecklistItems.id }).from(transactionChecklistItems).where(eq(transactionChecklistItems.transactionId, id)).orderBy(transactionChecklistItems.id).for("update"),
    ctx.db.select({ id: transactionChecklistAttachments.id }).from(transactionChecklistAttachments).where(eq(transactionChecklistAttachments.transactionId, id)).orderBy(transactionChecklistAttachments.id).for("update"),
    ctx.db.insert(transactionWriteRequests).values({ actorUserId: ctx.actor.userId, requestId: d.requestId, transactionId: id, action, payloadHash: sql`case when ${guard} then ${hash}::text else null end`, result: { transactionId: id, updatedAt: next.toISOString() }, createdAt: now }),
    ctx.db.update(transactions).set({ updatedAt: next, updatedByUserId: ctx.actor.userId }).where(transactionRevisionGuard(ctx, row, d.expectedUpdatedAt)),
    ctx.db.update(transactionChecklistItems).set({ completedAt: d.action === "complete" ? now : null, completedByUserId: d.action === "complete" ? ctx.actor.userId : null, updatedAt: sql`greatest(date_trunc('milliseconds',${transactionChecklistItems.updatedAt})+interval '1 millisecond',${next.toISOString()}::timestamptz)` }).where(childGuard),
    ...historyWrites(ctx, id, action, ["completedAt"], now, undefined, d.itemId)];
  try { await ctx.db.batch(writes as unknown as Batch); } catch (error) { return recover(ctx, id, d.requestId, hash, action, error, now); }
  return getTransactionWorkspace(ctx, id, {}, now);
}
