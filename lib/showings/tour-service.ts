import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { contacts, contactProperties, propertyLists, showings } from "../db/schema.ts";
import { isRecordId } from "../db/ids.ts";
import { loadContact } from "../contacts/access.ts";
import { displayName } from "../contacts/domain.ts";
import { loadPropertyList, type PropertyListScope } from "../contacts/property-lists-service.ts";
import type { Ctx, ServiceFailure } from "../contacts/service.ts";
import type { PropertyMlsProvider, PropertyResolution } from "../contacts/properties.ts";
import { normalizePropertyMlsNumber } from "../contacts/properties.ts";
import { businessDayKey, businessDayStart, nextDay } from "../metrics/business-day.ts";
import { showingVisibility } from "./service.ts";
import { canonicalTourFingerprint, tourPlanInputSchema, validTourCoordinates, TOUR_MAX_STOPS, TOUR_CANDIDATE_PAGE_SIZE, TOUR_DEFAULT_VISIT_MINUTES,
  type TourContext, type TourStop, type TourRoutingProvider, type TourRecommendation, type TourRoutingStop,
} from "./tour-domain.ts";

export type TourFailure = ServiceFailure | "invalid_tour_query" | "invalid_tour_plan" | "stale_context" | "source_unavailable" | "unresolved_stops" | "not_configured" | "invalid_route" | "unreachable" | "infeasible" | "unresolved_endpoint";
export type TourResult<T> = { ok: true; value: T } | { ok: false; reason: TourFailure };
type Reference = { id: string; listId: string; dataset: string; listingId: string; mlsNumber: string; removedAt: Date | null; updatedAt: Date };
const referenceFields = { id: contactProperties.id, listId: contactProperties.listId, dataset: contactProperties.dataset, listingId: contactProperties.listingId, mlsNumber: contactProperties.mlsNumber, removedAt: contactProperties.removedAt, updatedAt: contactProperties.updatedAt };
type Clicked = { id: string; contactId: string; sourcePropertyId: string; dataset: string; listingId: string; mlsNumber: string; startsAt: Date; endsAt: Date; status: string; updatedAt: Date };
type Base = { clicked: Clicked; contactName: string; contactUpdatedAt: string; day: string; from: string; to: string; source: Reference | null; list: PropertyListScope | null };
type Appointment = { propertyId: string; showingId: string; startsAt: string; endsAt: string; updatedAt: string; appointmentCount: number };

