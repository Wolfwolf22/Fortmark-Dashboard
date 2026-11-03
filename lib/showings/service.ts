import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { auditEvents, contacts, contactActivities, contactProperties, dashboardUsers, propertyLists, savedShowingTours, savedTourStops, showings, showingMutationRequests, type ShowingRow, type ContactRow } from "../db/schema.ts";
import { isRecordId } from "../db/ids.ts";
import { loadContact } from "../contacts/access.ts";
import type { NextActionKind } from "../contacts/next-action.ts";
import { visibleTo } from "../contacts/visibility.ts";
import { createPayloadHash, revisionMatches, nextContactUpdatedAt } from "../contacts/reliability.ts";
import { loadPropertyList, propertyListMutationGuard, propertyListVisibility, propertyListNextUpdatedAt, type PropertyListScope } from "../contacts/property-lists-service.ts";
import { propertyRevision, nextPropertyUpdatedAt } from "../contacts/property-research-service.ts";
import type { PropertyReviewStatus } from "../contacts/property-research.ts";
import type { PropertyMlsProvider, PropertyResolution } from "../contacts/properties.ts";
import { normalizePropertyMlsNumber } from "../contacts/properties.ts";
import type { Ctx, ServiceFailure } from "../contacts/service.ts";
import { checkShowingSchedule, checkShowingVisit, createShowingInputSchema, showingMutationSchema, readShowingQuery,
  type ShowingView, type ShowingStatus, type ShowingQuery, type ShowingsPage, type ShowingAgenda, type ShowingSummary, type ShowingNextActionsPage,
} from "./domain.ts";

export type ShowingFailure = ServiceFailure | "invalid_showing" | "invalid_showing_query" | "time_conflict" | "property_conflict";
export type ShowingResult<T> = { ok: true; value: T } | { ok: false; reason: ShowingFailure };
type BatchInput = Parameters<Ctx["db"]["batch"]>[0];
type BatchWrite = BatchInput[number];
type Access = { row: ShowingRow; contact: ContactRow; writable: boolean };

/** Appointment ownership never inherits the admin's broader contact visibility. */
export function showingVisibility(ctx: Ctx) {
  return and(eq(showings.ownerUserId, ctx.actor.userId), eq(showings.brokerageKey, ctx.actor.brokerageKey),
    sql`exists(select 1 from ${dashboardUsers} where ${dashboardUsers.id}=${ctx.actor.userId}::uuid and ${dashboardUsers.role}=${ctx.actor.role} and ${dashboardUsers.status}='active')`,
    sql`exists(select 1 from ${contacts} where ${contacts.id}=${showings.contactId} and ${visibleTo(ctx.actor)})`);
}
async function loadShowing(ctx: Ctx, id: string): Promise<ShowingResult<Access>> {
  if (!isRecordId(id)) return { ok: false, reason: "not_found" };
  const [row] = await ctx.db.select().from(showings).where(and(eq(showings.id, id), showingVisibility(ctx))).limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  const parent = await loadContact(ctx, row.contactId); if (!parent.ok) return parent;
  return { ok: true, value: { row, contact: parent.row, writable: ctx.actor.role !== "member" && parent.writable } };
}

