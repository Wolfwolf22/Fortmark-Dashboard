import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { auditEvents, contacts, dashboardUsers, transactionEvents, transactionParties, transactions, transactionWriteRequests } from "../db/schema.ts";
import { loadContact } from "../contacts/access.ts";
import { displayName } from "../contacts/domain.ts";
import { visibleTo } from "../contacts/visibility.ts";
import { createPayloadHash, revisionMatches } from "../contacts/reliability.ts";
import type { Transaction } from "../data/types.ts";
import { createTransactionSchema, type CreateTransactionInput } from "./validation.ts";
import { transactionWriteLocks, transactionWriteReplay, type ServiceResult, type TransactionContext } from "./service.ts";

type GcInput = Extract<CreateTransactionInput, { side: "gc" }>;
type Batch = Parameters<TransactionContext["db"]["batch"]>[0];
type Write = Batch[number];
function actorGuard(ctx: TransactionContext) { return sql`exists(select 1 from ${dashboardUsers} where ${dashboardUsers.id}=${ctx.actor.userId}::uuid and ${dashboardUsers.role}=${ctx.actor.role} and ${dashboardUsers.status}='active' and ${dashboardUsers.role}<>'member')`; }
async function activeActor(ctx: TransactionContext) { const [actor] = await ctx.db.select({ id: dashboardUsers.id }).from(dashboardUsers).where(and(eq(dashboardUsers.id, ctx.actor.userId), eq(dashboardUsers.role, ctx.actor.role), eq(dashboardUsers.status, "active"))); return Boolean(actor) && ctx.actor.role !== "member"; }

/** A GC file starts as an identity and address, with no sales workflow or financial assumptions. */
export async function createGeneralContractorTransaction(ctx: TransactionContext, input: GcInput, now = new Date()): Promise<ServiceResult<Transaction>> {
  const parsed = createTransactionSchema.safeParse(input); if (!parsed.success || parsed.data.side !== "gc") return { ok: false, reason: "invalid_transaction" };
  const d = parsed.data;
  if (!await activeActor(ctx)) return { ok: false, reason: "forbidden" };
  const requestId = d.requestId ?? randomUUID(), hash = createPayloadHash({ ...d }), replay = () => transactionWriteReplay(ctx, requestId, hash, "create", now);
  const previous = await replay(); if (previous) return previous;
  let contact: Awaited<ReturnType<typeof loadContact>> & { ok: true } | undefined;
  if (d.contactId) { const current = await loadContact(ctx, d.contactId); if (!current.ok) return await replay() ?? { ok: false, reason: "invalid_contact" }; if (!current.writable) return { ok: false, reason: "forbidden" }; contact = current; }
  const id = randomUUID(), name = contact ? displayName(contact.row) : d.clientName!, safe = { stage: "opportunity", side: "gc", transactionType: "general_contractor" };
  const guard = sql`${actorGuard(ctx)} ${contact ? sql`and exists(select 1 from ${contacts} where ${contacts.id}=${contact.row.id}::uuid and ${visibleTo(ctx.actor)} and ${contacts.assignedAgentUserId}=${contact.row.assignedAgentUserId}::uuid and date_trunc('milliseconds',${contacts.updatedAt})=${contact.row.updatedAt.toISOString()}::timestamptz)` : sql``}`;
  const writes: Write[] = transactionWriteLocks(ctx);
  if (contact) writes.push(ctx.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, contact.row.id), visibleTo(ctx.actor))).orderBy(contacts.id).for("update"));
  writes.push(ctx.db.insert(transactions).values({ id, brokerageKey: ctx.actor.brokerageKey, agentUserId: sql`case when ${guard} then ${ctx.actor.userId}::uuid else null end`, createdByUserId: ctx.actor.userId, updatedByUserId: ctx.actor.userId,
    transactionType: "general_contractor", side: "gc", stage: "opportunity", addressLine1: d.addressLine1, addressLine2: null, city: "", state: "", postalCode: null, county: null, listingKey: null, mlsNumber: null, listingDataset: null, listingLinkedAt: null,
    listPriceCents: null, offerPriceCents: null, contractPriceCents: null, commissionRateBps: null, commissionFlatCents: null, agentSplitBps: null, transactionFeeCents: null, referralFeeBps: null, referralPayee: null, commissionPaidCents: null, commissionPaidAt: null,
    contractExecutionDate: null, effectiveDate: null, closingDate: null, closedDate: null, possessionDate: null, cancelledDate: null, notes: null, checklistTemplateVersion: "gc-blank-v1", createdAt: now, updatedAt: now }));
  writes.push(ctx.db.insert(transactionWriteRequests).values({ actorUserId: ctx.actor.userId, requestId, transactionId: id, action: "create", payloadHash: hash, result: { transactionId: id, updatedAt: now.toISOString() }, createdAt: now }),
    ctx.db.insert(transactionParties).values({ transactionId: id, role: "other", displayName: name, company: null, email: null, phoneE164: null, isPrimary: true, contactId: contact?.row.id ?? null, createdAt: now }),
    ctx.db.insert(transactionEvents).values({ transactionId: id, actorUserId: ctx.actor.userId, eventType: "transaction_created", safeMetadata: safe, createdAt: now }), ctx.db.insert(auditEvents).values({ eventType: "transaction_created", actorUserId: ctx.actor.userId, safeMetadata: { transactionId: id, ...safe }, createdAt: now }));
  if (contact) writes.push(ctx.db.insert(auditEvents).values({ eventType: "contact_transaction_linked", actorUserId: ctx.actor.userId, safeMetadata: { contactId: contact.row.id, transactionId: id, mechanism: "create" }, createdAt: now }));
  try { await ctx.db.batch(writes as unknown as Batch); }
  catch { if (!await activeActor(ctx)) return { ok: false, reason: "forbidden" }; const recovered = await replay(); if (recovered) return recovered; if (contact) { const current = await loadContact(ctx, contact.row.id); if (!current.ok || !current.writable || !revisionMatches(current.row.updatedAt, contact.row.updatedAt.toISOString())) return { ok: false, reason: "invalid_contact" }; } return { ok: false, reason: "unavailable" }; }
  if (!await activeActor(ctx)) return { ok: false, reason: "forbidden" };
  return await replay() ?? { ok: false, reason: "unavailable" };
}
