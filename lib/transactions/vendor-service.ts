import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { auditEvents, brokerageVendors, brokerageVendorWriteRequests, dashboardUsers, transactionEvents, transactionVendorEngagements, transactionVendorSelections, transactionWriteRequests, transactions } from "../db/schema.ts";
import { isRecordId } from "../db/ids.ts";
import { createPayloadHash, revisionMatches } from "../contacts/reliability.ts";
import { canWrite } from "./domain.ts";
import { isTerminalStage } from "./stages.ts";
import { getTransactionWorkspace } from "./workspace-service.ts";
import type { TransactionWorkspace } from "./workspace-domain.ts";
import { createBrokerageVendorSchema, updateBrokerageVendorSchema, transactionVendorMutationSchema, VENDOR_ROLES, type BrokerageVendorDirectory, type BrokerageVendorView, type TransactionVendorSelectionView, type VendorRole } from "./vendor-domain.ts";
import { DEFAULT_VENDOR_DETAIL_FIELDS } from "./vendor-detail-domain.ts";
import { visibleTo, transactionWriteLocks, transactionRevisionGuard, nextTransactionRevision, transactionWriteReplay, isTransactionGuardConflict, type TransactionContext, type ServiceFailure } from "./service.ts";

export type VendorFailure = ServiceFailure | "vendor_unavailable";
export type VendorResult<T> = { ok: true; value: T } | { ok: false; reason: VendorFailure };
type VendorRow = typeof brokerageVendors.$inferSelect;
type Write = Parameters<TransactionContext["db"]["batch"]>[0][number];
type Batch = Parameters<TransactionContext["db"]["batch"]>[0];
const admin = (ctx: TransactionContext) => ctx.actor.role === "admin";
const actorGuard = (ctx: TransactionContext) => sql`exists(select 1 from ${dashboardUsers} where ${dashboardUsers.id}=${ctx.actor.userId}::uuid and ${dashboardUsers.role}=${ctx.actor.role} and ${dashboardUsers.status}='active')`;
const adminGuard = (ctx: TransactionContext) => sql`exists(select 1 from ${dashboardUsers} where ${dashboardUsers.id}=${ctx.actor.userId}::uuid and ${dashboardUsers.role}='admin' and ${dashboardUsers.status}='active')`;
const vendorScope = (ctx: TransactionContext, id: string) => and(eq(brokerageVendors.id, id), eq(brokerageVendors.brokerageKey, ctx.actor.brokerageKey));
function vendorView(row: VendorRow): BrokerageVendorView { return { id: row.id, name: row.name, company: row.company, email: row.email, phone: row.phone, categories: row.categories as VendorRole[], approved: row.approved, updatedAt: row.updatedAt.toISOString() }; }
function directoryGuardConflict(error: unknown): boolean {
  if (isTransactionGuardConflict(error)) return true;
  let cause = error;
  for (let i = 0; cause && typeof cause === "object" && i < 8; i++) { const value = cause as { code?: string; table?: string; column?: string; cause?: unknown }; if (value.code === "23502" && value.table === "brokerage_vendor_write_requests" && value.column === "payload_hash") return true; cause = value.cause; }
  return false;
}
async function directoryReplay(ctx: TransactionContext, requestId: string, hash: string, action: "create" | "edit"): Promise<VendorResult<BrokerageVendorView> | null> {
  if (!admin(ctx)) return { ok: false, reason: "forbidden" };
  const [receipt] = await ctx.db.select().from(brokerageVendorWriteRequests).where(and(eq(brokerageVendorWriteRequests.actorUserId, ctx.actor.userId), eq(brokerageVendorWriteRequests.requestId, requestId))).limit(1);
  if (!receipt) return null;
  if (receipt.brokerageKey !== ctx.actor.brokerageKey) return { ok: false, reason: "not_found" };
  const [row] = await ctx.db.select().from(brokerageVendors).where(vendorScope(ctx, receipt.vendorId)).limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  return receipt.payloadHash === hash && receipt.action === action ? { ok: true, value: vendorView(row) } : { ok: false, reason: "request_conflict" };
}
/** Ordinary brokerage actors read approved choices; only the Admin receives draft/retired entries. */
export async function listBrokerageVendors(ctx: TransactionContext, options: { role?: VendorRole } = {}): Promise<VendorResult<BrokerageVendorDirectory>> {
  if (options.role && !VENDOR_ROLES.includes(options.role)) return { ok: false, reason: "invalid_transaction" };
  const rows = await ctx.db.select().from(brokerageVendors).where(and(eq(brokerageVendors.brokerageKey, ctx.actor.brokerageKey), admin(ctx) ? undefined : eq(brokerageVendors.approved, true), options.role ? sql`${options.role}=any(${brokerageVendors.categories})` : undefined)).orderBy(asc(brokerageVendors.name), asc(brokerageVendors.id));
  return { ok: true, value: { items: rows.map(vendorView), canManage: admin(ctx) } };
}
export async function createBrokerageVendor(ctx: TransactionContext, input: unknown, now = new Date()): Promise<VendorResult<BrokerageVendorView>> {
  if (!admin(ctx)) return { ok: false, reason: "forbidden" };
  const parsed = createBrokerageVendorSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_transaction" };
  const d = parsed.data, hash = createPayloadHash({ brokerageKey: ctx.actor.brokerageKey, ...d }), previous = await directoryReplay(ctx, d.requestId, hash, "create"); if (previous) return previous;
  const id = randomUUID(), writes: Write[] = [...transactionWriteLocks(ctx), ctx.db.insert(brokerageVendors).values({ id, brokerageKey: ctx.actor.brokerageKey, ...d.vendor, createdByUserId: ctx.actor.userId, updatedByUserId: ctx.actor.userId, createdAt: now, updatedAt: now }),
    ctx.db.insert(brokerageVendorWriteRequests).values({ actorUserId: ctx.actor.userId, requestId: d.requestId, brokerageKey: ctx.actor.brokerageKey, vendorId: id, action: "create", payloadHash: sql`case when ${adminGuard(ctx)} then ${hash}::text else null end`, result: { vendorId: id, updatedAt: now.toISOString() }, createdAt: now }),
    ctx.db.insert(auditEvents).values({ actorUserId: ctx.actor.userId, eventType: "brokerage_vendor_created", safeMetadata: { vendorId: id, fields: Object.keys(d.vendor) }, createdAt: now })];
  try { await ctx.db.batch(writes as unknown as Batch); } catch (error) { return await directoryReplay(ctx, d.requestId, hash, "create") ?? { ok: false, reason: directoryGuardConflict(error) ? "conflict" : "unavailable" }; }
  return await directoryReplay(ctx, d.requestId, hash, "create") ?? { ok: false, reason: "unavailable" };
}
export async function updateBrokerageVendor(ctx: TransactionContext, id: string, input: unknown, now = new Date()): Promise<VendorResult<BrokerageVendorView>> {
  if (!admin(ctx)) return { ok: false, reason: "forbidden" };
  if (!isRecordId(id)) return { ok: false, reason: "not_found" };
  const parsed = updateBrokerageVendorSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_transaction" };
  const d = parsed.data, hash = createPayloadHash({ id, brokerageKey: ctx.actor.brokerageKey, ...d }), previous = await directoryReplay(ctx, d.requestId, hash, "edit"); if (previous) return previous;
  const [row] = await ctx.db.select().from(brokerageVendors).where(vendorScope(ctx, id)).limit(1); if (!row) return { ok: false, reason: "not_found" };
  if (!revisionMatches(row.updatedAt, d.expectedUpdatedAt)) return { ok: false, reason: "conflict" };
  const next = new Date(Math.max(now.getTime(), row.updatedAt.getTime() + 1)), guard = sql`${adminGuard(ctx)} and exists(select 1 from ${brokerageVendors} where ${vendorScope(ctx, id)} and date_trunc('milliseconds',${brokerageVendors.updatedAt})=${d.expectedUpdatedAt}::timestamptz)`;
  const fields = Object.keys(d.vendor).filter(key => JSON.stringify(row[key as keyof VendorRow]) !== JSON.stringify(d.vendor[key as keyof typeof d.vendor]));
  const writes: Write[] = [...transactionWriteLocks(ctx), ctx.db.select({ id: brokerageVendors.id }).from(brokerageVendors).where(vendorScope(ctx, id)).for("update"),
    ctx.db.insert(brokerageVendorWriteRequests).values({ actorUserId: ctx.actor.userId, requestId: d.requestId, brokerageKey: ctx.actor.brokerageKey, vendorId: id, action: "edit", payloadHash: sql`case when ${guard} then ${hash}::text else null end`, result: { vendorId: id, updatedAt: next.toISOString() }, createdAt: now }),
    ctx.db.update(brokerageVendors).set({ ...d.vendor, updatedByUserId: ctx.actor.userId, updatedAt: next }).where(vendorScope(ctx, id)),
    ctx.db.insert(auditEvents).values({ actorUserId: ctx.actor.userId, eventType: "brokerage_vendor_updated", safeMetadata: { vendorId: id, fields }, createdAt: now })];
  try { await ctx.db.batch(writes as unknown as Batch); } catch (error) { return await directoryReplay(ctx, d.requestId, hash, "edit") ?? { ok: false, reason: directoryGuardConflict(error) ? "conflict" : "unavailable" }; }
  return await directoryReplay(ctx, d.requestId, hash, "edit") ?? { ok: false, reason: "unavailable" };
}
/** Historical snapshots are file data. A retired vendor does not rewrite them. */
export async function readTransactionVendorSelections(ctx: TransactionContext, id: string): Promise<TransactionVendorSelectionView[]> {
  if (!isRecordId(id)) return [];
  const rows = await ctx.db.select({ selection: transactionVendorSelections, current: brokerageVendors, detailId: transactionVendorEngagements.id }).from(transactionVendorSelections)
    .innerJoin(transactions, eq(transactions.id, transactionVendorSelections.transactionId))
    .leftJoin(brokerageVendors, and(eq(brokerageVendors.id, transactionVendorSelections.vendorId), eq(brokerageVendors.brokerageKey, ctx.actor.brokerageKey)))
    .leftJoin(transactionVendorEngagements, and(eq(transactionVendorEngagements.id, transactionVendorSelections.detailId), eq(transactionVendorEngagements.transactionId, transactionVendorSelections.transactionId), eq(transactionVendorEngagements.role, transactionVendorSelections.role), eq(transactionVendorEngagements.vendorId, transactionVendorSelections.vendorId)))
    .where(and(eq(transactionVendorSelections.transactionId, id), visibleTo(ctx.actor))).orderBy(transactionVendorSelections.role);
  return rows.map(({ selection: s, current, detailId }) => ({ id: s.id, role: s.role as VendorRole, status: s.status as TransactionVendorSelectionView["status"], vendorId: s.vendorId, vendorName: s.vendorName, company: s.company, email: s.email, phone: s.phone, detailId: s.status === "selected" ? detailId : null, approved: Boolean(s.status === "selected" && current?.approved && current.categories.includes(s.role)), updatedAt: s.updatedAt.toISOString() }));
}
/** One reviewed role assignment. No client can submit vendor identity snapshots or approval. */
export async function mutateTransactionVendor(ctx: TransactionContext, id: string, input: unknown, now = new Date()): Promise<VendorResult<TransactionWorkspace>> {
  const parsed = transactionVendorMutationSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_transaction" };
  if (!isRecordId(id)) return { ok: false, reason: "not_found" };
  const d = parsed.data, action = "set_vendor", hash = createPayloadHash({ id, ...d });
  const replay = async (): Promise<VendorResult<TransactionWorkspace> | null> => { const prior = await transactionWriteReplay(ctx, d.requestId, hash, action, now); return prior ? prior.ok ? getTransactionWorkspace(ctx, prior.value.id, {}, now) : prior : null; };
  const previous = await replay(); if (previous) return previous;
  const [row] = await ctx.db.select().from(transactions).where(and(eq(transactions.id, id), visibleTo(ctx.actor))).limit(1); if (!row) return { ok: false, reason: "not_found" };
  if (!canWrite(ctx.actor, row)) return { ok: false, reason: "forbidden" };
  if (isTerminalStage(row.stage)) return { ok: false, reason: "invalid_transition" };
  if (!revisionMatches(row.updatedAt, d.expectedUpdatedAt)) return { ok: false, reason: "conflict" };
  const [current] = await ctx.db.select().from(transactionVendorSelections).where(and(eq(transactionVendorSelections.transactionId, id), eq(transactionVendorSelections.role, d.role))).limit(1);
  if (current ? !d.expectedSelectionUpdatedAt || !revisionMatches(current.updatedAt, d.expectedSelectionUpdatedAt) : d.expectedSelectionUpdatedAt !== null) return { ok: false, reason: "conflict" };
  const [vendor] = d.status === "selected" && d.vendorId ? await ctx.db.select().from(brokerageVendors).where(vendorScope(ctx, d.vendorId)).limit(1) : [];
  if (d.status === "selected" && (!vendor || !vendor.approved || !vendor.categories.includes(d.role))) return { ok: false, reason: "vendor_unavailable" };
  if (vendor && (!d.expectedVendorUpdatedAt || !revisionMatches(vendor.updatedAt, d.expectedVendorUpdatedAt))) return { ok: false, reason: "conflict" };
  // A generation belongs to the selected provider, including its original identity.
  // Replacing or detaching a provider never transfers reports or financial terms.
  const retainDetailId = vendor && current?.status === "selected" && current.vendorId === vendor.id ? current.detailId : null;
  if (retainDetailId) {
    const [detail] = await ctx.db.select({ id: transactionVendorEngagements.id }).from(transactionVendorEngagements).where(and(eq(transactionVendorEngagements.id, retainDetailId), eq(transactionVendorEngagements.transactionId, id), eq(transactionVendorEngagements.role, d.role), eq(transactionVendorEngagements.vendorId, vendor!.id))).limit(1);
    if (!detail) return { ok: false, reason: "conflict" };
  }
  const detailId = vendor ? retainDetailId ?? randomUUID() : null;
  const next = nextTransactionRevision(row, now), selectionId = current?.id ?? randomUUID();
  const selectionGuard = current ? sql`exists(select 1 from ${transactionVendorSelections} where ${transactionVendorSelections.id}=${current.id}::uuid and ${transactionVendorSelections.transactionId}=${id}::uuid and ${transactionVendorSelections.role}=${d.role} and ${transactionVendorSelections.status}=${current.status} and ${transactionVendorSelections.vendorId} is not distinct from ${current.vendorId}::uuid and ${transactionVendorSelections.detailId} is not distinct from ${current.detailId}::uuid and date_trunc('milliseconds',${transactionVendorSelections.updatedAt})=${d.expectedSelectionUpdatedAt}::timestamptz)` : sql`not exists(select 1 from ${transactionVendorSelections} where ${transactionVendorSelections.transactionId}=${id}::uuid and ${transactionVendorSelections.role}=${d.role})`;
  const vendorGuard = vendor ? sql`exists(select 1 from ${brokerageVendors} where ${vendorScope(ctx, vendor.id)} and ${brokerageVendors.approved}=true and ${d.role}=any(${brokerageVendors.categories}) and date_trunc('milliseconds',${brokerageVendors.updatedAt})=${d.expectedVendorUpdatedAt}::timestamptz)` : sql`true`;
  const detailGuard = retainDetailId ? sql`exists(select 1 from ${transactionVendorEngagements} where ${transactionVendorEngagements.id}=${retainDetailId}::uuid and ${transactionVendorEngagements.transactionId}=${id}::uuid and ${transactionVendorEngagements.role}=${d.role} and ${transactionVendorEngagements.vendorId}=${vendor!.id}::uuid)` : sql`true`;
  const guard = sql`${actorGuard(ctx)} and exists(select 1 from ${transactions} where ${transactionRevisionGuard(ctx, row, d.expectedUpdatedAt)}) and ${selectionGuard} and ${vendorGuard} and ${detailGuard}`;
  const snapshot = { status: d.status, vendorId: vendor?.id ?? null, vendorName: retainDetailId ? current!.vendorName : vendor?.name ?? null, company: retainDetailId ? current!.company : vendor?.company ?? null, email: retainDetailId ? current!.email : vendor?.email ?? null, phone: retainDetailId ? current!.phone : vendor?.phone ?? null, detailId, updatedAt: current ? new Date(Math.max(next.getTime(), current.updatedAt.getTime() + 1)) : next };
  const safe = { action, fields: ["vendorId", "vendorStatus"], role: d.role, selectionId, ...(vendor ? { vendorId: vendor.id, detailId } : {}) };
  const writes: Write[] = [...transactionWriteLocks(ctx, id), ...(vendor ? [ctx.db.select({ id: brokerageVendors.id }).from(brokerageVendors).where(vendorScope(ctx, vendor.id)).for("share")] : []), ctx.db.select({ id: transactionVendorSelections.id }).from(transactionVendorSelections).where(eq(transactionVendorSelections.transactionId, id)).orderBy(transactionVendorSelections.id).for("update"),
    ctx.db.select({ id: transactionVendorEngagements.id }).from(transactionVendorEngagements).where(eq(transactionVendorEngagements.transactionId, id)).orderBy(transactionVendorEngagements.id).for("update"),
    ctx.db.insert(transactionWriteRequests).values({ actorUserId: ctx.actor.userId, requestId: d.requestId, transactionId: id, action, payloadHash: sql`case when ${guard} then ${hash}::text else null end`, result: { transactionId: id, updatedAt: next.toISOString() }, createdAt: now }),
    ctx.db.update(transactions).set({ updatedAt: next, updatedByUserId: ctx.actor.userId }).where(transactionRevisionGuard(ctx, row, d.expectedUpdatedAt)),
    ...(vendor && !retainDetailId ? [ctx.db.insert(transactionVendorEngagements).values({ id: detailId!, transactionId: id, role: d.role, vendorId: vendor.id, vendorName: vendor.name, company: vendor.company, email: vendor.email, phone: vendor.phone, details: structuredClone(DEFAULT_VENDOR_DETAIL_FIELDS), createdByUserId: ctx.actor.userId, updatedByUserId: ctx.actor.userId, createdAt: now, updatedAt: next })] : []),
    ctx.db.insert(transactionVendorSelections).values({ id: selectionId, transactionId: id, role: d.role, ...snapshot, createdAt: now }).onConflictDoUpdate({ target: [transactionVendorSelections.transactionId, transactionVendorSelections.role], set: snapshot }),
    ctx.db.insert(transactionEvents).values({ transactionId: id, actorUserId: ctx.actor.userId, eventType: "transaction_updated", safeMetadata: safe, createdAt: now }),
    ctx.db.insert(auditEvents).values({ actorUserId: ctx.actor.userId, eventType: "transaction_updated", safeMetadata: { transactionId: id, ...safe }, createdAt: now })];
  try { await ctx.db.batch(writes as unknown as Batch); } catch (error) { const recovered = await replay(); if (recovered) return recovered; const [latest] = await ctx.db.select().from(transactions).where(and(eq(transactions.id, id), visibleTo(ctx.actor))).limit(1); if (!latest) return { ok: false, reason: "not_found" }; return { ok: false, reason: isTransactionGuardConflict(error) ? "conflict" : "unavailable" }; }
  return getTransactionWorkspace(ctx, id, {}, now);
}