async function baseFor(ctx: Ctx, id: string): Promise<TourResult<Base>> {
  if (!isRecordId(id)) return { ok: false, reason: "not_found" };
  const [clicked] = await ctx.db.select({ id: showings.id, contactId: showings.contactId, sourcePropertyId: showings.sourcePropertyId, dataset: showings.dataset, listingId: showings.listingId, mlsNumber: showings.mlsNumber, startsAt: showings.startsAt, endsAt: showings.endsAt, status: showings.status, updatedAt: showings.updatedAt }).from(showings).where(and(eq(showings.id, id), showingVisibility(ctx))).limit(1);
  if (!clicked) return { ok: false, reason: "not_found" };
  const contact = await loadContact(ctx, clicked.contactId); if (!contact.ok) return contact;
  const [source] = await ctx.db.select(referenceFields).from(contactProperties).where(eq(contactProperties.id, clicked.sourcePropertyId)).limit(1);
  const loaded = source ? await loadPropertyList(ctx, source.listId) : null;
  const day = businessDayKey(clicked.startsAt);
  return { ok: true, value: { clicked, contactName: displayName(contact.row), contactUpdatedAt: contact.row.updatedAt.toISOString(), day,
    from: businessDayStart(day).toISOString(), to: businessDayStart(nextDay(day)).toISOString(), source: source ?? null, list: loaded?.ok ? loaded.value : null } };
}
function scheduledWhere(ctx: Ctx, base: Base) {
  return and(showingVisibility(ctx), eq(showings.contactId, base.clicked.contactId), eq(showings.status, "scheduled"),
    sql`${showings.startsAt}>=${base.from}::timestamptz and ${showings.startsAt}<${base.to}::timestamptz`, eq(contactProperties.listId, base.list!.row.id));
}
async function facts(ctx: Ctx, base: Base): Promise<{ token: string; totalStops: number; totalScheduledShowings: number }> {
  if (!base.list) return { token: createHash("sha256").update(canonicalTourFingerprint({ actor: ctx.actor.userId, book: ctx.actor.brokerageKey, clicked: base.clicked, contactRevision: base.contactUpdatedAt, source: "unavailable" })).digest("hex"), totalStops: 1, totalScheduledShowings: 0 };
  const where = scheduledWhere(ctx, base);
  const result = await ctx.db.execute<{ memberships: string; appointments: string; total_scheduled: number; total_distinct: number; contains_clicked: boolean }>(sql`select
    (select md5(coalesce(jsonb_agg(jsonb_build_array(p.id,p.list_id,p.dataset,p.listing_id,p.mls_number,p.updated_at,p.removed_at) order by p.id),'[]'::jsonb)::text) from contact_properties p where p.list_id=${base.list.row.id}::uuid) as memberships,
    (select md5(coalesce(jsonb_agg(jsonb_build_array(${showings.id},${showings.sourcePropertyId},${showings.startsAt},${showings.endsAt},${showings.updatedAt},${showings.status}) order by ${showings.id}),'[]'::jsonb)::text) from ${showings} join ${contactProperties} on ${contactProperties.id}=${showings.sourcePropertyId} where ${where}) as appointments,
    (select count(*)::int from ${showings} join ${contactProperties} on ${contactProperties.id}=${showings.sourcePropertyId} where ${where}) as total_scheduled,
    (select count(distinct ${showings.sourcePropertyId})::int from ${showings} join ${contactProperties} on ${contactProperties.id}=${showings.sourcePropertyId} where ${where}) as total_distinct,
    exists(select 1 from ${showings} join ${contactProperties} on ${contactProperties.id}=${showings.sourcePropertyId} where ${where} and ${showings.sourcePropertyId}=${base.clicked.sourcePropertyId}::uuid) as contains_clicked`);
  const row = result.rows[0];
  const token = createHash("sha256").update(canonicalTourFingerprint({ actor: ctx.actor.userId, book: ctx.actor.brokerageKey,
    clicked: { id: base.clicked.id, contactId: base.clicked.contactId, sourcePropertyId: base.clicked.sourcePropertyId, status: base.clicked.status, startsAt: base.clicked.startsAt.toISOString(), endsAt: base.clicked.endsAt.toISOString(), updatedAt: base.clicked.updatedAt.toISOString() },
    contactRevision: base.contactUpdatedAt, list: { id: base.list.row.id, contactId: base.list.row.contactId, name: base.list.row.name, updatedAt: base.list.row.updatedAt.toISOString() }, day: base.day, memberships: row.memberships, appointments: row.appointments })).digest("hex");
  return { token, totalStops: row.total_distinct + (row.contains_clicked ? 0 : 1), totalScheduledShowings: row.total_scheduled };
}
async function appointments(ctx: Ctx, base: Base, ids?: string[]): Promise<Appointment[]> {
  const result = await ctx.db.execute<{ propertyId: string; showingId: string; startsAt: Date | string; endsAt: Date | string; updatedAt: Date | string; appointmentCount: number }>(sql`
    with scoped as (
      select ${showings.sourcePropertyId} as "propertyId",${showings.id} as "showingId",${showings.startsAt} as "startsAt",${showings.endsAt} as "endsAt",${showings.updatedAt} as "updatedAt",
        count(*) over(partition by ${showings.sourcePropertyId})::int as "appointmentCount",
        row_number() over(partition by ${showings.sourcePropertyId} order by (${showings.id}=${base.clicked.id}::uuid) desc,${showings.startsAt},${showings.id}) as rank
      from ${showings} join ${contactProperties} on ${contactProperties.id}=${showings.sourcePropertyId}
      where ${scheduledWhere(ctx, base)} ${ids ? sql`and ${inArray(showings.sourcePropertyId, ids)}` : sql``}
    ) select "propertyId","showingId","startsAt","endsAt","updatedAt","appointmentCount" from scoped where rank=1 order by "startsAt","showingId" limit ${ids ? TOUR_MAX_STOPS : TOUR_MAX_STOPS + 1}`);
  return result.rows.map(row => ({ ...row, startsAt: new Date(row.startsAt).toISOString(), endsAt: new Date(row.endsAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() }));
}
function makeStop(ref: Reference, appointment?: Appointment): TourStop {
  return { propertyId: ref.id, ...(appointment ? { showingId: appointment.showingId, appointment: { startsAt: appointment.startsAt, endsAt: appointment.endsAt, updatedAt: appointment.updatedAt }, appointmentCount: appointment.appointmentCount } : {}),
    dataset: ref.dataset, listingId: ref.listingId, mlsNumber: ref.mlsNumber, coordinates: null, locationStatus: ref.removedAt ? "removed" : "unavailable", selectable: false,
    ...(appointment && appointment.appointmentCount > 1 ? { selectionIssue: "multiple_appointments" as const } : {}),
    visitMinutes: appointment ? (Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)) / 60_000 : TOUR_DEFAULT_VISIT_MINUTES };
}
function clickedStop(base: Base): TourStop {
  const ref = base.source ?? { id: base.clicked.sourcePropertyId, listId: "", dataset: base.clicked.dataset, listingId: base.clicked.listingId, mlsNumber: base.clicked.mlsNumber, removedAt: null, updatedAt: base.clicked.updatedAt };
  return makeStop(ref, base.clicked.status === "scheduled" ? { propertyId: ref.id, showingId: base.clicked.id, startsAt: base.clicked.startsAt.toISOString(), endsAt: base.clicked.endsAt.toISOString(), updatedAt: base.clicked.updatedAt.toISOString(), appointmentCount: 1 } : undefined);
}
async function locate(stops: TourStop[], provider?: PropertyMlsProvider): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, stops.length) }, async () => {
    while (next < stops.length) {
      const stop = stops[next++]; if (stop.locationStatus === "removed" || stop.locationStatus === "source_unavailable") continue;
      if (!provider) { stop.locationStatus = "not_configured"; continue; }
      let result: PropertyResolution;
      try { result = await provider.get(stop.dataset, stop.listingId, stop.mlsNumber); } catch { result = { ok: false, reason: "unavailable" }; }
      if (!result?.ok) { stop.locationStatus = result?.reason === "not_found" || result?.reason === "not_configured" ? result.reason : "unavailable"; continue; }
      const listing = result.value?.listing;
      if (!listing || listing.source !== "mls" || result.value.dataset !== stop.dataset || listing.id !== stop.listingId || normalizePropertyMlsNumber(listing.mlsNumber) !== stop.mlsNumber) { stop.locationStatus = "not_found"; continue; }
      if (listing.addressWithheld) { stop.locationStatus = "withheld"; continue; }
      if (listing.address) stop.address = listing.address;
      if (listing.city) stop.city = listing.city;
      if (!validTourCoordinates(listing.coordinates)) { stop.locationStatus = "missing_coordinates"; continue; }
      stop.coordinates = { lat: listing.coordinates.lat, lng: listing.coordinates.lng }; stop.locationStatus = "available"; stop.selectable = stop.selectionIssue === undefined;
    }
  }));
}

