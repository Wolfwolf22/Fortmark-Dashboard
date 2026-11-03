import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { auditEvents, dashboardUsers, transactions, transactionEvents, transactionWriteRequests, type TransactionRow } from "../db/schema.ts";
import { isRecordId } from "../db/ids.ts";
import { createPayloadHash, revisionMatches } from "../contacts/reliability.ts";
import { normalizePropertyMlsNumber, isPropertyDataset, isPropertyListingId, type PropertyMlsProvider, type PropertyResolution } from "../contacts/properties.ts";
import { canSee, canWrite } from "./domain.ts";
import { isTerminalStage } from "./stages.ts";
import { getTransactionWorkspace } from "./workspace-service.ts";
import { transactionPropertyLookupSchema, transactionPropertyMutationSchema, type TransactionPropertyView, type TransactionPropertyLookup, type TransactionPropertyReference } from "./property-domain.ts";
import { transactionPropertyImportValues } from "./property-import.ts";
import { visibleTo, transactionRevisionGuard, transactionWriteLocks, transactionWriteReplay, nextTransactionRevision, isTransactionGuardConflict, type TransactionContext, type ServiceResult } from "./service.ts";
import type { TransactionWorkspace } from "./workspace-domain.ts";
type Batch = Parameters<TransactionContext["db"]["batch"]>[0];
type Write = Batch[number];
const actorGuard = (ctx: TransactionContext) => sql`exists(select 1 from ${dashboardUsers} where ${dashboardUsers.id}=${ctx.actor.userId}::uuid and ${dashboardUsers.role}=${ctx.actor.role} and ${dashboardUsers.status}='active')`;
async function load(ctx: TransactionContext, id: string, write = false): Promise<ServiceResult<TransactionRow>> {
  if (!isRecordId(id)) return { ok: false, reason: "not_found" };
  const [row] = await ctx.db.select().from(transactions).where(and(eq(transactions.id, id), visibleTo(ctx.actor), actorGuard(ctx))).limit(1);
  if (!row || !canSee(ctx.actor, row)) return { ok: false, reason: "not_found" };
  if (write && !canWrite(ctx.actor, row)) return { ok: false, reason: "forbidden" };
  if (write && row.side === "gc") return { ok: false, reason: "gc_not_configured" };
  if (write && isTerminalStage(row.stage)) return { ok: false, reason: "invalid_transition" };
  return { ok: true, value: row };
}
function reference(row: TransactionRow): TransactionPropertyReference | null { return row.listingDataset && row.listingKey && row.mlsNumber && isPropertyDataset(row.listingDataset) && isPropertyListingId(row.listingKey) && normalizePropertyMlsNumber(row.mlsNumber) === row.mlsNumber ? { dataset: row.listingDataset, listingId: row.listingKey, mlsNumber: row.mlsNumber } : null; }
function valid(result: PropertyResolution): boolean { return result.ok && isPropertyDataset(result.value.dataset) && isPropertyListingId(result.value.listing.id) && result.value.listing.source === "mls" && Boolean(normalizePropertyMlsNumber(result.value.listing.mlsNumber)); }
function resolutionFailure(result: Exclude<PropertyResolution, { ok: true }>): ServiceResult<never> { return { ok: false, reason: result.reason === "ambiguous" ? "property_ambiguous" : result.reason === "not_found" ? "property_not_found" : result.reason === "not_configured" ? "property_not_configured" : "property_unavailable" }; }
export function transactionPropertyImportFingerprint(ref: TransactionPropertyReference, listing: Parameters<typeof transactionPropertyImportValues>[1]) { return createPayloadHash(transactionPropertyImportValues(ref, listing)); }
export async function getTransactionProperty(ctx: TransactionContext, id: string, provider: PropertyMlsProvider, now = new Date()): Promise<ServiceResult<TransactionPropertyView>> {
  const loaded = await load(ctx, id); if (!loaded.ok) return loaded; const row = loaded.value, ref = reference(row), canEdit = row.side !== "gc" && canWrite(ctx.actor, row) && !isTerminalStage(row.stage);
  if (!ref) return { ok: true, value: { transactionId: id, reference: null, listing: null, syncStatus: "unlinked", checkedAt: null, canEdit, updatedAt: row.updatedAt.toISOString() } };
  let result: PropertyResolution; try { result = await provider.get(ref.dataset, ref.listingId, ref.mlsNumber); } catch { result = { ok: false, reason: "unavailable" }; }
  const current = await load(ctx, id); if (!current.ok) return current; if (!revisionMatches(current.value.updatedAt, row.updatedAt.toISOString()) || JSON.stringify(reference(current.value)) !== JSON.stringify(ref)) return { ok: false, reason: "conflict" };
  const available = result.ok && valid(result) && result.value.dataset === ref.dataset && result.value.listing.id === ref.listingId && normalizePropertyMlsNumber(result.value.listing.mlsNumber) === ref.mlsNumber;
  return { ok: true, value: { transactionId: id, reference: ref, listing: available && result.ok ? result.value.listing : null, syncStatus: available ? "available" : !result.ok && result.reason !== "ambiguous" ? result.reason : "unavailable", checkedAt: now.toISOString(), canEdit: current.value.side !== "gc" && canWrite(ctx.actor, current.value) && !isTerminalStage(current.value.stage), updatedAt: row.updatedAt.toISOString() } };
}
export async function lookupTransactionProperty(ctx: TransactionContext, id: string, input: unknown, provider: PropertyMlsProvider, now = new Date()): Promise<ServiceResult<TransactionPropertyLookup>> {
  const parsed = transactionPropertyLookupSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_property" };
  const loaded = await load(ctx, id, true); if (!loaded.ok) return loaded; const row = loaded.value;
  let result: PropertyResolution; try { result = await provider.lookup(parsed.data.mlsNumber); } catch { result = { ok: false, reason: "unavailable" }; }
  const current = await load(ctx, id, true); if (!current.ok) return current; if (!revisionMatches(current.value.updatedAt, row.updatedAt.toISOString())) return { ok: false, reason: "conflict" };
  if (!result.ok) return resolutionFailure(result); if (!valid(result) || normalizePropertyMlsNumber(result.value.listing.mlsNumber) !== parsed.data.mlsNumber) return { ok: false, reason: "property_unavailable" };
  const ref = { dataset: result.value.dataset, listingId: result.value.listing.id, mlsNumber: parsed.data.mlsNumber };
  return { ok: true, value: { transactionId: id, expectedUpdatedAt: row.updatedAt.toISOString(), reference: ref, listing: result.value.listing, importFingerprint: transactionPropertyImportFingerprint(ref, result.value.listing), checkedAt: now.toISOString() } };
}
async function replay(ctx: TransactionContext, id: string, requestId: string, hash: string, action: string, now: Date): Promise<ServiceResult<TransactionWorkspace> | null> {
  const [actor] = await ctx.db.select({ id: dashboardUsers.id }).from(dashboardUsers).where(and(eq(dashboardUsers.id, ctx.actor.userId), eq(dashboardUsers.role, ctx.actor.role), eq(dashboardUsers.status, "active"))).limit(1); if (!actor) return { ok: false, reason: "forbidden" };
  const result = await transactionWriteReplay(ctx, requestId, hash, action, now); if (!result) return null; if (!result.ok) return result; if (result.value.id !== id) return { ok: false, reason: "request_conflict" }; return getTransactionWorkspace(ctx, id, {}, now);
}
export async function mutateTransactionProperty(ctx: TransactionContext, id: string, input: unknown, provider: PropertyMlsProvider, now = new Date()): Promise<ServiceResult<TransactionWorkspace>> {
  if (!isRecordId(id)) return { ok: false, reason: "not_found" }; const parsed = transactionPropertyMutationSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_property" };
  const d = parsed.data, hash = createPayloadHash({ id, ...d }), action = d.action === "link" ? "link_property" : "unlink_property", previous = await replay(ctx, id, d.requestId, hash, action, now); if (previous) return previous;
  const loaded = await load(ctx, id, true); if (!loaded.ok) return loaded; const row = loaded.value; if (!revisionMatches(row.updatedAt, d.expectedUpdatedAt)) return { ok: false, reason: "conflict" };
  let property: Partial<typeof transactions.$inferInsert> = { listingDataset: null, listingLinkedAt: null, listingKey: null, mlsNumber: null }, fields = ["listingDataset", "listingKey", "mlsNumber", "listingLinkedAt"];
  if (d.action === "link") {
    let result: PropertyResolution; try { result = await provider.lookup(d.mlsNumber); } catch { result = { ok: false, reason: "unavailable" }; }
    const current = await load(ctx, id, true); if (!current.ok) return current; if (!revisionMatches(current.value.updatedAt, d.expectedUpdatedAt)) return { ok: false, reason: "conflict" };
    if (!result.ok) return resolutionFailure(result); if (!valid(result)) return { ok: false, reason: "property_unavailable" };
    const ref = { dataset: result.value.dataset, listingId: result.value.listing.id, mlsNumber: normalizePropertyMlsNumber(result.value.listing.mlsNumber)! };
    if (ref.dataset !== d.expectedDataset || ref.listingId !== d.expectedListingId || ref.mlsNumber !== d.mlsNumber || transactionPropertyImportFingerprint(ref, result.value.listing) !== d.expectedImportFingerprint) return { ok: false, reason: "property_changed" };
    const imported = transactionPropertyImportValues(ref, result.value.listing); if (d.importAddress && !imported.address || d.importListPrice && imported.listPriceCents === null) return { ok: false, reason: "property_import_unavailable" };
    property = { listingDataset: ref.dataset, listingKey: ref.listingId, mlsNumber: ref.mlsNumber, listingLinkedAt: now, ...(d.importAddress ? imported.address! : {}), ...(d.importListPrice ? { listPriceCents: imported.listPriceCents } : {}) };
    fields = [...fields, ...(d.importAddress ? ["addressLine1", "addressLine2", "city", "state", "postalCode", "county"] : []), ...(d.importListPrice ? ["listPriceCents"] : [])];
  }
  const next = nextTransactionRevision(row, now), guard = sql`${actorGuard(ctx)} and exists(select 1 from ${transactions} where ${transactionRevisionGuard(ctx, row, d.expectedUpdatedAt)})`, safe = { action, fields };
  const writes: Write[] = [...transactionWriteLocks(ctx, id), ctx.db.insert(transactionWriteRequests).values({ actorUserId: ctx.actor.userId, requestId: d.requestId, transactionId: id, action, payloadHash: sql`case when ${guard} then ${hash}::text else null end`, result: { transactionId: id, updatedAt: next.toISOString() }, createdAt: now }), ctx.db.update(transactions).set({ ...property, updatedAt: next, updatedByUserId: ctx.actor.userId }).where(transactionRevisionGuard(ctx, row, d.expectedUpdatedAt)), ctx.db.insert(transactionEvents).values({ transactionId: id, actorUserId: ctx.actor.userId, eventType: "transaction_updated", safeMetadata: safe, createdAt: now }), ctx.db.insert(auditEvents).values({ actorUserId: ctx.actor.userId, eventType: "transaction_updated", safeMetadata: { transactionId: id, ...safe }, createdAt: now })];
  try { await ctx.db.batch(writes as unknown as Batch); } catch (error) { const recovered = await replay(ctx, id, d.requestId, hash, action, now); if (recovered) return recovered; const current = await load(ctx, id, true); if (!current.ok) return current; return { ok: false, reason: isTransactionGuardConflict(error) ? "conflict" : "unavailable" }; }
  return getTransactionWorkspace(ctx, id, {}, now);
}
