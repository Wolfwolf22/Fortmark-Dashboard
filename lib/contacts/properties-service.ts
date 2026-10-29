import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql, type SQLWrapper } from "drizzle-orm";
import { isRecordId } from "../db/ids.ts";
import { auditEvents, contactProperties, contacts, type ContactPropertyRow } from "../db/schema.ts";
import { loadContact } from "./access.ts";
import type { Ctx, ServiceFailure } from "./service.ts";
import { visibleTo } from "./visibility.ts";
import {
  addPropertyInputSchema, propertyLookupInputSchema, normalizePropertyMlsNumber, isPropertyListingId, isPropertyDataset,
  MAX_PROPERTY_PAGE_SIZE, PROPERTY_PAGE_SIZE,
  type PropertyLookup, type PropertyMlsProvider, type PropertyPage, type PropertyResolution, type PropertyView,
} from "./properties.ts";

export type PropertyFailure = ServiceFailure | "invalid_property" | "listing_not_found" | "ambiguous" | "not_configured" | "listing_changed";
export type PropertyServiceResult<T> = { ok: true; value: T } | { ok: false; reason: PropertyFailure };
type BatchInput = Parameters<Ctx["db"]["batch"]>[0];

function validResolution(result: PropertyResolution): result is Extract<PropertyResolution, { ok: true }> {
  return Boolean(result?.ok && result.value?.listing && isPropertyDataset(result.value.dataset) && result.value.listing.source === "mls"
    && isPropertyListingId(result.value.listing.id) && normalizePropertyMlsNumber(result.value.listing.mlsNumber) !== null);
}
async function safeResolve(work: () => Promise<PropertyResolution>): Promise<PropertyResolution> {
  try {
    const result = await work();
    return validResolution(result) || result?.ok === false && ["not_found", "unavailable", "not_configured", "ambiguous"].includes(result.reason)
      ? result : { ok: false, reason: "unavailable" };
  } catch { return { ok: false, reason: "unavailable" }; }
}
function resolutionFailure(result: PropertyResolution): PropertyFailure {
  if (result.ok) return "unavailable";
  return result.reason === "not_found" ? "listing_not_found" : result.reason;
}
function view(row: ContactPropertyRow, result: PropertyResolution, checkedAt: Date): PropertyView {
  const available = validResolution(result) && result.value.dataset === row.dataset && result.value.listing.id === row.listingId;
  const status = available ? "available" : result.ok ? "not_found" : result.reason === "ambiguous" ? "unavailable" : result.reason;
  return {
    id: row.id, contactId: row.contactId, mlsNumber: row.mlsNumber, listingId: row.listingId, addedAt: row.createdAt.toISOString(),
    listing: available ? result.value.listing : null, syncStatus: status, checkedAt: checkedAt.toISOString(),
  };
}

/** Keep feed fan-out fixed even when a client asks for the largest permitted page. */
async function hydrate(rows: ContactPropertyRow[], provider: PropertyMlsProvider, now: Date): Promise<PropertyView[]> {
  const items = new Array<PropertyView>(rows.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
    while (next < rows.length) {
      const index = next++, row = rows[index];
      const result = await safeResolve(() => provider.get(row.dataset, row.listingId, row.mlsNumber));
      items[index] = view(row, result, now);
    }
  }));
  return items;
}

/** A refreshed page reads current MLS fields; no feed failure removes a saved reference. */
export async function getContactProperties(ctx: Ctx, contactId: string, provider: PropertyMlsProvider, options: { page?: number; pageSize?: number } = {}, now = new Date()): Promise<PropertyServiceResult<PropertyPage>> {
  const access = await loadContact(ctx, contactId);
  if (!access.ok) return access;
  const page = options.page ?? 1, pageSize = options.pageSize ?? PROPERTY_PAGE_SIZE;
  if (!Number.isInteger(page) || page < 1 || page > 1_000_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PROPERTY_PAGE_SIZE) return { ok: false, reason: "invalid_property" };
  const where = and(eq(contactProperties.contactId, contactId), isNull(contactProperties.removedAt));
  const [count] = await ctx.db.select({ total: sql<number>`count(*)::int` }).from(contactProperties).where(where);
  const total = count?.total ?? 0, actualPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  const rows = await ctx.db.select().from(contactProperties).where(where)
    .orderBy(desc(contactProperties.createdAt), desc(contactProperties.id)).limit(pageSize).offset((actualPage - 1) * pageSize);
  return { ok: true, value: { items: await hydrate(rows, provider, now), total, page: actualPage, pageSize } };
}

/** Lookup is an explicit write-capable workflow step, not a broad MLS search. */
export async function lookupContactProperty(ctx: Ctx, contactId: string, input: unknown, provider: PropertyMlsProvider): Promise<PropertyServiceResult<PropertyLookup>> {
  const access = await loadContact(ctx, contactId);
  if (!access.ok) return access;
  if (!access.writable) return { ok: false, reason: "forbidden" };
  const parsed = propertyLookupInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_property" };
  const result = await safeResolve(() => provider.lookup(parsed.data.mlsNumber));
  if (!validResolution(result)) return { ok: false, reason: resolutionFailure(result) };
  if (normalizePropertyMlsNumber(result.value.listing.mlsNumber) !== parsed.data.mlsNumber) return { ok: false, reason: "listing_not_found" };
  const [saved] = await ctx.db.select({ id: contactProperties.id }).from(contactProperties).where(and(
    eq(contactProperties.contactId, contactId), eq(contactProperties.dataset, result.value.dataset), eq(contactProperties.listingId, result.value.listing.id), isNull(contactProperties.removedAt),
  )).limit(1);
  return { ok: true, value: { dataset: result.value.dataset, listing: result.value.listing, alreadySaved: Boolean(saved) } };
}

