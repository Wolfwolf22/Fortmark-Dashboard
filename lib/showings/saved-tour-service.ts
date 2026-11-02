import "server-only";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { auditEvents, contacts, contactProperties, dashboardUsers, propertyLists, showings, savedShowingTours, savedTourStops, savedTourRequests,
  type SavedShowingTourRow, type SavedTourStopRow, type ContactPropertyRow, type ShowingRow } from "../db/schema.ts";
import { isRecordId } from "../db/ids.ts";
import { loadContact } from "../contacts/access.ts";
import { displayName } from "../contacts/domain.ts";
import { visibleTo } from "../contacts/visibility.ts";
import { createPayloadHash, revisionMatches } from "../contacts/reliability.ts";
import { loadPropertyList, propertyListMutationGuard, type PropertyListScope } from "../contacts/property-lists-service.ts";
import type { Ctx, ServiceFailure } from "../contacts/service.ts";
import type { PropertyMlsProvider } from "../contacts/properties.ts";
import { normalizePropertyMlsNumber } from "../contacts/properties.ts";
import { businessDayKey } from "../metrics/business-day.ts";
import { showingVisibility } from "./service.ts";
import { checkShowingSchedule } from "./domain.ts";
import { validTourCoordinates, type TourRoutingProvider, type TourStop, type TourRoutingStop } from "./tour-domain.ts";
import { createSavedShowingTourInputSchema, updateSavedShowingTourInputSchema, archiveSavedShowingTourInputSchema, reviewSavedShowingTourInputSchema,
  scheduleSavedShowingTourInputSchema, readSavedShowingToursQuery, SAVED_TOUR_REVIEW_TTL_MS,
  type SavedTourSettings, type SavedShowingTourView, type SavedShowingToursQuery, type SavedShowingToursPage, type SavedTourSlot, type SavedTourReview, type SavedTourScheduleResult } from "./saved-tour-domain.ts";

export type SavedTourFailure = ServiceFailure | "invalid_saved_tour" | "invalid_saved_tour_query" | "source_unavailable" | "stale_review" | "review_expired" | "unresolved_stops" | "unresolved_endpoint" | "time_conflict" | "invalid_route" | "unreachable" | "infeasible" | "not_configured";
export type SavedTourResult<T> = { ok: true; value: T } | { ok: false; reason: SavedTourFailure };
type BatchInput = Parameters<Ctx["db"]["batch"]>[0];
type Write = BatchInput[number];
type Access = { row: SavedShowingTourRow; stops: SavedTourStopRow[]; contactName: string; contactUpdatedAt: string; writable: boolean; source: PropertyListScope | null };
type Source = { scope: PropertyListScope; properties: ContactPropertyRow[]; appointments: ShowingRow[] };