/** Project only authorized source-list context; property research notes never enter this DTO. */
async function views(ctx: Ctx, rows: ShowingRow[], provider?: PropertyMlsProvider, now = new Date()): Promise<ShowingView[]> {
  if (!rows.length) return [];
  const contactRows = await ctx.db.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, preferredName: contacts.preferredName }).from(contacts)
    .where(and(inArray(contacts.id, [...new Set(rows.map(row => row.contactId))]), visibleTo(ctx.actor)));
  const names = new Map(contactRows.map(row => [row.id, row.preferredName?.trim() || [row.firstName, row.lastName].filter(Boolean).join(" ").trim() || "Unnamed contact"]));
  const sources = await ctx.db.select({ id: contactProperties.id, listId: contactProperties.listId, listName: propertyLists.name, listOwnerId: propertyLists.ownerUserId, removedAt: contactProperties.removedAt, reviewStatus: contactProperties.reviewStatus, updatedAt: contactProperties.updatedAt })
    .from(contactProperties).innerJoin(propertyLists, eq(propertyLists.id, contactProperties.listId))
    .where(and(inArray(contactProperties.id, [...new Set(rows.map(row => row.sourcePropertyId))]), propertyListVisibility(ctx)));
  const sourceById = new Map(sources.map(row => [row.id, row]));
  const tourRows = await ctx.db.select({ showingId: savedTourStops.linkedShowingId, id: savedShowingTours.id, name: savedShowingTours.name, contactId: savedShowingTours.contactId }).from(savedTourStops).innerJoin(savedShowingTours, eq(savedShowingTours.id, savedTourStops.tourId)).where(and(inArray(savedTourStops.linkedShowingId, rows.map(row => row.id)), eq(savedShowingTours.ownerUserId, ctx.actor.userId), eq(savedShowingTours.brokerageKey, ctx.actor.brokerageKey), isNull(savedShowingTours.archivedAt))).orderBy(savedShowingTours.id);
  const tourByShowing = new Map(tourRows.filter(tour => rows.some(row => row.id === tour.showingId && row.contactId === tour.contactId)).map(tour => [tour.showingId, { id: tour.id, name: tour.name }]));
  const items: ShowingView[] = rows.filter(row => names.has(row.contactId)).map(row => {
    const source = sourceById.get(row.sourcePropertyId), writable = ctx.actor.role !== "member", scheduled = row.status === "scheduled";
    return { id: row.id, contactId: row.contactId, contactName: names.get(row.contactId)!, sourcePropertyId: row.sourcePropertyId,
      dataset: row.dataset, listingId: row.listingId, mlsNumber: row.mlsNumber, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), meetingDetails: row.meetingDetails, notes: row.notes, status: row.status as ShowingStatus,
      feedbackLikes: row.feedbackLikes, feedbackConcerns: row.feedbackConcerns, feedbackSummary: row.feedbackSummary, visitedAt: row.visitedAt?.toISOString() ?? null, cancelReason: row.cancelReason,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      sourceProperty: source ? { id: source.id, listId: source.listId, listName: source.listName, removed: Boolean(source.removedAt), reviewStatus: source.reviewStatus as PropertyReviewStatus, updatedAt: source.updatedAt.toISOString() } : null,
      linkedTour: tourByShowing.get(row.id) ?? null,
      canEdit: writable && scheduled, canComplete: writable && scheduled, canCancel: writable && scheduled, canUpdatePropertyReview: writable && scheduled && Boolean(source && !source.removedAt && source.listOwnerId === ctx.actor.userId),
      listing: null, syncStatus: "unavailable", checkedAt: null };
  });
  if (provider) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++]; let result: PropertyResolution;
        try { result = await provider.get(item.dataset, item.listingId, item.mlsNumber); } catch { result = { ok: false, reason: "unavailable" }; }
        item.checkedAt = now.toISOString();
        if (result?.ok && result.value?.listing?.source === "mls" && result.value.dataset === item.dataset && result.value.listing.id === item.listingId && normalizePropertyMlsNumber(result.value.listing.mlsNumber) === item.mlsNumber) { item.listing = result.value.listing; item.syncStatus = "available"; }
        else item.syncStatus = result?.ok ? "not_found" : result?.reason === "not_found" || result?.reason === "not_configured" ? result.reason : "unavailable";
      }
    }));
  }
  return items;
}
export async function getShowing(ctx: Ctx, id: string, provider?: PropertyMlsProvider): Promise<ShowingResult<ShowingView>> {
  const loaded = await loadShowing(ctx, id); if (!loaded.ok) return loaded;
  const [item] = await views(ctx, [loaded.value.row], provider);
  return item ? { ok: true, value: item } : { ok: false, reason: "not_found" };
}
function queryOf(query: ShowingQuery): ShowingQuery | null {
  return readShowingQuery(new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])));
}
export async function getShowings(ctx: Ctx, query: ShowingQuery, provider?: PropertyMlsProvider, preservePage = false): Promise<ShowingResult<ShowingsPage>> {
  const q = queryOf(query); if (!q) return { ok: false, reason: "invalid_showing_query" };
  if (q.contactId) { const parent = await loadContact(ctx, q.contactId); if (!parent.ok) return parent; }
  const where = and(showingVisibility(ctx), sql`${showings.startsAt}<${q.to}::timestamptz and ${showings.endsAt}>${q.from}::timestamptz`, q.status === "all" ? undefined : eq(showings.status, q.status ?? "scheduled"), q.contactId ? eq(showings.contactId, q.contactId) : undefined);
  const [count] = await ctx.db.select({ total: sql<number>`count(*)::int` }).from(showings).where(where);
  const total = count?.total ?? 0, pageSize = q.pageSize ?? 12, page = preservePage ? q.page ?? 1 : Math.min(q.page ?? 1, Math.max(1, Math.ceil(total / pageSize)));
  const rows = await ctx.db.select().from(showings).where(where).orderBy(asc(showings.startsAt), asc(showings.id)).limit(pageSize).offset((page - 1) * pageSize);
  return { ok: true, value: { items: await views(ctx, rows, provider), total, page, pageSize } };
}
export async function getShowingAgenda(ctx: Ctx, query: ShowingQuery, provider?: PropertyMlsProvider): Promise<ShowingResult<ShowingAgenda>> {
  const q = queryOf(query); if (!q) return { ok: false, reason: "invalid_showing_query" };
  const planned = await getShowings(ctx, q, provider, true); if (!planned.ok) return planned;
  const where = and(eq(contacts.assignedAgentUserId, ctx.actor.userId), visibleTo(ctx.actor), sql`${contacts.nextActionId} is not null and ${contacts.nextActionDueAt}>=${q.from}::timestamptz and ${contacts.nextActionDueAt}<${q.to}::timestamptz`, q.contactId ? eq(contacts.id, q.contactId) : undefined);
  const [count] = await ctx.db.select({ total: sql<number>`count(*)::int` }).from(contacts).where(where);
  const page = q.page ?? 1, pageSize = q.pageSize ?? 12;
  const rows = await ctx.db.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, preferredName: contacts.preferredName,
    actionId: contacts.nextActionId, kind: contacts.nextActionKind, purpose: contacts.nextActionPurpose, dueAt: contacts.nextActionDueAt, assigneeId: contacts.nextActionAssignedUserId })
    .from(contacts).where(where).orderBy(asc(contacts.nextActionDueAt), asc(contacts.id)).limit(pageSize).offset((page - 1) * pageSize);
  const nextActions: ShowingNextActionsPage = { items: rows.map(row => ({ contactId: row.id, contactName: row.preferredName?.trim() || [row.firstName, row.lastName].filter(Boolean).join(" ").trim() || "Unnamed contact",
    action: { id: row.actionId!, kind: row.kind as NextActionKind, purpose: row.purpose!, dueAt: row.dueAt!.toISOString(), assigneeId: row.assigneeId! } })), total: count?.total ?? 0, page, pageSize };
  return { ok: true, value: { showings: planned.value, nextActions } };
}
export async function getShowingSummary(ctx: Ctx, provider?: PropertyMlsProvider, limit = 3, now = new Date()): Promise<ShowingResult<ShowingSummary>> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 12) return { ok: false, reason: "invalid_showing_query" };
  const result = await getShowings(ctx, { from: now.toISOString(), to: new Date(now.getTime() + 30 * 86_400_000).toISOString(), status: "scheduled", page: 1, pageSize: limit }, provider);
  return result.ok ? { ok: true, value: { items: result.value.items, total: result.value.total } } : result;
}