/** Every mutation locks/rechecks the original visible parent before its child write. */
function parentGuard(ctx: Ctx, contactId: string, owner: string) {
  return and(eq(contacts.id, contactId), eq(contacts.assignedAgentUserId, owner), visibleTo(ctx.actor));
}
function firstBatchRows(result: unknown): readonly unknown[] {
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : [];
}
function auditFromChanged(ctx: Ctx, changed: { id: SQLWrapper; contactId: SQLWrapper }, action: "add" | "remove", now: Date) {
  return {
    id: sql<string>`${randomUUID()}::uuid`.as("id"), actorUserId: sql<string>`${ctx.actor.userId}::uuid`.as("actor_user_id"), targetUserId: sql<null>`null::uuid`.as("target_user_id"),
    eventType: sql<string>`'contact_updated'::text`.as("event_type"),
    safeMetadata: sql<Record<string, unknown>>`jsonb_build_object('contactId', ${changed.contactId}, 'propertyId', ${changed.id}, 'action', ${action}::text)`.as("safe_metadata"),
    createdAt: sql<Date>`${now.toISOString()}::timestamptz`.as("created_at"),
  };
}

/** Revalidate exact identity server-side. The browser supplies no listing data to persist. */
export async function addContactProperty(ctx: Ctx, contactId: string, input: unknown, provider: PropertyMlsProvider, now = new Date()): Promise<PropertyServiceResult<PropertyView>> {
  const access = await loadContact(ctx, contactId);
  if (!access.ok) return access;
  if (!access.writable) return { ok: false, reason: "forbidden" };
  const parsed = addPropertyInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_property" };
  const result = await safeResolve(() => provider.lookup(parsed.data.mlsNumber));
  if (!validResolution(result)) return { ok: false, reason: resolutionFailure(result) };
  const { listing, dataset } = result.value;
  if (dataset !== parsed.data.expectedDataset || normalizePropertyMlsNumber(listing.mlsNumber) !== parsed.data.mlsNumber || listing.id !== parsed.data.expectedListingId) return { ok: false, reason: "listing_changed" };
  const id = randomUUID(), guard = parentGuard(ctx, contactId, access.row.assignedAgentUserId);
  const inserted = ctx.db.$with("property_changed").as(ctx.db.insert(contactProperties).select(ctx.db.select({
    id: sql<string>`${id}::uuid`.as("id"), contactId: sql<string>`${contactId}::uuid`.as("contact_id"), dataset: sql<string>`${dataset}::text`.as("dataset"), listingId: sql<string>`${listing.id}::text`.as("listing_id"),
    mlsNumber: sql<string>`${parsed.data.mlsNumber}::text`.as("mls_number"), createdByUserId: sql<string>`${ctx.actor.userId}::uuid`.as("created_by_user_id"), createdAt: sql<Date>`${now.toISOString()}::timestamptz`.as("created_at"), removedAt: sql<null>`null::timestamptz`.as("removed_at"),
  }).from(contacts).where(guard)).onConflictDoNothing().returning({ id: contactProperties.id, contactId: contactProperties.contactId }));
  try {
    const writes = [ctx.db.select({ id: contacts.id }).from(contacts).where(guard).for("update"),
      ctx.db.with(inserted).insert(auditEvents).select(ctx.db.select(auditFromChanged(ctx, inserted, "add", now)).from(inserted))];
    const completed = await ctx.db.batch(writes as unknown as BatchInput);
    if (!firstBatchRows(completed).length) return { ok: false, reason: "conflict" };
  } catch { return { ok: false, reason: "unavailable" }; }
  const [row] = await ctx.db.select().from(contactProperties).where(and(eq(contactProperties.contactId, contactId), eq(contactProperties.dataset, dataset), eq(contactProperties.listingId, listing.id), isNull(contactProperties.removedAt))).limit(1);
  return row ? { ok: true, value: view(row, result, now) } : { ok: false, reason: "conflict" };
}

/** Soft remove, with an audit only for the actual state change. Repeated removal is harmless. */
export async function removeContactProperty(ctx: Ctx, contactId: string, propertyId: string, now = new Date()): Promise<PropertyServiceResult<{ removed: true }>> {
  const access = await loadContact(ctx, contactId);
  if (!access.ok) return access;
  if (!access.writable) return { ok: false, reason: "forbidden" };
  if (!isRecordId(propertyId)) return { ok: false, reason: "not_found" };
  const [row] = await ctx.db.select().from(contactProperties).where(and(eq(contactProperties.id, propertyId), eq(contactProperties.contactId, contactId))).limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.removedAt) return { ok: true, value: { removed: true } };
  const guard = parentGuard(ctx, contactId, access.row.assignedAgentUserId);
  const changed = ctx.db.$with("property_changed").as(ctx.db.update(contactProperties).set({ removedAt: now }).where(and(
    eq(contactProperties.id, propertyId), eq(contactProperties.contactId, contactId), isNull(contactProperties.removedAt), sql`exists(select 1 from ${contacts} where ${guard})`,
  )).returning({ id: contactProperties.id, contactId: contactProperties.contactId }));
  try {
    const writes = [ctx.db.select({ id: contacts.id }).from(contacts).where(guard).for("update"),
      ctx.db.with(changed).insert(auditEvents).select(ctx.db.select(auditFromChanged(ctx, changed, "remove", now)).from(changed))];
    const completed = await ctx.db.batch(writes as unknown as BatchInput);
    return firstBatchRows(completed).length ? { ok: true, value: { removed: true } } : { ok: false, reason: "conflict" };
  } catch { return { ok: false, reason: "unavailable" }; }
}
