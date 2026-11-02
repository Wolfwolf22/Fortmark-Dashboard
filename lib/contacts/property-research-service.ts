import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { auditEvents, contacts, contactProperties, propertyLists, propertyTransferRequests, type ContactPropertyRow } from "../db/schema.ts";
import { isRecordId } from "../db/ids.ts";
import type { Ctx } from "./service.ts";
import { visibleTo } from "./visibility.ts";
import { createPayloadHash, revisionMatches } from "./reliability.ts";
import { batchRows, loadPropertyList, propertyListMutationGuard, propertyListMutationLocks, propertyListNextUpdatedAt, propertyListVisibility } from "./property-lists-service.ts";
import { getPropertyListProperty, propertyReferenceView, type PropertyFailure, type PropertyServiceResult } from "./properties-service.ts";
import { propertyResearchInputSchema, propertyTransferInputSchema, type PropertyTransferResult } from "./property-research.ts";
import type { PropertyView } from "./properties.ts";

type BatchInput = Parameters<Ctx["db"]["batch"]>[0];
export function propertyRevision(expected: string) { return sql`date_trunc('milliseconds',${contactProperties.updatedAt})=${expected}::timestamptz`; }
export function nextPropertyUpdatedAt(now: Date) { return sql`greatest(date_trunc('milliseconds',${contactProperties.updatedAt}) + interval '1 millisecond',${now.toISOString()}::timestamptz)`; }
async function rowFor(ctx: Ctx, listId: string, id: string, includeRemoved = false): Promise<ContactPropertyRow | undefined> {
  if (!isRecordId(id)) return undefined;
  const [row] = await ctx.db.select().from(contactProperties).where(and(eq(contactProperties.id, id), eq(contactProperties.listId, listId), includeRemoved ? undefined : isNull(contactProperties.removedAt))).limit(1);
  return row;
}

/** Full research snapshots use a revision token. An exact retry acknowledges without rewriting. */
export async function updatePropertyResearch(ctx: Ctx, listId: string, propertyId: string, input: unknown, now = new Date()): Promise<PropertyServiceResult<PropertyView>> {
  const loaded = await loadPropertyList(ctx, listId); if (!loaded.ok) return loaded;
  const scope = loaded.value; if (!scope.writable) return { ok: false, reason: "forbidden" };
  const parsed = propertyResearchInputSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_property_research" };
  const row = await rowFor(ctx, listId, propertyId); if (!row) return { ok: false, reason: "not_found" };
  const d = parsed.data, same = (current: Pick<ContactPropertyRow, "notes" | "reviewStatus">) => current.notes === d.notes && current.reviewStatus === d.reviewStatus;
  if (same(row)) return { ok: true, value: propertyReferenceView(row) };
  if (!revisionMatches(row.updatedAt, d.expectedUpdatedAt)) return { ok: false, reason: "conflict" };
  const fields = [row.notes !== d.notes ? "notes" : null, row.reviewStatus !== d.reviewStatus ? "reviewStatus" : null].filter(Boolean);
  const changed = ctx.db.$with("research_changed").as(ctx.db.update(contactProperties).set({ notes: d.notes, reviewStatus: d.reviewStatus, updatedAt: nextPropertyUpdatedAt(now) }).where(and(
    eq(contactProperties.id, propertyId), eq(contactProperties.listId, listId), isNull(contactProperties.removedAt), propertyRevision(d.expectedUpdatedAt), sql`exists(select 1 from ${propertyLists} where ${propertyListMutationGuard(ctx, scope)})`,
  )).returning({ id: contactProperties.id, listId: contactProperties.listId, contactId: contactProperties.contactId }));
  const touched = ctx.db.$with("research_list_touched").as(ctx.db.update(propertyLists).set({ updatedAt: propertyListNextUpdatedAt(now) }).where(and(eq(propertyLists.id, listId), sql`exists(select 1 from ${changed})`)).returning({ id: propertyLists.id }));
  try {
    const writes = [...propertyListMutationLocks(ctx, scope), ctx.db.select({ id: contactProperties.id }).from(contactProperties).where(and(eq(contactProperties.id, propertyId), eq(contactProperties.listId, listId))).for("update"),
      ctx.db.with(changed, touched).insert(auditEvents).select(ctx.db.select({
        id: sql<string>`${randomUUID()}::uuid`.as("id"), actorUserId: sql<string>`${ctx.actor.userId}::uuid`.as("actor_user_id"), targetUserId: sql<null>`null::uuid`.as("target_user_id"), eventType: sql<string>`'property_list_updated'::text`.as("event_type"),
        safeMetadata: sql<Record<string, unknown>>`jsonb_build_object('listId',${changed.listId},'contactId',${changed.contactId},'propertyId',${changed.id},'action','research','fields',${JSON.stringify(fields)}::jsonb)`.as("safe_metadata"),
        createdAt: sql<Date>`${now.toISOString()}::timestamptz`.as("created_at"),
      }).from(changed)).returning({ id: auditEvents.id })];
    const result = await ctx.db.batch(writes as unknown as BatchInput);
    const latest = await getPropertyListProperty(ctx, listId, propertyId);
    if (!latest.ok) return latest;
    return batchRows(result, writes.length - 1).length || same(latest.value) ? latest : { ok: false, reason: "conflict" };
  } catch {
    try { const latest = await getPropertyListProperty(ctx, listId, propertyId); if (latest.ok && same(latest.value)) return latest; if (!latest.ok && latest.reason !== "unavailable") return latest; } catch { /* No submitted research enters diagnostics. */ }
    return { ok: false, reason: "unavailable" };
  }
}