type SavedSource = { property: { id: string; listId: string; dataset: string; listingId: string; mlsNumber: string; updatedAt: Date; reviewStatus: string; removedAt: Date | null }; scope: PropertyListScope };
async function sourceFor(ctx: Ctx, id: string): Promise<ShowingResult<SavedSource>> {
  if (!isRecordId(id)) return { ok: false, reason: "not_found" };
  const [property] = await ctx.db.select({ id: contactProperties.id, listId: contactProperties.listId, dataset: contactProperties.dataset, listingId: contactProperties.listingId, mlsNumber: contactProperties.mlsNumber, updatedAt: contactProperties.updatedAt, reviewStatus: contactProperties.reviewStatus, removedAt: contactProperties.removedAt })
    .from(contactProperties).where(eq(contactProperties.id, id)).limit(1);
  if (!property || property.removedAt) return { ok: false, reason: "not_found" };
  const loaded = await loadPropertyList(ctx, property.listId); if (!loaded.ok) return { ok: false, reason: loaded.reason };
  if (!loaded.value.writable) return { ok: false, reason: "forbidden" };
  return { ok: true, value: { property, scope: loaded.value } };
}
function sourceGuard(ctx: Ctx, source: SavedSource, expected?: string) {
  const p = source.property;
  return sql`exists(select 1 from ${propertyLists} where ${propertyListMutationGuard(ctx, source.scope)}) and exists(select 1 from ${contactProperties} where ${and(
    eq(contactProperties.id, p.id), eq(contactProperties.listId, p.listId), isNull(contactProperties.removedAt), eq(contactProperties.dataset, p.dataset), eq(contactProperties.listingId, p.listingId), eq(contactProperties.mlsNumber, p.mlsNumber), expected ? propertyRevision(expected) : undefined,
  )})`;
}
function contactGuard(ctx: Ctx, id: string) { return sql`exists(select 1 from ${contacts} where ${and(eq(contacts.id, id), visibleTo(ctx.actor))})`; }
function overlap(ctx: Ctx, start: string, end: string, excludeId?: string) {
  return and(showingVisibility(ctx), eq(showings.status, "scheduled"), sql`${showings.startsAt}<${end}::timestamptz and ${showings.endsAt}>${start}::timestamptz`, excludeId ? ne(showings.id, excludeId) : undefined);
}
async function hasOverlap(ctx: Ctx, start: string, end: string, excludeId?: string): Promise<boolean> {
  const [row] = await ctx.db.select({ id: showings.id }).from(showings).where(overlap(ctx, start, end, excludeId)).limit(1);
  return Boolean(row);
}
/** The owner row serializes overlap predicates; all remaining locks follow contact merge order. */
function mutationLocks(ctx: Ctx, contactId: string, source?: SavedSource, showingId?: string) {
  const contactIds = [...new Set([contactId, ...(source?.scope.row.contactId ? [source.scope.row.contactId] : [])])].sort();
  const writes: BatchWrite[] = [ctx.db.select({ id: dashboardUsers.id }).from(dashboardUsers).where(eq(dashboardUsers.id, ctx.actor.userId)).for("no key update"),
    ctx.db.select({ id: contacts.id }).from(contacts).where(and(inArray(contacts.id, contactIds), visibleTo(ctx.actor))).orderBy(contacts.id).for("update")];
  if (source) {
    writes.push(ctx.db.select({ id: propertyLists.id }).from(propertyLists).where(propertyListMutationGuard(ctx, source.scope)).orderBy(propertyLists.id).for("update"));
    writes.push(ctx.db.select({ id: contactProperties.id }).from(contactProperties).where(eq(contactProperties.id, source.property.id)).orderBy(contactProperties.id).for("update"));
  }
  if (showingId) writes.push(ctx.db.select({ id: showings.id }).from(showings).where(and(eq(showings.id, showingId), showingVisibility(ctx))).orderBy(showings.id).for("update"));
  return writes;
}
function errorCode(error: unknown): { code?: string; table?: string; column?: string } {
  let cause = error;
  for (let depth = 0; cause && typeof cause === "object" && depth < 6; depth++) { const value = cause as { code?: string; table?: string; column?: string; cause?: unknown }; if (value.code) return value; cause = value.cause; }
  return {};
}
function nextShowingUpdatedAt(now: Date) { return sql`greatest(date_trunc('milliseconds',${showings.updatedAt})+interval '1 millisecond',${now.toISOString()}::timestamptz)`; }
function audit(ctx: Ctx, id: string, contactId: string, propertyId: string, action: string, fields: string[], now: Date) {
  return ctx.db.insert(auditEvents).values({ eventType: "showing_updated", actorUserId: ctx.actor.userId,
    safeMetadata: { showingId: id, contactId, sourcePropertyId: propertyId, action, fields }, createdAt: now });
}