/** Lists and appointments do not inherit an administrator's wider contact access. */
export function savedTourVisibility(ctx: Ctx) {
  return and(eq(savedShowingTours.ownerUserId, ctx.actor.userId), eq(savedShowingTours.brokerageKey, ctx.actor.brokerageKey),
    sql`exists(select 1 from ${contacts} where ${contacts.id}=${savedShowingTours.contactId} and ${visibleTo(ctx.actor)})`);
}
async function loadTour(ctx: Ctx, id: string): Promise<SavedTourResult<Access>> {
  if (!isRecordId(id)) return { ok: false, reason: "not_found" };
  const [row] = await ctx.db.select().from(savedShowingTours).where(and(eq(savedShowingTours.id, id), savedTourVisibility(ctx))).limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  const contact = await loadContact(ctx, row.contactId); if (!contact.ok) return contact;
  const stops = await ctx.db.select().from(savedTourStops).where(eq(savedTourStops.tourId, id)).orderBy(savedTourStops.position, savedTourStops.id);
  const source = await loadPropertyList(ctx, row.sourceListId);
  return { ok: true, value: { row, stops, contactName: displayName(contact.row), contactUpdatedAt: contact.row.updatedAt.toISOString(), writable: contact.writable && ctx.actor.role !== "member", source: source.ok ? source.value : null } };
}
async function view(ctx: Ctx, access: Access): Promise<SavedShowingTourView> {
  const { row, stops, source } = access, propertyIds = stops.map(stop => stop.propertyId), showingIds = stops.flatMap(stop => stop.linkedShowingId ? [stop.linkedShowingId] : []);
  const properties = source && propertyIds.length ? await ctx.db.select({ id: contactProperties.id, listingId: contactProperties.listingId, mlsNumber: contactProperties.mlsNumber, removedAt: contactProperties.removedAt }).from(contactProperties).where(and(eq(contactProperties.listId, row.sourceListId), inArray(contactProperties.id, propertyIds))) : [];
  const appointments = showingIds.length ? await ctx.db.select({ id: showings.id, contactId: showings.contactId, sourcePropertyId: showings.sourcePropertyId, startsAt: showings.startsAt, endsAt: showings.endsAt, updatedAt: showings.updatedAt, status: showings.status }).from(showings).where(and(inArray(showings.id, showingIds), showingVisibility(ctx), eq(showings.contactId, row.contactId))) : [];
  const p = new Map(properties.map(item => [item.id, item])), a = new Map(appointments.map(item => [item.id, item]));
  return { id: row.id, name: row.name, notes: row.notes, contactId: row.contactId, contactName: access.contactName, sourceListId: row.sourceListId, sourceList: source ? { id: source.row.id, name: source.row.name } : null,
    startsAt: row.startsAt.toISOString(), day: businessDayKey(row.startsAt), bufferMinutes: row.bufferMinutes, firstPropertyId: row.firstPropertyId, originAddress: row.originAddress, endMode: row.endMode as SavedShowingTourView["endMode"], endAddress: row.endAddress,
    stops: stops.map(stop => { const property = p.get(stop.propertyId), appointment = stop.linkedShowingId ? a.get(stop.linkedShowingId) : undefined; return {
      id: stop.id, propertyId: stop.propertyId, position: stop.position, visitMinutes: stop.visitMinutes, lockTime: stop.lockTime, linkedShowingId: stop.linkedShowingId, updatedAt: stop.updatedAt.toISOString(),
      mlsNumber: property?.mlsNumber ?? null, listingId: property?.listingId ?? null, available: Boolean(property && !property.removedAt),
      appointment: appointment && appointment.sourcePropertyId === stop.propertyId ? { id: appointment.id, startsAt: appointment.startsAt.toISOString(), endsAt: appointment.endsAt.toISOString(), updatedAt: appointment.updatedAt.toISOString(), status: appointment.status as "scheduled" | "completed" | "cancelled" } : null,
    }; }), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), archivedAt: row.archivedAt?.toISOString() ?? null, lastScheduledAt: row.lastScheduledAt?.toISOString() ?? null,
    canEdit: access.writable && !row.archivedAt, canReview: access.writable && !row.archivedAt && Boolean(source?.writable) && properties.length === stops.length && properties.every(item => !item.removedAt) };
}
export async function getSavedShowingTour(ctx: Ctx, id: string): Promise<SavedTourResult<SavedShowingTourView>> {
  const loaded = await loadTour(ctx, id); return loaded.ok ? { ok: true, value: await view(ctx, loaded.value) } : loaded;
}
export async function getSavedShowingTours(ctx: Ctx, query: SavedShowingToursQuery = {}): Promise<SavedTourResult<SavedShowingToursPage>> {
  const q = readSavedShowingToursQuery(new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))); if (!q) return { ok: false, reason: "invalid_saved_tour_query" };
  if (q.contactId) { const parent = await loadContact(ctx, q.contactId); if (!parent.ok) return parent; }
  const where = and(savedTourVisibility(ctx), q.archived ? sql`${savedShowingTours.archivedAt} is not null` : isNull(savedShowingTours.archivedAt), q.contactId ? eq(savedShowingTours.contactId, q.contactId) : undefined, q.sourceListId ? eq(savedShowingTours.sourceListId, q.sourceListId) : undefined);
  const [count] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(savedShowingTours).where(where);
  const total = count?.n ?? 0, pageSize = q.pageSize ?? 12, page = Math.min(q.page ?? 1, Math.max(1, Math.ceil(total / pageSize)));
  const rows = await ctx.db.select({ id: savedShowingTours.id }).from(savedShowingTours).where(where).orderBy(desc(savedShowingTours.updatedAt), desc(savedShowingTours.id)).limit(pageSize).offset((page - 1) * pageSize);
  const items: SavedShowingTourView[] = []; for (const row of rows) { const item = await getSavedShowingTour(ctx, row.id); if (item.ok) items.push(item.value); }
  return { ok: true, value: { items, total, page, pageSize } };
}
function normalizedSettings(settings: SavedTourSettings): SavedTourSettings { return { ...settings, endAddress: settings.endMode === "address" ? settings.endAddress : "", stops: settings.stops.map(stop => ({ ...stop, linkedShowingId: stop.linkedShowingId ?? null })) }; }
async function sourceFor(ctx: Ctx, settings: SavedTourSettings): Promise<SavedTourResult<Source>> {
  const parent = await loadContact(ctx, settings.contactId); if (!parent.ok) return parent; if (!parent.writable || ctx.actor.role === "member") return { ok: false, reason: "forbidden" };
  const source = await loadPropertyList(ctx, settings.sourceListId); if (!source.ok) return { ok: false, reason: "source_unavailable" }; if (!source.value.writable) return { ok: false, reason: "forbidden" };
  const properties = await ctx.db.select().from(contactProperties).where(and(eq(contactProperties.listId, settings.sourceListId), inArray(contactProperties.id, settings.stops.map(stop => stop.propertyId)), isNull(contactProperties.removedAt)));
  if (properties.length !== settings.stops.length) return { ok: false, reason: "source_unavailable" };
  const ids = settings.stops.flatMap(stop => stop.linkedShowingId ? [stop.linkedShowingId] : []);
  const appointments = ids.length ? await ctx.db.select().from(showings).where(and(inArray(showings.id, ids), showingVisibility(ctx), eq(showings.contactId, settings.contactId))) : [];
  if (appointments.length !== ids.length || settings.stops.some(stop => stop.linkedShowingId && !appointments.some(appointment => { const property = properties.find(p => p.id === stop.propertyId); return appointment.id === stop.linkedShowingId && appointment.sourcePropertyId === stop.propertyId && property && appointment.dataset === property.dataset && appointment.listingId === property.listingId && appointment.mlsNumber === property.mlsNumber; }))) return { ok: false, reason: "not_found" };
  return { ok: true, value: { scope: source.value, properties, appointments } };
}
function settingsFrom(access: Access): SavedTourSettings { const r = access.row; return { name: r.name, notes: r.notes, contactId: r.contactId, sourceListId: r.sourceListId, startsAt: r.startsAt.toISOString(), bufferMinutes: r.bufferMinutes, firstPropertyId: r.firstPropertyId, originAddress: r.originAddress, endMode: r.endMode as SavedTourSettings["endMode"], endAddress: r.endAddress, stops: access.stops.map(stop => ({ propertyId: stop.propertyId, visitMinutes: stop.visitMinutes, lockTime: stop.lockTime, linkedShowingId: stop.linkedShowingId })) }; }
function contactGuard(ctx: Ctx, id: string) { return sql`exists(select 1 from ${contacts} where ${and(eq(contacts.id, id), visibleTo(ctx.actor))})`; }
function sourceGuard(ctx: Ctx, source: Source) {
  return sql`exists(select 1 from ${propertyLists} where ${propertyListMutationGuard(ctx, source.scope)} and date_trunc('milliseconds',${propertyLists.updatedAt})=${source.scope.row.updatedAt.toISOString()}::timestamptz) and ${sql.join(source.properties.map(p => sql`exists(select 1 from ${contactProperties} where ${contactProperties.id}=${p.id}::uuid and ${contactProperties.listId}=${p.listId}::uuid and ${contactProperties.removedAt} is null and date_trunc('milliseconds',${contactProperties.updatedAt})=${p.updatedAt.toISOString()}::timestamptz and ${contactProperties.dataset}=${p.dataset} and ${contactProperties.listingId}=${p.listingId} and ${contactProperties.mlsNumber}=${p.mlsNumber})`), sql` and `)}
    ${source.appointments.length ? sql`and ${sql.join(source.appointments.map(a => sql`exists(select 1 from ${showings} where ${showings.id}=${a.id}::uuid and ${showingVisibility(ctx)} and ${showings.contactId}=${a.contactId}::uuid and ${showings.sourcePropertyId}=${a.sourcePropertyId}::uuid and ${showings.dataset}=${a.dataset} and ${showings.listingId}=${a.listingId} and ${showings.mlsNumber}=${a.mlsNumber} and ${showings.startsAt}=${a.startsAt.toISOString()}::timestamptz and ${showings.endsAt}=${a.endsAt.toISOString()}::timestamptz and date_trunc('milliseconds',${showings.updatedAt})=${a.updatedAt.toISOString()}::timestamptz and ${showings.status}=${a.status})`), sql` and `)}` : sql``}`;
}
function locks(ctx: Ctx, contactIds: string[], sources: Source[], tourId?: string, actorLock = false): Write[] {
  const writes: Write[] = [], parents = [...new Set([...contactIds, ...sources.flatMap(source => source.scope.row.contactId ? [source.scope.row.contactId] : [])])].sort();
  if (actorLock) writes.push(ctx.db.select({ id: dashboardUsers.id }).from(dashboardUsers).where(eq(dashboardUsers.id, ctx.actor.userId)).for("no key update"));
  if (parents.length) writes.push(ctx.db.select({ id: contacts.id }).from(contacts).where(and(inArray(contacts.id, parents), visibleTo(ctx.actor))).orderBy(contacts.id).for("update"));
  const listIds = [...new Set(sources.map(source => source.scope.row.id))].sort(), propertyIds = [...new Set(sources.flatMap(source => source.properties.map(p => p.id)))].sort(), showingIds = [...new Set(sources.flatMap(source => source.appointments.map(a => a.id)))].sort();
  if (listIds.length) writes.push(ctx.db.select({ id: propertyLists.id }).from(propertyLists).where(inArray(propertyLists.id, listIds)).orderBy(propertyLists.id).for("update"));
  if (propertyIds.length) writes.push(ctx.db.select({ id: contactProperties.id }).from(contactProperties).where(inArray(contactProperties.id, propertyIds)).orderBy(contactProperties.id).for("update"));
  if (tourId) { writes.push(ctx.db.select({ id: savedShowingTours.id }).from(savedShowingTours).where(and(eq(savedShowingTours.id, tourId), savedTourVisibility(ctx))).for("update")); writes.push(ctx.db.select({ id: savedTourStops.id }).from(savedTourStops).where(eq(savedTourStops.tourId, tourId)).orderBy(savedTourStops.id).for("update")); }
  if (showingIds.length) writes.push(ctx.db.select({ id: showings.id }).from(showings).where(inArray(showings.id, showingIds)).orderBy(showings.id).for("update"));
  return writes;
}
function audit(ctx: Ctx, tourId: string, contactId: string, action: string, now: Date, showingIds?: string[]) { return ctx.db.insert(auditEvents).values({ eventType: "showing_tour_updated", actorUserId: ctx.actor.userId, safeMetadata: { tourId, contactId, action, ...(showingIds ? { showingIds } : {}) }, createdAt: now }); }
function nextRevision(row: SavedShowingTourRow, now: Date) { return new Date(Math.max(row.updatedAt.getTime() + 1, now.getTime())); }
function guardedTour(ctx: Ctx, access: Access, expected: string) { return and(eq(savedShowingTours.id, access.row.id), savedTourVisibility(ctx), eq(savedShowingTours.contactId, access.row.contactId), eq(savedShowingTours.sourceListId, access.row.sourceListId), isNull(savedShowingTours.archivedAt), sql`date_trunc('milliseconds',${savedShowingTours.updatedAt})=${expected}::timestamptz`); }
function snapshotGuard(ctx: Ctx, access: Access) { return sql`exists(select 1 from ${contacts} where ${contacts.id}=${access.row.contactId}::uuid and ${visibleTo(ctx.actor)} and date_trunc('milliseconds',${contacts.updatedAt})=${access.contactUpdatedAt}::timestamptz)
  and (select count(*) from ${savedTourStops} where ${savedTourStops.tourId}=${access.row.id}::uuid)=${access.stops.length}
  and ${sql.join(access.stops.map(stop => sql`exists(select 1 from ${savedTourStops} where ${savedTourStops.id}=${stop.id}::uuid and ${savedTourStops.tourId}=${access.row.id}::uuid and ${savedTourStops.propertyId}=${stop.propertyId}::uuid and ${savedTourStops.position}=${stop.position} and ${savedTourStops.visitMinutes}=${stop.visitMinutes} and ${savedTourStops.lockTime}=${stop.lockTime} and ${savedTourStops.linkedShowingId} is not distinct from ${stop.linkedShowingId}::uuid and date_trunc('milliseconds',${savedTourStops.updatedAt})=${stop.updatedAt.toISOString()}::timestamptz)`), sql` and `)}`; }