/** Copy/move needs no feed data. The reviewed private snapshot and all receipts commit together. */
export async function transferProperty(ctx: Ctx, sourceListId: string, propertyId: string, input: unknown, now = new Date()): Promise<PropertyServiceResult<PropertyTransferResult>> {
  if (ctx.actor.role === "member") return { ok: false, reason: "forbidden" };
  if (!isRecordId(sourceListId) || !isRecordId(propertyId)) return { ok: false, reason: "not_found" };
  const parsed = propertyTransferInputSchema.safeParse(input); if (!parsed.success || parsed.data.targetListId === sourceListId) return { ok: false, reason: "invalid_property_transfer" };
  const d = parsed.data, payloadHash = createPayloadHash({ sourceListId, propertyId, ...d });
  const receiptWhere = and(eq(propertyTransferRequests.actorUserId, ctx.actor.userId), eq(propertyTransferRequests.requestId, d.requestId));
  const replay = async (): Promise<PropertyServiceResult<PropertyTransferResult> | null> => {
    const [receipt] = await ctx.db.select().from(propertyTransferRequests).where(receiptWhere).limit(1); if (!receipt) return null;
    for (const id of [receipt.sourceListId, receipt.targetListId]) { const scope = await loadPropertyList(ctx, id); if (!scope.ok) return scope; if (!scope.value.writable) return { ok: false, reason: "forbidden" }; }
    if (receipt.payloadHash !== payloadHash) return { ok: false, reason: "request_conflict" };
    const row = await rowFor(ctx, receipt.targetListId, receipt.result.propertyId);
    return row ? { ok: true, value: { property: propertyReferenceView(row), sourceRemoved: receipt.result.sourceRemoved, targetListId: receipt.targetListId } } : { ok: false, reason: "conflict" };
  };
  const previous = await replay(); if (previous) return previous;
  const failOrReplay = async (reason: PropertyFailure): Promise<PropertyServiceResult<PropertyTransferResult>> => {
    try { return await replay() ?? { ok: false, reason }; } catch { return { ok: false, reason: "unavailable" }; }
  };
  const source = await loadPropertyList(ctx, sourceListId); if (!source.ok) return failOrReplay(source.reason);
  const target = await loadPropertyList(ctx, d.targetListId); if (!target.ok) return failOrReplay(target.reason);
  if (!source.value.writable || !target.value.writable) return { ok: false, reason: "forbidden" };
  const row = await rowFor(ctx, sourceListId, propertyId); if (!row) return failOrReplay("not_found");
  if (!revisionMatches(row.updatedAt, d.expectedUpdatedAt)) return failOrReplay("conflict");
  const duplicateWhere = and(eq(contactProperties.listId, d.targetListId), eq(contactProperties.dataset, row.dataset), eq(contactProperties.listingId, row.listingId), isNull(contactProperties.removedAt));
  const [duplicate] = await ctx.db.select({ id: contactProperties.id }).from(contactProperties).where(duplicateWhere).limit(1);
  if (duplicate) return failOrReplay("target_has_property");
  const scopes = [source.value, target.value], listIds = [sourceListId, d.targetListId].sort(), contactIds = [...new Set(scopes.flatMap(scope => scope.row.contactId ? [scope.row.contactId] : []))].sort();
  const targetId = randomUUID(), result = { propertyId: targetId, sourceRemoved: d.mode === "move", targetListId: d.targetListId };
  const guard = sql`${scopes.map(scope => sql`exists(select 1 from ${propertyLists} where ${propertyListMutationGuard(ctx, scope)})`).reduce((a, b) => sql`${a} and ${b}`)}
    and exists(select 1 from ${contactProperties} where ${and(eq(contactProperties.id, propertyId), eq(contactProperties.listId, sourceListId), isNull(contactProperties.removedAt), propertyRevision(d.expectedUpdatedAt))})
    and not exists(select 1 from ${contactProperties} where ${duplicateWhere})`;
  const writes = [];
  if (contactIds.length) writes.push(ctx.db.select({ id: contacts.id }).from(contacts).where(and(inArray(contacts.id, contactIds), visibleTo(ctx.actor))).orderBy(contacts.id).for("update"));
  writes.push(ctx.db.select({ id: propertyLists.id }).from(propertyLists).where(and(inArray(propertyLists.id, listIds), propertyListVisibility(ctx))).orderBy(propertyLists.id).for("update"));
  writes.push(ctx.db.select({ id: contactProperties.id }).from(contactProperties).where(or(and(eq(contactProperties.listId, sourceListId), eq(contactProperties.id, propertyId)), duplicateWhere)).orderBy(contactProperties.id).for("update"));
  writes.push(ctx.db.insert(propertyTransferRequests).values({ actorUserId: ctx.actor.userId, requestId: d.requestId, sourceListId, targetListId: d.targetListId, sourcePropertyId: propertyId,
    payloadHash: sql`case when ${guard} then ${payloadHash}::text else null end`, result, createdAt: now }));
  writes.push(ctx.db.insert(contactProperties).values({ id: targetId, listId: d.targetListId, contactId: target.value.row.contactId, dataset: row.dataset, listingId: row.listingId, mlsNumber: row.mlsNumber,
    createdByUserId: ctx.actor.userId, createdAt: now, removedAt: null, notes: row.notes, reviewStatus: row.reviewStatus, updatedAt: now }));
  if (d.mode === "move") writes.push(ctx.db.update(contactProperties).set({ removedAt: now, updatedAt: nextPropertyUpdatedAt(now) }).where(and(eq(contactProperties.id, propertyId), eq(contactProperties.listId, sourceListId))));
  writes.push(ctx.db.update(propertyLists).set({ updatedAt: propertyListNextUpdatedAt(now) }).where(inArray(propertyLists.id, d.mode === "move" ? listIds : [d.targetListId])));
  for (const scope of scopes) writes.push(ctx.db.insert(auditEvents).values({ eventType: "property_list_updated", actorUserId: ctx.actor.userId, safeMetadata: {
    listId: scope.row.id, contactId: scope.row.contactId, propertyId: scope.row.id === sourceListId ? propertyId : targetId,
    sourceListId, targetListId: d.targetListId, sourcePropertyId: propertyId, targetPropertyId: targetId, action: d.mode,
  }, createdAt: now }));
  try { await ctx.db.batch(writes as unknown as BatchInput); }
  catch (error) {
    const recovered = await replay(); if (recovered) return recovered;
    for (const id of listIds) { const current = await loadPropertyList(ctx, id); if (!current.ok) return current; if (!current.value.writable) return { ok: false, reason: "forbidden" }; }
    const [currentDuplicate] = await ctx.db.select({ id: contactProperties.id }).from(contactProperties).where(duplicateWhere).limit(1);
    if (currentDuplicate) return { ok: false, reason: "target_has_property" };
    let cause: unknown = error;
    for (let depth = 0; cause && typeof cause === "object" && depth < 6; depth++) { const value = cause as { code?: string; table?: string; column?: string; cause?: unknown }; if (value.code === "23502" && value.table === "property_transfer_requests" && value.column === "payload_hash") return { ok: false, reason: "conflict" }; cause = value.cause; }
    return { ok: false, reason: "unavailable" };
  }
  return await replay() ?? { ok: false, reason: "unavailable" };
}