export async function createShowing(ctx: Ctx, input: unknown, now = new Date()): Promise<ShowingResult<ShowingView>> {
  if (ctx.actor.role === "member") return { ok: false, reason: "forbidden" };
  const parsed = createShowingInputSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_showing" };
  const d = parsed.data, hash = createPayloadHash(d);
  const replay = async (): Promise<ShowingResult<ShowingView> | null> => {
    const [row] = await ctx.db.select({ id: showings.id, hash: showings.createPayloadHash }).from(showings).where(and(eq(showings.ownerUserId, ctx.actor.userId), eq(showings.createRequestId, d.requestId))).limit(1);
    if (!row) return null;
    const visible = await getShowing(ctx, row.id); if (!visible.ok) return visible;
    return row.hash === hash ? visible : { ok: false, reason: "request_conflict" };
  };
  const previous = await replay(); if (previous) return previous;
  const failOrReplay = async (reason: ShowingFailure): Promise<ShowingResult<ShowingView>> => { try { return await replay() ?? { ok: false, reason }; } catch { return { ok: false, reason: "unavailable" }; } };
  const contact = await loadContact(ctx, d.contactId); if (!contact.ok) return failOrReplay(contact.reason); if (!contact.writable) return { ok: false, reason: "forbidden" };
  const source = await sourceFor(ctx, d.propertyId); if (!source.ok) return failOrReplay(source.reason);
  if (!checkShowingSchedule(d, now)) return { ok: false, reason: "invalid_date" };
  if (await hasOverlap(ctx, d.startsAt, d.endsAt)) return failOrReplay("time_conflict");
  const id = randomUUID(), property = source.value.property;
  const guard = sql`${contactGuard(ctx, d.contactId)} and ${sourceGuard(ctx, source.value)} and not exists(select 1 from ${showings} where ${overlap(ctx, d.startsAt, d.endsAt)})`;
  const writes = [...mutationLocks(ctx, d.contactId, source.value), ctx.db.insert(showings).values({ id, ownerUserId: ctx.actor.userId, brokerageKey: ctx.actor.brokerageKey,
    contactId: sql`case when ${guard} then ${d.contactId}::uuid else null end`, sourcePropertyId: property.id, dataset: property.dataset, listingId: property.listingId, mlsNumber: property.mlsNumber,
    startsAt: new Date(d.startsAt), endsAt: new Date(d.endsAt), meetingDetails: d.meetingDetails, notes: d.notes, status: "scheduled", createdAt: now, updatedAt: now, createRequestId: d.requestId, createPayloadHash: hash }),
    audit(ctx, id, d.contactId, property.id, "create", ["startsAt", "endsAt", "meetingDetails", "notes"], now)];
  try { await ctx.db.batch(writes as unknown as BatchInput); }
  catch (error) {
    try {
      const recovered = await replay(); if (recovered) return recovered;
      const currentContact = await loadContact(ctx, d.contactId); if (!currentContact.ok) return currentContact;
      const currentSource = await sourceFor(ctx, d.propertyId); if (!currentSource.ok) return currentSource;
      const code = errorCode(error);
      if (code.code === "23502" && code.table === "showings" && code.column === "contact_id" || code.code === "40P01") return { ok: false, reason: await hasOverlap(ctx, d.startsAt, d.endsAt) ? "time_conflict" : "conflict" };
    } catch { /* An unavailable database cannot turn into a partial successful plan. */ }
    return { ok: false, reason: "unavailable" };
  }
  return getShowing(ctx, id);
}