async function requestReplay(ctx: Ctx, requestId: string, hash: string, action: string, requireSource = false): Promise<SavedTourResult<SavedTourScheduleResult> | null> {
  const [receipt] = await ctx.db.select().from(savedTourRequests).where(and(eq(savedTourRequests.actorUserId, ctx.actor.userId), eq(savedTourRequests.requestId, requestId))).limit(1); if (!receipt) return null;
  const loaded = await loadTour(ctx, receipt.tourId); if (!loaded.ok) return loaded; if (!loaded.value.writable) return { ok: false, reason: "forbidden" };
  if (requireSource && !loaded.value.source?.writable) return { ok: false, reason: "source_unavailable" };
  if (receipt.payloadHash !== hash || receipt.action !== action) return { ok: false, reason: "request_conflict" };
  const ids = receipt.result.showingIds ?? [];
  if (ids.length) { const rows = await ctx.db.select({ id: showings.id }).from(showings).where(and(inArray(showings.id, ids), showingVisibility(ctx))); if (rows.length !== ids.length) return { ok: false, reason: "not_found" }; }
  return { ok: true, value: { tour: await view(ctx, loaded.value), showingIds: ids } };
}
export async function createSavedShowingTour(ctx: Ctx, input: unknown, now = new Date()): Promise<SavedTourResult<SavedShowingTourView>> {
  if (ctx.actor.role === "member") return { ok: false, reason: "forbidden" };
  const parsed = createSavedShowingTourInputSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_saved_tour" };
  const { requestId, ...raw } = parsed.data, settings = normalizedSettings(raw), hash = createPayloadHash(settings);
  const replay = async (): Promise<SavedTourResult<SavedShowingTourView> | null> => { const [row] = await ctx.db.select().from(savedShowingTours).where(and(eq(savedShowingTours.ownerUserId, ctx.actor.userId), eq(savedShowingTours.createRequestId, requestId))).limit(1); if (!row) return null; const visible = await getSavedShowingTour(ctx, row.id); return !visible.ok ? visible : row.createPayloadHash === hash ? visible : { ok: false, reason: "request_conflict" }; };
  const previous = await replay(); if (previous) return previous;
  const source = await sourceFor(ctx, settings); if (!source.ok) return await replay() ?? source;
  const id = randomUUID(), guard = sql`${contactGuard(ctx, settings.contactId)} and ${sourceGuard(ctx, source.value)}`, { stops, ...fields } = settings;
  const writes: Write[] = [...locks(ctx, [settings.contactId], [source.value]), ctx.db.insert(savedShowingTours).values({ id, ownerUserId: ctx.actor.userId, brokerageKey: ctx.actor.brokerageKey, ...fields, contactId: sql`case when ${guard} then ${settings.contactId}::uuid else null end`, startsAt: new Date(settings.startsAt), reviewKey: randomBytes(32).toString("hex"), createdAt: now, updatedAt: now, createRequestId: requestId, createPayloadHash: hash }),
    ctx.db.insert(savedTourStops).values(stops.map((stop, position) => ({ id: randomUUID(), tourId: id, propertyId: stop.propertyId, position, visitMinutes: stop.visitMinutes, lockTime: stop.lockTime, linkedShowingId: stop.linkedShowingId ?? null, createdAt: now, updatedAt: now }))), audit(ctx, id, settings.contactId, "create", now)];
  try { await ctx.db.batch(writes as unknown as BatchInput); } catch { return await replay() ?? { ok: false, reason: "conflict" }; }
  return getSavedShowingTour(ctx, id);
}
export async function updateSavedShowingTour(ctx: Ctx, id: string, input: unknown, now = new Date()): Promise<SavedTourResult<SavedShowingTourView>> {
  if (ctx.actor.role === "member") return { ok: false, reason: "forbidden" };
  const parsed = updateSavedShowingTourInputSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_saved_tour" };
  const { requestId, expectedUpdatedAt, ...raw } = parsed.data, settings = normalizedSettings(raw), hash = createPayloadHash({ id, action: "edit", expectedUpdatedAt, settings });
  const previous = await requestReplay(ctx, requestId, hash, "edit"); if (previous) return previous.ok ? { ok: true, value: previous.value.tour } : previous;
  const loaded = await loadTour(ctx, id); if (!loaded.ok) return loaded; const access = loaded.value;
  if (!access.writable) return { ok: false, reason: "forbidden" }; if (access.row.archivedAt) return { ok: false, reason: "invalid_transition" }; if (!revisionMatches(access.row.updatedAt, expectedUpdatedAt)) return { ok: false, reason: "conflict" };
  const source = await sourceFor(ctx, settings); if (!source.ok) return source;
  const oldSource = access.source ? await sourceFor(ctx, settingsFrom(access)) : null, sources = [source.value, ...(oldSource?.ok ? [oldSource.value] : [])];
  const next = nextRevision(access.row, now), guard = sql`exists(select 1 from ${savedShowingTours} where ${guardedTour(ctx, access, expectedUpdatedAt)}) and ${snapshotGuard(ctx, access)} and ${contactGuard(ctx, settings.contactId)} and ${sourceGuard(ctx, source.value)}`;
  const { stops, ...fields } = settings;
  const writes: Write[] = [...locks(ctx, [access.row.contactId, settings.contactId], sources, id), ctx.db.insert(savedTourRequests).values({ actorUserId: ctx.actor.userId, requestId, tourId: id, action: "edit", payloadHash: sql`case when ${guard} then ${hash}::text else null end`, result: { tourId: id }, createdAt: now }),
    ctx.db.update(savedShowingTours).set({ ...fields, startsAt: new Date(settings.startsAt), updatedAt: next }).where(eq(savedShowingTours.id, id)), ctx.db.delete(savedTourStops).where(eq(savedTourStops.tourId, id)),
    ctx.db.insert(savedTourStops).values(stops.map((stop, position) => ({ id: randomUUID(), tourId: id, propertyId: stop.propertyId, position, visitMinutes: stop.visitMinutes, lockTime: stop.lockTime, linkedShowingId: stop.linkedShowingId ?? null, createdAt: now, updatedAt: now }))), audit(ctx, id, settings.contactId, "edit", now)];
  try { await ctx.db.batch(writes as unknown as BatchInput); } catch { const replay = await requestReplay(ctx, requestId, hash, "edit"); return replay ? replay.ok ? { ok: true, value: replay.value.tour } : replay : { ok: false, reason: "conflict" }; }
  return getSavedShowingTour(ctx, id);
}
export async function archiveSavedShowingTour(ctx: Ctx, id: string, input: unknown, now = new Date()): Promise<SavedTourResult<SavedShowingTourView>> {
  if (ctx.actor.role === "member") return { ok: false, reason: "forbidden" };
  const parsed = archiveSavedShowingTourInputSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_saved_tour" };
  const d = parsed.data, hash = createPayloadHash({ id, action: "archive", ...d }), previous = await requestReplay(ctx, d.requestId, hash, "archive"); if (previous) return previous.ok ? { ok: true, value: previous.value.tour } : previous;
  const loaded = await loadTour(ctx, id); if (!loaded.ok) return loaded; const access = loaded.value;
  if (!access.writable) return { ok: false, reason: "forbidden" }; if (access.row.archivedAt || !revisionMatches(access.row.updatedAt, d.expectedUpdatedAt)) return { ok: false, reason: "conflict" };
  const writes: Write[] = [...locks(ctx, [access.row.contactId], [], id), ctx.db.insert(savedTourRequests).values({ actorUserId: ctx.actor.userId, requestId: d.requestId, tourId: id, action: "archive", payloadHash: sql`case when exists(select 1 from ${savedShowingTours} where ${guardedTour(ctx, access, d.expectedUpdatedAt)}) then ${hash}::text else null end`, result: { tourId: id }, createdAt: now }),
    ctx.db.update(savedShowingTours).set({ archivedAt: now, updatedAt: nextRevision(access.row, now) }).where(eq(savedShowingTours.id, id)), audit(ctx, id, access.row.contactId, "archive", now)];
  try { await ctx.db.batch(writes as unknown as BatchInput); } catch { const replay = await requestReplay(ctx, d.requestId, hash, "archive"); return replay ? replay.ok ? { ok: true, value: replay.value.tour } : replay : { ok: false, reason: "conflict" }; }
  return getSavedShowingTour(ctx, id);
}