export async function getShowingTour(ctx: Ctx, id: string, mlsProvider: PropertyMlsProvider | undefined, routing: TourRoutingProvider, options: { page?: number } = {}, now = new Date()): Promise<TourResult<TourContext>> {
  const loaded = await baseFor(ctx, id); if (!loaded.ok) return loaded;
  const base = loaded.value, requestedPage = options.page ?? 1;
  if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > 1_000_000) return { ok: false, reason: "invalid_tour_query" };
  const fingerprint = await facts(ctx, base);
  const context: TourContext = { showingId: id, contactId: base.clicked.contactId, contactName: base.contactName, list: base.list ? { id: base.list.row.id, name: base.list.row.name } : null, day: base.day,
    stops: [], totalStops: fingerprint.totalStops, totalScheduledShowings: fingerprint.totalScheduledShowings, stopsTruncated: false,
    candidates: { items: [], total: 0, page: 1, pageSize: TOUR_CANDIDATE_PAGE_SIZE }, availability: base.list ? routing.map.kind === "not_configured" ? "not_configured" : base.day < businessDayKey(now) ? "past_day" : "available" : "source_unavailable",
    contextToken: fingerprint.token, generatedAt: now.toISOString(), defaultStartsAt: base.clicked.startsAt > now ? base.clicked.startsAt.toISOString() : null, warnings: [], map: routing.map };
  if (!base.list) { const fallback = clickedStop(base); fallback.coordinates = null; fallback.locationStatus = "source_unavailable"; fallback.selectable = false; context.stops = [fallback]; return { ok: true, value: context }; }
  const scheduled = await appointments(ctx, base);
  const selectedAppointments = scheduled.filter(row => row.propertyId !== base.clicked.sourcePropertyId).slice(0, TOUR_MAX_STOPS - 1);
  const clickedAppointment = scheduled.find(row => row.propertyId === base.clicked.sourcePropertyId) ?? (await appointments(ctx, base, [base.clicked.sourcePropertyId]))[0];
  if (clickedAppointment) selectedAppointments.push(clickedAppointment);
  const ids = [...new Set([...selectedAppointments.map(row => row.propertyId), base.clicked.sourcePropertyId])];
  const references = await ctx.db.select(referenceFields).from(contactProperties).where(and(eq(contactProperties.listId, base.list.row.id), inArray(contactProperties.id, ids)));
  const byId = new Map(references.map(row => [row.id, row]));
  context.stops = selectedAppointments.flatMap(appointment => byId.has(appointment.propertyId) ? [makeStop(byId.get(appointment.propertyId)!, appointment)] : []);
  if (!context.stops.some(stop => stop.propertyId === base.clicked.sourcePropertyId)) context.stops.push(clickedStop(base));
  context.stops.sort((a, b) => Date.parse(a.appointment?.startsAt ?? base.clicked.startsAt.toISOString()) - Date.parse(b.appointment?.startsAt ?? base.clicked.startsAt.toISOString()) || a.propertyId.localeCompare(b.propertyId));
  context.stopsTruncated = fingerprint.totalStops > context.stops.length;
  const candidateWhere = and(eq(contactProperties.listId, base.list.row.id), isNull(contactProperties.removedAt), neProperty(contactProperties.id, base.clicked.sourcePropertyId),
    sql`not exists(select 1 from ${showings} where ${showingVisibility(ctx)} and ${showings.contactId}=${base.clicked.contactId}::uuid and ${showings.sourcePropertyId}=${contactProperties.id} and ${showings.status}='scheduled' and ${showings.startsAt}>=${base.from}::timestamptz and ${showings.startsAt}<${base.to}::timestamptz)`);
  const [count] = await ctx.db.select({ total: sql<number>`count(*)::int` }).from(contactProperties).where(candidateWhere);
  const total = count?.total ?? 0, page = Math.min(requestedPage, Math.max(1, Math.ceil(total / TOUR_CANDIDATE_PAGE_SIZE)));
  const candidates = await ctx.db.select(referenceFields).from(contactProperties).where(candidateWhere).orderBy(contactProperties.createdAt, contactProperties.id).limit(TOUR_CANDIDATE_PAGE_SIZE).offset((page - 1) * TOUR_CANDIDATE_PAGE_SIZE);
  context.candidates = { items: candidates.map(row => makeStop(row)), total, page, pageSize: TOUR_CANDIDATE_PAGE_SIZE };
  await locate([...context.stops, ...context.candidates.items], mlsProvider);
  const afterLocations = await baseFor(ctx, id); if (!afterLocations.ok) return afterLocations;
  if (!afterLocations.value.list) return { ok: false, reason: "source_unavailable" };
  if ((await facts(ctx, afterLocations.value)).token !== fingerprint.token) return { ok: false, reason: "stale_context" };
  const firstScheduled = context.stops.filter(stop => stop.selectable && stop.appointment).map(stop => stop.appointment!.startsAt).sort()[0];
  context.defaultStartsAt = firstScheduled && Date.parse(firstScheduled) > now.getTime() ? firstScheduled : null;
  if (context.stops.some(stop => stop.selectionIssue === "multiple_appointments")) context.warnings.push("A property has multiple appointments on this day. Review those appointments separately.");
  if (context.stopsTruncated) context.warnings.push("Only eight showing properties are displayed. Choose a smaller tour explicitly.");
  return { ok: true, value: context };
}
function neProperty(column: typeof contactProperties.id, id: string) { return sql`${column}<>${id}::uuid`; }

