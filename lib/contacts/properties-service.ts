import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql, type SQLWrapper } from "drizzle-orm";
import { isRecordId } from "../db/ids.ts";
import { auditEvents, contactProperties, propertyLists, type ContactPropertyRow } from "../db/schema.ts";
import { loadContact } from "./access.ts";
import { revisionMatches } from "./reliability.ts";
import type { Ctx, ServiceFailure } from "./service.ts";
import { batchRows, getContactDefaultPropertyList, loadPropertyList, propertyListMutationGuard, propertyListMutationLocks, propertyListNextUpdatedAt } from "./property-lists-service.ts";
import {
  addPropertyInputSchema, propertyLookupInputSchema, normalizePropertyMlsNumber, isPropertyListingId, isPropertyDataset,
  MAX_PROPERTY_PAGE_SIZE, PROPERTY_PAGE_SIZE,
  type PropertyLookup, type PropertyMlsProvider, type PropertyPage, type PropertyResolution, type PropertyView,
} from "./properties.ts";
import { applyPropertyPriceOrder, PROPERTY_REVIEW_STATUSES, PROPERTY_SORTS, type PropertyReadOptions, type PropertyReviewStatus } from "./property-research.ts";

export type PropertyFailure = ServiceFailure | "invalid_property" | "invalid_property_list" | "invalid_property_research" | "invalid_property_transfer" | "invalid_share_recipient" | "list_in_use" | "target_has_property" | "listing_not_found" | "ambiguous" | "not_configured" | "listing_changed";
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
export function propertyReferenceView(row: ContactPropertyRow): PropertyView {
  return { id: row.id, listId: row.listId, contactId: row.contactId, mlsNumber: row.mlsNumber, listingId: row.listingId, addedAt: row.createdAt.toISOString(),
    notes: row.notes, reviewStatus: row.reviewStatus as PropertyReviewStatus, updatedAt: row.updatedAt.toISOString(), listing: null, syncStatus: "unavailable", checkedAt: null };
}
function view(row: ContactPropertyRow, result: PropertyResolution, checkedAt: Date): PropertyView {
  const available = validResolution(result) && result.value.dataset === row.dataset && result.value.listing.id === row.listingId;
  const status = available ? "available" : result.ok ? "not_found" : result.reason === "ambiguous" ? "unavailable" : result.reason;
  return {
    ...propertyReferenceView(row),
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
export async function getPropertyListProperties(ctx: Ctx, listId: string, provider: PropertyMlsProvider, options: PropertyReadOptions = {}, now = new Date()): Promise<PropertyServiceResult<PropertyPage>> {
  const access = await loadPropertyList(ctx, listId);
  if (!access.ok) return access;
  const page = options.page ?? 1, pageSize = options.pageSize ?? PROPERTY_PAGE_SIZE, reviewStatus = options.reviewStatus ?? "all", sort = options.sort ?? "added_desc";
  if (!Number.isInteger(page) || page < 1 || page > 1_000_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PROPERTY_PAGE_SIZE
    || reviewStatus !== "all" && !(PROPERTY_REVIEW_STATUSES as readonly string[]).includes(reviewStatus) || !(PROPERTY_SORTS as readonly string[]).includes(sort)) return { ok: false, reason: "invalid_property" };
  const base = and(eq(contactProperties.listId, listId), isNull(contactProperties.removedAt));
  const status = reviewStatus === "all" ? sql`true` : eq(contactProperties.reviewStatus, reviewStatus);
  const where = and(base, status);
  const [count] = await ctx.db.select({ total: sql<number>`count(*) filter(where ${status})::int`, totalAll: sql<number>`count(*)::int` }).from(contactProperties).where(base);
  let total = count?.total ?? 0;
  let actualPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  let rows: ContactPropertyRow[];
  if (sort === "price_asc" || sort === "price_desc") {
    if (total > 1000) return { ok: false, reason: "unavailable" };
    const refs = await ctx.db.select({ id: contactProperties.id, dataset: contactProperties.dataset, listingId: contactProperties.listingId }).from(contactProperties).where(where).orderBy(desc(contactProperties.createdAt), desc(contactProperties.id)).limit(1001);
    if (refs.length > 1000) return { ok: false, reason: "unavailable" };
    total = refs.length; actualPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    if (!refs.length) rows = [];
    else {
      if (!provider.orderByPrice) return { ok: false, reason: "unavailable" };
      let order;
      try { order = await provider.orderByPrice(refs, sort === "price_asc" ? "asc" : "desc"); } catch { return { ok: false, reason: "unavailable" }; }
      if (!order.ok) return { ok: false, reason: order.reason };
      const ordered = applyPropertyPriceOrder(refs, order.ids); if (!ordered) return { ok: false, reason: "unavailable" };
      const ids = ordered.slice((actualPage - 1) * pageSize, actualPage * pageSize).map(ref => ref.id);
      const found = ids.length ? await ctx.db.select().from(contactProperties).where(and(where, inArray(contactProperties.id, ids))) : [];
      const byId = new Map(found.map(row => [row.id, row])); rows = ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
    }
  } else {
    const direction = sort === "added_asc" ? asc : desc;
    rows = await ctx.db.select().from(contactProperties).where(where).orderBy(direction(contactProperties.createdAt), direction(contactProperties.id)).limit(pageSize).offset((actualPage - 1) * pageSize);
  }
  const hydrated = await hydrate(rows, provider, now), current = await loadPropertyList(ctx, listId);
  if (!current.ok) return current;
  return { ok: true, value: { items: hydrated.map(item => current.value.contact ? item : { ...item, contactId: null }), total, totalAll: count?.totalAll ?? 0, page: actualPage, pageSize } };
}

/** A scoped single research read stays available when the feed is offline or the grid filter changed. */
export async function getPropertyListProperty(ctx: Ctx, listId: string, propertyId: string): Promise<PropertyServiceResult<PropertyView>> {
  const access = await loadPropertyList(ctx, listId); if (!access.ok) return access;
  if (!isRecordId(propertyId)) return { ok: false, reason: "not_found" };
  const [row] = await ctx.db.select().from(contactProperties).where(and(eq(contactProperties.id, propertyId), eq(contactProperties.listId, listId), isNull(contactProperties.removedAt))).limit(1);
  return row ? { ok: true, value: { ...propertyReferenceView(row), contactId: access.value.contact ? row.contactId : null } } : { ok: false, reason: "not_found" };
}

/** Lookup is an explicit write-capable workflow step, not a broad MLS search. */
export async function lookupPropertyListProperty(ctx: Ctx, listId: string, input: unknown, provider: PropertyMlsProvider): Promise<PropertyServiceResult<PropertyLookup>> {
  const access = await loadPropertyList(ctx, listId);
  if (!access.ok) return access;
  if (!access.value.writable) return { ok: false, reason: "forbidden" };
  const parsed = propertyLookupInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_property" };
  const result = await safeResolve(() => provider.lookup(parsed.data.mlsNumber));
  if (!validResolution(result)) return { ok: false, reason: resolutionFailure(result) };
  if (normalizePropertyMlsNumber(result.value.listing.mlsNumber) !== parsed.data.mlsNumber) return { ok: false, reason: "listing_not_found" };
  const [saved] = await ctx.db.select({ id: contactProperties.id }).from(contactProperties).where(and(
    eq(contactProperties.listId, listId), eq(contactProperties.dataset, result.value.dataset), eq(contactProperties.listingId, result.value.listing.id), isNull(contactProperties.removedAt),
  )).limit(1);
  return { ok: true, value: { dataset: result.value.dataset, listing: result.value.listing, alreadySaved: Boolean(saved) } };
}

function auditFromChanged(ctx: Ctx, changed: { id: SQLWrapper; listId: SQLWrapper; contactId: SQLWrapper }, action: "add" | "remove", now: Date) {
  return {
    id: sql<string>`${randomUUID()}::uuid`.as("id"), actorUserId: sql<string>`${ctx.actor.userId}::uuid`.as("actor_user_id"), targetUserId: sql<null>`null::uuid`.as("target_user_id"),
    eventType: sql<string>`'property_list_updated'::text`.as("event_type"),
    safeMetadata: sql<Record<string, unknown>>`jsonb_build_object('listId',${changed.listId},'contactId', ${changed.contactId}, 'propertyId', ${changed.id}, 'action', ${action}::text)`.as("safe_metadata"),
    createdAt: sql<Date>`${now.toISOString()}::timestamptz`.as("created_at"),
  };
}

/** Revalidate exact identity server-side. The browser supplies no listing data to persist. */
export async function addPropertyListProperty(ctx: Ctx, listId: string, input: unknown, provider: PropertyMlsProvider, now = new Date()): Promise<PropertyServiceResult<PropertyView>> {
  const access = await loadPropertyList(ctx, listId);
  if (!access.ok) return access;
  if (!access.value.writable) return { ok: false, reason: "forbidden" };
  const parsed = addPropertyInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_property" };
  const result = await safeResolve(() => provider.lookup(parsed.data.mlsNumber));
  if (!validResolution(result)) return { ok: false, reason: resolutionFailure(result) };
  const { listing, dataset } = result.value;
  if (dataset !== parsed.data.expectedDataset || normalizePropertyMlsNumber(listing.mlsNumber) !== parsed.data.mlsNumber || listing.id !== parsed.data.expectedListingId) return { ok: false, reason: "listing_changed" };
  const id = randomUUID(), scope = access.value, guard = propertyListMutationGuard(ctx, scope);
  const inserted = ctx.db.$with("property_changed").as(ctx.db.insert(contactProperties).select(ctx.db.select({
    id: sql<string>`${id}::uuid`.as("id"), listId: sql<string>`${listId}::uuid`.as("list_id"), contactId: sql<string | null>`${scope.row.contactId}::uuid`.as("contact_id"), dataset: sql<string>`${dataset}::text`.as("dataset"), listingId: sql<string>`${listing.id}::text`.as("listing_id"),
    mlsNumber: sql<string>`${parsed.data.mlsNumber}::text`.as("mls_number"), createdByUserId: sql<string>`${ctx.actor.userId}::uuid`.as("created_by_user_id"), createdAt: sql<Date>`${now.toISOString()}::timestamptz`.as("created_at"), removedAt: sql<null>`null::timestamptz`.as("removed_at"),
    notes: sql<string>`''::text`.as("notes"), reviewStatus: sql<string>`'to_review'::text`.as("review_status"), updatedAt: sql<Date>`${now.toISOString()}::timestamptz`.as("updated_at"),
  }).from(propertyLists).where(guard)).onConflictDoNothing().returning({ id: contactProperties.id, listId: contactProperties.listId, contactId: contactProperties.contactId }));
  const touched = ctx.db.$with("list_touched").as(ctx.db.update(propertyLists).set({ updatedAt: propertyListNextUpdatedAt(now) }).where(and(eq(propertyLists.id, listId), sql`exists(select 1 from ${inserted})`)).returning({ id: propertyLists.id }));
  try {
    const locks = propertyListMutationLocks(ctx, scope);
    const writes = [...locks, ctx.db.with(inserted, touched).insert(auditEvents).select(ctx.db.select(auditFromChanged(ctx, inserted, "add", now)).from(inserted))];
    const completed = await ctx.db.batch(writes as unknown as BatchInput);
    if (!batchRows(completed, locks.length - 1).length) return { ok: false, reason: "conflict" };
  } catch { return { ok: false, reason: "unavailable" }; }
  const [row] = await ctx.db.select().from(contactProperties).where(and(eq(contactProperties.listId, listId), eq(contactProperties.dataset, dataset), eq(contactProperties.listingId, listing.id), isNull(contactProperties.removedAt))).limit(1);
  return row ? { ok: true, value: view(row, result, now) } : { ok: false, reason: "conflict" };
}

/** Soft remove, with an audit only for the actual state change. Repeated removal is harmless. */
export async function removePropertyListProperty(ctx: Ctx, listId: string, propertyId: string, now = new Date(), expectedUpdatedAt?: string): Promise<PropertyServiceResult<{ removed: true }>> {
  const access = await loadPropertyList(ctx, listId);
  if (!access.ok) return access;
  if (!access.value.writable) return { ok: false, reason: "forbidden" };
  if (!isRecordId(propertyId)) return { ok: false, reason: "not_found" };
  const [row] = await ctx.db.select().from(contactProperties).where(and(eq(contactProperties.id, propertyId), eq(contactProperties.listId, listId))).limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.removedAt) return { ok: true, value: { removed: true } };
  if (expectedUpdatedAt !== undefined && !revisionMatches(row.updatedAt, expectedUpdatedAt)) return { ok: false, reason: "conflict" };
  const scope = access.value, guard = propertyListMutationGuard(ctx, scope);
  const changed = ctx.db.$with("property_changed").as(ctx.db.update(contactProperties).set({ removedAt: now, updatedAt: sql`greatest(date_trunc('milliseconds',${contactProperties.updatedAt}) + interval '1 millisecond',${now.toISOString()}::timestamptz)` }).where(and(
    eq(contactProperties.id, propertyId), eq(contactProperties.listId, listId), isNull(contactProperties.removedAt), expectedUpdatedAt ? sql`date_trunc('milliseconds',${contactProperties.updatedAt})=${expectedUpdatedAt}::timestamptz` : undefined, sql`exists(select 1 from ${propertyLists} where ${guard})`,
  )).returning({ id: contactProperties.id, listId: contactProperties.listId, contactId: contactProperties.contactId }));
  const touched = ctx.db.$with("list_touched").as(ctx.db.update(propertyLists).set({ updatedAt: propertyListNextUpdatedAt(now) }).where(and(eq(propertyLists.id, listId), sql`exists(select 1 from ${changed})`)).returning({ id: propertyLists.id }));
  try {
    const locks = propertyListMutationLocks(ctx, scope);
    const writes = [...locks, ctx.db.with(changed, touched).insert(auditEvents).select(ctx.db.select(auditFromChanged(ctx, changed, "remove", now)).from(changed)).returning({ id: auditEvents.id })];
    const completed = await ctx.db.batch(writes as unknown as BatchInput);
    if (!batchRows(completed, locks.length - 1).length) return { ok: false, reason: "conflict" };
    if (batchRows(completed, writes.length - 1).length) return { ok: true, value: { removed: true } };
    const [latest] = await ctx.db.select({ removedAt: contactProperties.removedAt }).from(contactProperties).where(and(eq(contactProperties.id, propertyId), eq(contactProperties.listId, listId))).limit(1);
    return latest?.removedAt ? { ok: true, value: { removed: true } } : { ok: false, reason: "conflict" };
  } catch { return { ok: false, reason: "unavailable" }; }
}

// Compatibility is intentionally confined to one owner-private default list.
export async function getContactProperties(ctx: Ctx, contactId: string, provider: PropertyMlsProvider, options: PropertyReadOptions = {}, now = new Date()): Promise<PropertyServiceResult<PropertyPage>> {
  const list = await getContactDefaultPropertyList(ctx, contactId); if (!list.ok) return list;
  if (list.value) return getPropertyListProperties(ctx, list.value.row.id, provider, options, now);
  const pageSize = options.pageSize ?? PROPERTY_PAGE_SIZE, page = options.page ?? 1;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PROPERTY_PAGE_SIZE || !Number.isInteger(page) || page < 1 || page > 1_000_000) return { ok: false, reason: "invalid_property" };
  if (options.reviewStatus !== undefined && options.reviewStatus !== "all" && !(PROPERTY_REVIEW_STATUSES as readonly string[]).includes(options.reviewStatus) || options.sort !== undefined && !(PROPERTY_SORTS as readonly string[]).includes(options.sort)) return { ok: false, reason: "invalid_property" };
  return { ok: true, value: { items: [], total: 0, totalAll: 0, page: 1, pageSize } };
}
export async function lookupContactProperty(ctx: Ctx, contactId: string, input: unknown, provider: PropertyMlsProvider): Promise<PropertyServiceResult<PropertyLookup>> {
  const parent = await loadContact(ctx, contactId); if (!parent.ok) return parent;
  if (!parent.writable) return { ok: false, reason: "forbidden" };
  const list = await getContactDefaultPropertyList(ctx, contactId); if (!list.ok) return list;
  if (list.value) return lookupPropertyListProperty(ctx, list.value.row.id, input, provider);
  const parsed = propertyLookupInputSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_property" };
  const result = await safeResolve(() => provider.lookup(parsed.data.mlsNumber));
  if (!validResolution(result)) return { ok: false, reason: resolutionFailure(result) };
  return normalizePropertyMlsNumber(result.value.listing.mlsNumber) === parsed.data.mlsNumber
    ? { ok: true, value: { ...result.value, alreadySaved: false } } : { ok: false, reason: "listing_not_found" };
}
export async function addContactProperty(ctx: Ctx, contactId: string, input: unknown, provider: PropertyMlsProvider, now = new Date()): Promise<PropertyServiceResult<PropertyView>> {
  const parent = await loadContact(ctx, contactId); if (!parent.ok) return parent;
  if (!parent.writable) return { ok: false, reason: "forbidden" };
  const parsed = addPropertyInputSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_property" };
  const result = await safeResolve(() => provider.lookup(parsed.data.mlsNumber));
  if (!validResolution(result)) return { ok: false, reason: resolutionFailure(result) };
  if (result.value.dataset !== parsed.data.expectedDataset || result.value.listing.id !== parsed.data.expectedListingId || normalizePropertyMlsNumber(result.value.listing.mlsNumber) !== parsed.data.mlsNumber) return { ok: false, reason: "listing_changed" };
  const list = await getContactDefaultPropertyList(ctx, contactId, true, now); if (!list.ok) return list.reason === "not_found" ? { ok: false, reason: "conflict" } : list;
  return list.value ? addPropertyListProperty(ctx, list.value.row.id, parsed.data, { ...provider, lookup: async () => result }, now) : { ok: false, reason: "conflict" };
}
export async function removeContactProperty(ctx: Ctx, contactId: string, propertyId: string, now = new Date()): Promise<PropertyServiceResult<{ removed: true }>> {
  const parent = await loadContact(ctx, contactId); if (!parent.ok) return parent;
  if (!parent.writable) return { ok: false, reason: "forbidden" };
  const list = await getContactDefaultPropertyList(ctx, contactId); if (!list.ok) return list;
  return list.value ? removePropertyListProperty(ctx, list.value.row.id, propertyId, now) : { ok: false, reason: "not_found" };
}