function fingerprint(access: Access, source: Source) {
  const { reviewKey: _secret, ...row } = access.row;
  // Canonical payload hashing expects JSON data; preserve Date values as ISO revisions first.
  return createPayloadHash(JSON.parse(JSON.stringify({ row, contactRevision: access.contactUpdatedAt, stops: access.stops, sourceList: { id: source.scope.row.id, contactId: source.scope.row.contactId, updatedAt: source.scope.row.updatedAt, ownerUserId: source.scope.row.ownerUserId, brokerageKey: source.scope.row.brokerageKey },
    properties: source.properties.map(p => ({ id: p.id, listId: p.listId, contactId: p.contactId, dataset: p.dataset, listingId: p.listingId, mlsNumber: p.mlsNumber, updatedAt: p.updatedAt, removedAt: p.removedAt })).sort((a, b) => a.id.localeCompare(b.id)),
    appointments: source.appointments.map(a => ({ id: a.id, contactId: a.contactId, ownerUserId: a.ownerUserId, sourcePropertyId: a.sourcePropertyId, status: a.status, startsAt: a.startsAt, endsAt: a.endsAt, updatedAt: a.updatedAt })).sort((a, b) => a.id.localeCompare(b.id)) })));
}
async function fresh(ctx: Ctx, id: string, expected: string, previousFingerprint?: string): Promise<SavedTourResult<{ access: Access; source: Source; fingerprint: string }>> {
  const loaded = await loadTour(ctx, id); if (!loaded.ok) return loaded; const access = loaded.value;
  if (!access.writable) return { ok: false, reason: "forbidden" }; if (access.row.archivedAt) return { ok: false, reason: "invalid_transition" };
  if (!revisionMatches(access.row.updatedAt, expected)) return { ok: false, reason: previousFingerprint ? "stale_review" : "conflict" };
  const source = await sourceFor(ctx, settingsFrom(access)); if (!source.ok) return source;
  const value = fingerprint(access, source.value); if (previousFingerprint && value !== previousFingerprint) return { ok: false, reason: "stale_review" };
  return { ok: true, value: { access, source: source.value, fingerprint: value } };
}
type SignedReview = { version: 1; actorUserId: string; tourId: string; updatedAt: string; fingerprint: string; expiresAt: string; slots: SavedTourSlot[] };
function signReview(payload: SignedReview, key: string): string { const body = Buffer.from(JSON.stringify(payload)).toString("base64url"); return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`; }
function readReview(token: string, key: string): SignedReview | null {
  try { const parts = token.split("."); if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
    const expected = createHmac("sha256", key).update(parts[0]).digest(), actual = Buffer.from(parts[1], "base64url"); if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) return null;
    const value = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); return value && value.version === 1 && Array.isArray(value.slots) && value.slots.length >= 2 && value.slots.length <= 8 ? value as SignedReview : null;
  } catch { return null; }
}
function slotsOverlap(slots: SavedTourSlot[]) { return slots.some((slot, index) => slots.slice(index + 1).some(other => Date.parse(slot.startsAt) < Date.parse(other.endsAt) && Date.parse(slot.endsAt) > Date.parse(other.startsAt))); }
function overlapWhere(ctx: Ctx, slots: SavedTourSlot[]) { const changing = slots.flatMap(slot => slot.showingId ? [slot.showingId] : []); return and(eq(showings.ownerUserId, ctx.actor.userId), eq(showings.brokerageKey, ctx.actor.brokerageKey), eq(showings.status, "scheduled"), changing.length ? sql`${showings.id} not in (${sql.join(changing.map(id => sql`${id}::uuid`), sql`,`)})` : undefined,
  sql`(${sql.join(slots.map(slot => sql`(${showings.startsAt}<${slot.endsAt}::timestamptz and ${showings.endsAt}>${slot.startsAt}::timestamptz)`), sql` or `)})`); }
async function hasOverlap(ctx: Ctx, slots: SavedTourSlot[]) { const [row] = await ctx.db.select({ id: showings.id }).from(showings).where(overlapWhere(ctx, slots)).limit(1); return Boolean(row); }
async function resolvedStops(access: Access, source: Source, provider?: PropertyMlsProvider): Promise<TourStop[]> {
  const props = new Map(source.properties.map(p => [p.id, p])), appointments = new Map(source.appointments.map(a => [a.id, a]));
  const stops: TourStop[] = access.stops.map(stop => { const p = props.get(stop.propertyId)!, a = stop.linkedShowingId ? appointments.get(stop.linkedShowingId) : undefined; return { propertyId: p.id, dataset: p.dataset, listingId: p.listingId, mlsNumber: p.mlsNumber, coordinates: null, locationStatus: "unavailable", selectable: false, visitMinutes: stop.lockTime && a ? (a.endsAt.getTime() - a.startsAt.getTime()) / 60_000 : stop.visitMinutes,
    ...(a ? { showingId: a.id, appointment: { startsAt: a.startsAt.toISOString(), endsAt: a.endsAt.toISOString(), updatedAt: a.updatedAt.toISOString() } } : {}) }; });
  let cursor = 0; await Promise.all(Array.from({ length: Math.min(4, stops.length) }, async () => { while (cursor < stops.length) { const stop = stops[cursor++]; if (!provider) { stop.locationStatus = "not_configured"; continue; }
    try { const result = await provider.get(stop.dataset, stop.listingId, stop.mlsNumber); if (!result.ok) { stop.locationStatus = result.reason === "not_found" || result.reason === "not_configured" ? result.reason : "unavailable"; continue; }
      const listing = result.value.listing; if (result.value.dataset !== stop.dataset || listing.source !== "mls" || listing.id !== stop.listingId || normalizePropertyMlsNumber(listing.mlsNumber) !== stop.mlsNumber) { stop.locationStatus = "not_found"; continue; }
      if (listing.addressWithheld) { stop.locationStatus = "withheld"; continue; } if (listing.address) stop.address = listing.address; if (listing.city) stop.city = listing.city;
      if (!validTourCoordinates(listing.coordinates)) { stop.locationStatus = "missing_coordinates"; continue; } stop.coordinates = { ...listing.coordinates }; stop.locationStatus = "available"; stop.selectable = true;
    } catch { stop.locationStatus = "unavailable"; }
  } })); return stops;
}
export async function reviewSavedShowingTour(ctx: Ctx, id: string, input: unknown, provider: PropertyMlsProvider | undefined, routing: TourRoutingProvider, now = new Date()): Promise<SavedTourResult<SavedTourReview>> {
  if (ctx.actor.role === "member") return { ok: false, reason: "forbidden" };
  const parsed = reviewSavedShowingTourInputSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_saved_tour" };
  const state = await fresh(ctx, id, parsed.data.expectedUpdatedAt); if (!state.ok) return state; const { access, source } = state.value;
  if (!checkShowingSchedule({ startsAt: access.row.startsAt.toISOString(), endsAt: new Date(access.row.startsAt.getTime() + 15 * 60_000).toISOString() }, now)) return { ok: false, reason: "invalid_date" };
  if (source.appointments.some(a => a.status !== "scheduled")) return { ok: false, reason: "invalid_transition" };
  if (routing.map.kind === "not_configured") return { ok: false, reason: "not_configured" };
  const stops = await resolvedStops(access, source, provider); if (stops.some(stop => !stop.selectable || !stop.coordinates)) return { ok: false, reason: "unresolved_stops" };
  const afterLocations = await fresh(ctx, id, parsed.data.expectedUpdatedAt, state.value.fingerprint); if (!afterLocations.ok) return afterLocations;
  const byProperty = new Map(access.stops.map(stop => [stop.propertyId, stop]));
  const routeStops: TourRoutingStop[] = stops.map(stop => ({ propertyId: stop.propertyId, coordinates: stop.coordinates!, visitMinutes: stop.visitMinutes, ...(byProperty.get(stop.propertyId)!.lockTime && stop.appointment ? { fixedStartsAt: stop.appointment.startsAt } : {}) }));
  let result; try { result = await routing.recommend(routeStops, { startPropertyId: access.row.firstPropertyId, startsAt: access.row.startsAt.toISOString(), bufferMinutes: access.row.bufferMinutes, returnToStart: access.row.endMode === "return_to_start", respectAppointments: true, originAddress: access.row.originAddress, endMode: access.row.endMode as "last_property" | "return_to_start" | "address", endAddress: access.row.endAddress }); } catch { return { ok: false, reason: "unavailable" }; }
  const afterRoads = await fresh(ctx, id, parsed.data.expectedUpdatedAt, state.value.fingerprint); if (!afterRoads.ok) return afterRoads; if (!result.ok) return result;
  const appointmentById = new Map(source.appointments.map(a => [a.id, a]));
  if (result.value.visits.length !== access.stops.length || new Set(result.value.visits.map(v => v.propertyId)).size !== access.stops.length || result.value.visits.some(v => !byProperty.has(v.propertyId))) return { ok: false, reason: "unavailable" };
  const slots: SavedTourSlot[] = result.value.visits.map(visit => { const stop = byProperty.get(visit.propertyId)!, a = stop.linkedShowingId ? appointmentById.get(stop.linkedShowingId) : undefined; return { stopId: stop.id, propertyId: stop.propertyId, showingId: a?.id ?? null, expectedShowingUpdatedAt: a?.updatedAt.toISOString() ?? null, currentStartsAt: a?.startsAt.toISOString() ?? null, currentEndsAt: a?.endsAt.toISOString() ?? null, startsAt: visit.startsAt, endsAt: visit.endsAt, kept: Boolean(stop.lockTime) }; });
  if (!validSlots(access, source, slots, now)) return { ok: false, reason: "invalid_route" }; if (slotsOverlap(slots) || await hasOverlap(ctx, slots)) return { ok: false, reason: "time_conflict" };
  const expiresAt = new Date(now.getTime() + SAVED_TOUR_REVIEW_TTL_MS).toISOString();
  const reviewToken = signReview({ version: 1, actorUserId: ctx.actor.userId, tourId: id, updatedAt: access.row.updatedAt.toISOString(), fingerprint: state.value.fingerprint, expiresAt, slots }, access.row.reviewKey);
  return { ok: true, value: { tourId: id, expectedUpdatedAt: access.row.updatedAt.toISOString(), reviewToken, expiresAt, recommendation: { ...result.value, resolvedStops: stops }, slots, map: routing.map } };
}
function validSlots(access: Access, source: Source, slots: SavedTourSlot[], now: Date): boolean {
  const stops = new Map(access.stops.map(stop => [stop.id, stop])), appointments = new Map(source.appointments.map(a => [a.id, a]));
  if (slots.length !== access.stops.length || new Set(slots.map(slot => slot.stopId)).size !== slots.length) return false;
  return slots.every(slot => { const stop = stops.get(slot.stopId), a = stop?.linkedShowingId ? appointments.get(stop.linkedShowingId) : undefined;
    return Boolean(stop && slot.propertyId === stop.propertyId && slot.showingId === (stop.linkedShowingId ?? null) && slot.expectedShowingUpdatedAt === (a?.updatedAt.toISOString() ?? null) && slot.currentStartsAt === (a?.startsAt.toISOString() ?? null) && slot.currentEndsAt === (a?.endsAt.toISOString() ?? null) && slot.kept === stop.lockTime && checkShowingSchedule(slot, now) && businessDayKey(new Date(slot.startsAt)) === businessDayKey(access.row.startsAt)
      && (!a || a.status === "scheduled") && (stop.lockTime ? Boolean(a && slot.startsAt === a.startsAt.toISOString() && slot.endsAt === a.endsAt.toISOString()) : Date.parse(slot.endsAt) - Date.parse(slot.startsAt) === stop.visitMinutes * 60_000));
  });
}
export async function scheduleSavedShowingTour(ctx: Ctx, id: string, input: unknown, now = new Date()): Promise<SavedTourResult<SavedTourScheduleResult>> {
  if (ctx.actor.role === "member") return { ok: false, reason: "forbidden" };
  const parsed = scheduleSavedShowingTourInputSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_saved_tour" };
  const d = parsed.data, hash = createPayloadHash({ id, action: "schedule", ...d });
  const previous = await requestReplay(ctx, d.requestId, hash, "schedule", true); if (previous) return previous;
  const state = await fresh(ctx, id, d.expectedUpdatedAt); if (!state.ok) return state; const { access, source } = state.value;
  const signed = readReview(d.reviewToken, access.row.reviewKey);
  if (!signed || signed.actorUserId !== ctx.actor.userId || signed.tourId !== id || signed.updatedAt !== d.expectedUpdatedAt || signed.fingerprint !== state.value.fingerprint) return { ok: false, reason: "stale_review" };
  if (!Number.isFinite(Date.parse(signed.expiresAt)) || Date.parse(signed.expiresAt) <= now.getTime()) return { ok: false, reason: "review_expired" };
  const slots = signed.slots; if (!validSlots(access, source, slots, now) || slotsOverlap(slots)) return { ok: false, reason: "stale_review" };
  if (await hasOverlap(ctx, slots)) return { ok: false, reason: "time_conflict" };
  const next = nextRevision(access.row, now), properties = new Map(source.properties.map(p => [p.id, p])), showingIds = slots.map(slot => slot.showingId ?? randomUUID());
  const guard = sql`exists(select 1 from ${savedShowingTours} where ${guardedTour(ctx, access, d.expectedUpdatedAt)}) and ${snapshotGuard(ctx, access)} and ${sourceGuard(ctx, source)} and not exists(select 1 from ${showings} where ${overlapWhere(ctx, slots)})`;
  const writes: Write[] = [...locks(ctx, [access.row.contactId], [source], id, true), ctx.db.insert(savedTourRequests).values({ actorUserId: ctx.actor.userId, requestId: d.requestId, tourId: id, action: "schedule", payloadHash: sql`case when ${guard} then ${hash}::text else null end`, result: { tourId: id, showingIds }, createdAt: now })];
  slots.forEach((slot, position) => {
    const showingId = showingIds[position], p = properties.get(slot.propertyId)!;
    if (slot.showingId) { if (!slot.kept) writes.push(ctx.db.update(showings).set({ startsAt: new Date(slot.startsAt), endsAt: new Date(slot.endsAt), updatedAt: sql`greatest(date_trunc('milliseconds',${showings.updatedAt})+interval '1 millisecond',${now.toISOString()}::timestamptz)` }).where(eq(showings.id, showingId))); }
    else writes.push(ctx.db.insert(showings).values({ id: showingId, ownerUserId: ctx.actor.userId, brokerageKey: ctx.actor.brokerageKey, contactId: access.row.contactId, sourcePropertyId: p.id, dataset: p.dataset, listingId: p.listingId, mlsNumber: p.mlsNumber, startsAt: new Date(slot.startsAt), endsAt: new Date(slot.endsAt), meetingDetails: "", notes: "", createdAt: now, updatedAt: now, createRequestId: randomUUID(), createPayloadHash: createPayloadHash({ tourId: id, stopId: slot.stopId, requestId: d.requestId, showingId }) }));
    writes.push(ctx.db.update(savedTourStops).set({ position, linkedShowingId: showingId, updatedAt: next }).where(and(eq(savedTourStops.id, slot.stopId), eq(savedTourStops.tourId, id))));
    writes.push(ctx.db.insert(auditEvents).values({ eventType: "showing_updated", actorUserId: ctx.actor.userId, safeMetadata: { showingId, contactId: access.row.contactId, sourcePropertyId: p.id, tourId: id, action: slot.showingId ? slot.kept ? "tour_kept" : "tour_reschedule" : "tour_create", fields: slot.kept ? [] : ["startsAt", "endsAt"] }, createdAt: now }));
  });
  writes.push(ctx.db.update(savedShowingTours).set({ updatedAt: next, lastScheduledAt: now }).where(eq(savedShowingTours.id, id)), audit(ctx, id, access.row.contactId, "schedule", now, showingIds));
  try { await ctx.db.batch(writes as unknown as BatchInput); }
  catch { const replay = await requestReplay(ctx, d.requestId, hash, "schedule", true); if (replay) return replay; const current = await fresh(ctx, id, d.expectedUpdatedAt, state.value.fingerprint); if (!current.ok) return current; return { ok: false, reason: await hasOverlap(ctx, slots) ? "time_conflict" : "stale_review" }; }
  return await requestReplay(ctx, d.requestId, hash, "schedule", true) ?? { ok: false, reason: "unavailable" };
}
