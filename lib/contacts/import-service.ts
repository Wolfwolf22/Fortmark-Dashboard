import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import { auditEvents, contactActivities, contactImportRequests, contactNotes, contacts, type ContactRow } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { canCreateFor } from "./domain.ts";
import type { Ctx, ServiceFailure } from "./service.ts";
import { canTransition, requiresEngagementNotice } from "./stages.ts";
import { contactRevision, createPayloadHash, nextContactUpdatedAt, revisionMatches } from "./reliability.ts";
import { findExactContactDuplicates, findImportContactDuplicates, exactDuplicatePredicate, ownDuplicateBookPredicate } from "./duplicates-service.ts";
import { importCommitInputSchema, importPreviewInputSchema, normalizeImportRow, IMPORT_LIMITS, type ImportCommitInput, type ImportPreview, type ImportPreviewRow, type ImportRawRow, type ImportResult, type ImportValues } from "./import.ts";

export type ImportServiceResult<T> = { ok: true; value: T } | { ok: false; reason: ServiceFailure | "invalid_import" };
type BatchWrite = Parameters<Db["batch"]>[0][number];
const hasName = (v: ImportValues) => Boolean(v.firstName || v.lastName || v.preferredName);
function inFileDuplicates(rows: ImportRawRow[]): Map<number, number[]> {
  const normalized = rows.map(row => ({ rowNumber: row.rowNumber, ...normalizeImportRow(row).values }));
  return new Map(normalized.map(row => [row.rowNumber, normalized.filter(other => other.rowNumber !== row.rowNumber &&
    ((row.email && row.email === other.email) || (row.phone && row.phone === other.phone))).map(other => other.rowNumber)]));
}
function reviewedFingerprint(ctx: Ctx, normalized: ImportValues, exactFingerprint: string, fileDuplicates: number[]): string {
  return createPayloadHash({ actor: ctx.actor.userId, brokerage: ctx.actor.brokerageKey, normalized, exactFingerprint, fileDuplicates });
}
function validPayload(input: unknown): boolean { return new TextEncoder().encode(JSON.stringify(input)).length <= IMPORT_LIMITS.bytes; }
export async function previewContactImport(ctx: Ctx, input: unknown): Promise<ImportServiceResult<ImportPreview>> {
  if (!canCreateFor(ctx.actor, ctx.actor.userId)) return { ok: false, reason: "forbidden" };
  const parsed = importPreviewInputSchema.safeParse(input);
  if (!parsed.success || !validPayload(input)) return { ok: false, reason: "invalid_import" };
  const file = inFileDuplicates(parsed.data.rows), rows: ImportPreviewRow[] = [];
  const previewRow = async (row: ImportRawRow): Promise<ImportServiceResult<ImportPreviewRow>> => {
    const normalized = normalizeImportRow(row);
    const exact = await findImportContactDuplicates(ctx, normalized.values);
    if (!exact.ok) return exact;
    const errors = [...normalized.errors];
    if (!hasName(normalized.values) && !exact.value.count) errors.push({ field: "preferredName", message: "Add a first, last or full name before creating a contact." });
    const fileDuplicates = file.get(row.rowNumber) ?? [];
    return { ok: true, value: { rowNumber: row.rowNumber, values: row.values, normalized: normalized.values, errors, candidates: exact.value.matches.slice(0, 50), candidateHasMore: exact.value.advisoryHasMore || exact.value.matches.length > 50, fileDuplicates,
      reviewFingerprint: reviewedFingerprint(ctx, normalized.values, exact.value.fingerprint, fileDuplicates),
      recommendedDecision: errors.length || exact.value.count || fileDuplicates.length ? "skip" : "add" } };
  };
  // Keep database fan-out bounded for the maximum 250-row preview.
  for (let index = 0; index < parsed.data.rows.length; index += 8) {
    const chunk = await Promise.all(parsed.data.rows.slice(index, index + 8).map(previewRow));
    for (const row of chunk) { if (!row.ok) return row; rows.push(row.value); }
  }
  return { ok: true, value: { rows, counts: { total: rows.length, valid: rows.filter(row => !row.errors.length).length,
    invalid: rows.filter(row => row.errors.length).length, matched: rows.filter(row => row.candidates.length || row.fileDuplicates.length).length } } };
}
function columns(values: ImportValues): Partial<ContactRow> {
  const { notes: _notes, phone, ...fields } = values;
  return { ...fields, ...(phone ? { phoneE164: phone } : {}) };
}
function guardViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let i = 0; current && typeof current === "object" && i < 6; i++) {
    const e = current as { code?: unknown; table?: unknown; column?: unknown; cause?: unknown };
    if (e.code === "23502" && ((e.table === "contact_import_requests" && e.column === "payload_hash") || (e.table === "contacts" && e.column === "stage"))) return true;
    current = e.cause;
  }
  return false;
}
export async function commitContactImport(ctx: Ctx, input: unknown, now = new Date()): Promise<ImportServiceResult<ImportResult>> {
  if (!canCreateFor(ctx.actor, ctx.actor.userId)) return { ok: false, reason: "forbidden" };
  const parsed = importCommitInputSchema.safeParse(input);
  if (!parsed.success || !validPayload(input)) return { ok: false, reason: "invalid_import" };
  const d: ImportCommitInput = parsed.data, hash = createPayloadHash(d);
  const receiptWhere = and(eq(contactImportRequests.actorUserId, ctx.actor.userId), eq(contactImportRequests.requestId, d.requestId));
  async function replay(): Promise<ImportServiceResult<ImportResult> | null> {
    const [receipt] = await ctx.db.select().from(contactImportRequests).where(receiptWhere).limit(1);
    if (!receipt) return null;
    return receipt.payloadHash === hash ? { ok: true, value: receipt.result as unknown as ImportResult } : { ok: false, reason: "request_conflict" };
  }
  const prior = await replay(); if (prior) return prior;
  async function conflictResult(): Promise<ImportServiceResult<ImportResult>> {
    // Another identical retry may have committed while this caller reviewed
    // its rows. Recover that receipt before reporting its writes as a conflict.
    try { return await replay() ?? { ok: false, reason: "conflict" }; }
    catch { return { ok: false, reason: "unavailable" }; }
  }
  const file = inFileDuplicates(d.rows), writes: BatchWrite[] = [], guards: SQL[] = [], targets = new Set<string>();
  const result: ImportResult = { rows: [], counts: { added: 0, updated: 0, skipped: 0 } };
  for (const row of d.rows) {
    if (row.decision === "skip") { result.rows.push({ rowNumber: row.rowNumber, status: "skipped" }); result.counts.skipped++; continue; }
    const normalized = normalizeImportRow(row);
    if (normalized.errors.length) return { ok: false, reason: "invalid_import" };
    const values = normalized.values, exact = await findExactContactDuplicates(ctx, values);
    if (!exact.ok) return exact;
    const fileDuplicates = file.get(row.rowNumber) ?? [];
    if (reviewedFingerprint(ctx, values, exact.value.fingerprint, fileDuplicates) !== row.reviewFingerprint) return await conflictResult();
    const predicate = exactDuplicatePredicate(values);
    const expectedIds = exact.value.sources.map(source => source.id);
    if (predicate) {
      const sourceScope = ownDuplicateBookPredicate(ctx.actor, contacts, { includeMerged: true });
      guards.push(sql`not exists(select 1 from ${contacts} where ${and(sourceScope, predicate, expectedIds.length ? notInArray(contacts.id, expectedIds) : undefined)})`);
      for (const source of exact.value.sources) guards.push(sql`exists(select 1 from ${contacts} where ${and(sourceScope, eq(contacts.id, source.id), contactRevision(source.updatedAt), predicate, sql`coalesce(${contacts.mergedIntoContactId}, ${contacts.id}) = ${source.canonicalId}::uuid`)} for update)`);
      for (const match of exact.value.matches) guards.push(sql`exists(select 1 from ${contacts} where ${and(ownDuplicateBookPredicate(ctx.actor), eq(contacts.id, match.contact.id), contactRevision(match.contact.updatedAt))} for update)`);
    }
    let target: ContactRow | undefined;
    if (row.decision === "update") {
      if (!row.targetId || !row.expectedUpdatedAt || targets.has(row.targetId)) return { ok: false, reason: "invalid_import" };
      targets.add(row.targetId);
      [target] = await ctx.db.select().from(contacts).where(and(ownDuplicateBookPredicate(ctx.actor), eq(contacts.id, row.targetId))).limit(1);
      if (!target || !revisionMatches(target.updatedAt, row.expectedUpdatedAt)) return await conflictResult();
      guards.push(sql`exists(select 1 from ${contacts} where ${and(ownDuplicateBookPredicate(ctx.actor), eq(contacts.id, target.id), contactRevision(row.expectedUpdatedAt))} for update)`);
      if (values.stage && values.stage !== target.stage && !canTransition(target.stage, values.stage)) return { ok: false, reason: "invalid_transition" };
    } else {
      if (!hasName(values)) return { ok: false, reason: "invalid_name" };
      if ((exact.value.count || fileDuplicates.length) && row.createSeparate !== true) return { ok: false, reason: "conflict" };
    }
    const stage = values.stage ?? target?.stage ?? "lead";
    if (requiresEngagementNotice(target?.stage ?? "lead", stage) && !d.engagementAcknowledged) return { ok: false, reason: "invalid_import" };
    const id = target?.id ?? randomUUID(), set = columns(values);
    const changed = Object.entries(set).filter(([key, value]) => !target || (target as unknown as Record<string, unknown>)[key] !== value).map(([key]) => key);
    if (target && !changed.length && !values.notes) { result.rows.push({ rowNumber: row.rowNumber, status: "skipped", contactId: id }); result.counts.skipped++; continue; }
    if (!target) {
      writes.push(ctx.db.insert(contacts).values({ ...set, id, brokerageKey: ctx.actor.brokerageKey, assignedAgentUserId: ctx.actor.userId, createdByUserId: ctx.actor.userId, updatedByUserId: ctx.actor.userId, stage, createdAt: now, updatedAt: now }));
      writes.push(ctx.db.insert(contactActivities).values({ contactId: id, actorUserId: ctx.actor.userId, kind: "system", summary: "Contact created", occurredAt: now, safeMetadata: { mechanism: "import" } }));
    } else {
      writes.push(ctx.db.update(contacts).set({ ...set, stage: sql`case when ${and(ownDuplicateBookPredicate(ctx.actor), contactRevision(row.expectedUpdatedAt!))} then ${stage}::contact_stage else null end`, updatedByUserId: ctx.actor.userId, updatedAt: nextContactUpdatedAt(now) }).where(eq(contacts.id, id)));
    }
    if (stage !== (target?.stage ?? "lead")) writes.push(ctx.db.insert(contactActivities).values({ contactId: id, actorUserId: ctx.actor.userId, kind: "status_change", summary: `Stage changed from ${target?.stage ?? "lead"} to ${stage}`, occurredAt: now, safeMetadata: { from: target?.stage ?? "lead", to: stage, mechanism: "import", ...(requiresEngagementNotice(target?.stage ?? "lead", stage) ? { engagementAcknowledged: true } : {}) } }));
    writes.push(ctx.db.insert(auditEvents).values({ eventType: target ? "contact_updated" : "contact_created", actorUserId: ctx.actor.userId, targetUserId: null, safeMetadata: { contactId: id, mechanism: "import", fields: changed, ...(stage !== (target?.stage ?? "lead") ? { stage } : {}) } }));
    if (values.notes) {
      const noteId = randomUUID();
      writes.push(ctx.db.insert(contactNotes).values({ id: noteId, contactId: id, authorUserId: ctx.actor.userId, body: values.notes, createdAt: now }));
      writes.push(ctx.db.insert(auditEvents).values({ eventType: "contact_note_created", actorUserId: ctx.actor.userId, safeMetadata: { contactId: id, noteId, mechanism: "import", fields: ["notes"] } }));
    }
    const status = target ? "updated" : "added";
    result.rows.push({ rowNumber: row.rowNumber, status, contactId: id }); result.counts[status]++;
  }
  // The first statement both serializes identical retries and rechecks every
  // reviewed match/target while locking existing rows for the whole batch.
  const checkedHash = guards.length ? sql`case when ${and(...guards)} then ${hash} else null end` : hash;
  const receipt = ctx.db.insert(contactImportRequests).values({ actorUserId: ctx.actor.userId, requestId: d.requestId, payloadHash: checkedHash, result: result as unknown as Record<string, unknown>, createdAt: now });
  try { await ctx.db.batch([receipt, ...writes] as unknown as Parameters<Db["batch"]>[0]); }
  catch (error) {
    try { const recovered = await replay(); if (recovered) return recovered; } catch { return { ok: false, reason: "unavailable" }; }
    return { ok: false, reason: guardViolation(error) ? "conflict" : "unavailable" };
  }
  return { ok: true, value: result };
}