export async function mutateShowing(ctx: Ctx, id: string, input: unknown, now = new Date()): Promise<ShowingResult<ShowingView>> {
  if (ctx.actor.role === "member") return { ok: false, reason: "forbidden" };
  const parsed = showingMutationSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_showing" };
  const d = parsed.data, hash = createPayloadHash({ showingId: id, ...d });
  const replay = async (): Promise<ShowingResult<ShowingView> | null> => {
    const [receipt] = await ctx.db.select().from(showingMutationRequests).where(and(eq(showingMutationRequests.actorUserId, ctx.actor.userId), eq(showingMutationRequests.requestId, d.requestId))).limit(1);
    if (!receipt) return null;
    const visible = await getShowing(ctx, receipt.showingId); if (!visible.ok) return visible;
    return receipt.payloadHash === hash ? visible : { ok: false, reason: "request_conflict" };
  };
  const previous = await replay(); if (previous) return previous;
  const failOrReplay = async (reason: ShowingFailure): Promise<ShowingResult<ShowingView>> => { try { return await replay() ?? { ok: false, reason }; } catch { return { ok: false, reason: "unavailable" }; } };
  const loaded = await loadShowing(ctx, id); if (!loaded.ok) return failOrReplay(loaded.reason);
  const { row, writable } = loaded.value; if (!writable) return { ok: false, reason: "forbidden" };
  if (!revisionMatches(row.updatedAt, d.expectedUpdatedAt)) return failOrReplay("conflict");
  if (row.status !== "scheduled") return failOrReplay("invalid_transition");
  const scheduleChange = d.action === "update" || d.action === "reschedule";
  if (scheduleChange && !checkShowingSchedule(d, now, d.action === "update" ? { startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() } : undefined)) return { ok: false, reason: "invalid_date" };
  if (d.action === "complete" && !checkShowingVisit(d.visitedAt, now)) return { ok: false, reason: "invalid_date" };
  if (scheduleChange && await hasOverlap(ctx, d.startsAt, d.endsAt, id)) return failOrReplay("time_conflict");
  let source: SavedSource | undefined;
  if (d.action === "complete" && d.reviewStatus !== undefined) {
    const candidate = await sourceFor(ctx, row.sourcePropertyId);
    if (!candidate.ok || !revisionMatches(candidate.value.property.updatedAt, d.expectedPropertyUpdatedAt!) || candidate.value.property.dataset !== row.dataset || candidate.value.property.listingId !== row.listingId) return failOrReplay("property_conflict");
    source = candidate.value;
  }
  const showingGuard = and(eq(showings.id, id), showingVisibility(ctx), eq(showings.contactId, row.contactId), eq(showings.status, "scheduled"), sql`date_trunc('milliseconds',${showings.updatedAt})=${d.expectedUpdatedAt}::timestamptz`);
  const guard = sql`exists(select 1 from ${showings} where ${showingGuard}) ${source ? sql`and ${sourceGuard(ctx, source, d.action === "complete" ? d.expectedPropertyUpdatedAt : undefined)}` : sql``}
    ${scheduleChange ? sql`and not exists(select 1 from ${showings} where ${overlap(ctx, d.startsAt, d.endsAt, id)})` : sql``}`;
  const nextVersion = new Date(Math.max(row.updatedAt.getTime() + 1, now.getTime())).toISOString();
  const set = scheduleChange ? { startsAt: new Date(d.startsAt), endsAt: new Date(d.endsAt), meetingDetails: d.meetingDetails, notes: d.notes }
    : d.action === "cancel" ? { status: "cancelled", cancelReason: d.reason }
    : { status: "completed", visitedAt: new Date(d.visitedAt), feedbackLikes: d.likes, feedbackConcerns: d.concerns, feedbackSummary: d.summary };
  const fields = scheduleChange ? ["startsAt", "endsAt", "meetingDetails", "notes"] : d.action === "cancel" ? ["status", "cancelReason"] : ["status", "visitedAt", "feedbackLikes", "feedbackConcerns", "feedbackSummary", ...(source ? ["reviewStatus"] : [])];
  const writes = [...mutationLocks(ctx, row.contactId, source, id), ctx.db.insert(showingMutationRequests).values({ actorUserId: ctx.actor.userId, requestId: d.requestId, showingId: id,
    payloadHash: sql`case when ${guard} then ${hash}::text else null end`, result: { showingId: id, updatedAt: nextVersion }, createdAt: now }),
    ctx.db.update(showings).set({ ...set, updatedAt: nextShowingUpdatedAt(now) }).where(eq(showings.id, id))];
  if (d.action === "complete") {
    writes.push(ctx.db.insert(contactActivities).values({ contactId: row.contactId, actorUserId: ctx.actor.userId, kind: "showing", summary: "Showing completed", occurredAt: new Date(d.visitedAt),
      safeMetadata: { showingId: id, sourcePropertyId: row.sourcePropertyId, event: "showing_completed" } }));
    writes.push(ctx.db.update(contacts).set({ lastContactAt: sql`case when ${contacts.lastContactAt} is null or ${contacts.lastContactAt}<${d.visitedAt}::timestamptz then ${d.visitedAt}::timestamptz else ${contacts.lastContactAt} end`, updatedAt: nextContactUpdatedAt(now), updatedByUserId: ctx.actor.userId }).where(eq(contacts.id, row.contactId)));
    if (source && d.reviewStatus !== undefined) {
      writes.push(ctx.db.update(contactProperties).set({ reviewStatus: d.reviewStatus, updatedAt: nextPropertyUpdatedAt(now) }).where(eq(contactProperties.id, source.property.id)));
      writes.push(ctx.db.update(propertyLists).set({ updatedAt: propertyListNextUpdatedAt(now) }).where(eq(propertyLists.id, source.property.listId)));
      writes.push(ctx.db.insert(auditEvents).values({ eventType: "property_list_updated", actorUserId: ctx.actor.userId, safeMetadata: { listId: source.property.listId, contactId: source.scope.row.contactId, propertyId: source.property.id, showingId: id, action: "showing_review", fields: ["reviewStatus"] }, createdAt: now }));
    }
  }
  writes.push(audit(ctx, id, row.contactId, row.sourcePropertyId, d.action, fields, now));
  try { await ctx.db.batch(writes as unknown as BatchInput); }
  catch (error) {
    try {
      const recovered = await replay(); if (recovered) return recovered;
      const current = await loadShowing(ctx, id); if (!current.ok) return current;
      const code = errorCode(error);
      if (code.code === "23502" && code.table === "showing_mutation_requests" && code.column === "payload_hash" || code.code === "40P01") {
        if (source && d.action === "complete") { const latest = await sourceFor(ctx, row.sourcePropertyId); if (!latest.ok || !revisionMatches(latest.value.property.updatedAt, d.expectedPropertyUpdatedAt!)) return { ok: false, reason: "property_conflict" }; }
        return { ok: false, reason: scheduleChange && await hasOverlap(ctx, d.startsAt, d.endsAt, id) ? "time_conflict" : "conflict" };
      }
    } catch { /* Never forward private scheduling or feedback values as diagnostics. */ }
    return { ok: false, reason: "unavailable" };
  }
  return getShowing(ctx, id);
}