export async function recommendShowingTour(ctx: Ctx, id: string, input: unknown, mlsProvider: PropertyMlsProvider | undefined, routing: TourRoutingProvider, now = new Date()): Promise<TourResult<TourRecommendation>> {
  const loaded = await baseFor(ctx, id); if (!loaded.ok) return loaded;
  const base = loaded.value; if (!base.list) return { ok: false, reason: "source_unavailable" };
  const parsed = tourPlanInputSchema.safeParse(input); if (!parsed.success) return { ok: false, reason: "invalid_tour_plan" };
  const d = parsed.data;
  if (Date.parse(d.startsAt) <= now.getTime() || businessDayKey(new Date(d.startsAt)) !== base.day) return { ok: false, reason: "invalid_tour_plan" };
  const fingerprint = await facts(ctx, base); if (d.contextToken !== fingerprint.token) return { ok: false, reason: "stale_context" };
  if (routing.map.kind === "not_configured") return { ok: false, reason: "not_configured" };
  const references = await ctx.db.select(referenceFields).from(contactProperties).where(and(eq(contactProperties.listId, base.list.row.id), isNull(contactProperties.removedAt), inArray(contactProperties.id, d.selectedPropertyIds)));
  if (references.length !== d.selectedPropertyIds.length) return { ok: false, reason: "invalid_tour_plan" };
  const appointmentRows = await appointments(ctx, base, d.selectedPropertyIds), appointmentById = new Map(appointmentRows.map(row => [row.propertyId, row]));
  const refById = new Map(references.map(row => [row.id, row]));
  const stops = d.selectedPropertyIds.map(propertyId => makeStop(refById.get(propertyId)!, appointmentById.get(propertyId)));
  await locate(stops, mlsProvider);
  if (stops.some(stop => !stop.selectable || !stop.coordinates)) return { ok: false, reason: "unresolved_stops" };
  const current = await baseFor(ctx, id); if (!current.ok) return current;
  if (!current.value.list) return { ok: false, reason: "source_unavailable" };
  if ((await facts(ctx, current.value)).token !== fingerprint.token) return { ok: false, reason: "stale_context" };
  const routeStops: TourRoutingStop[] = stops.map(stop => ({ propertyId: stop.propertyId, coordinates: stop.coordinates!, visitMinutes: stop.visitMinutes, ...(stop.appointment ? { fixedStartsAt: stop.appointment.startsAt } : {}) }));
  try {
    const result = await routing.recommend(routeStops, { startPropertyId: d.startPropertyId, startsAt: d.startsAt, bufferMinutes: d.bufferMinutes, respectAppointments: d.respectAppointments, returnToStart: d.returnToStart });
    const afterRouting = await baseFor(ctx, id); if (!afterRouting.ok) return afterRouting;
    if (!afterRouting.value.list) return { ok: false, reason: "source_unavailable" };
    if ((await facts(ctx, afterRouting.value)).token !== fingerprint.token) return { ok: false, reason: "stale_context" };
    return result.ok ? { ok: true, value: { ...result.value, resolvedStops: stops } } : result;
  } catch { return { ok: false, reason: "unavailable" }; }
}
