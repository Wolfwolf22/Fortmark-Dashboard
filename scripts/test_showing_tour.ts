/** Tour context/recommendations are read-only and scoped; PostgreSQL+MLS+roads are isolated fakes. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createLocalContactDb } from "./helpers/contact-test-db.ts";
import { contacts, contactProperties, dashboardUsers, propertyLists, showings } from "../lib/db/schema.ts";
import type { Ctx } from "../lib/contacts/service.ts";
import type { Listing } from "../lib/data/types.ts";
import type { PropertyMlsProvider } from "../lib/contacts/properties.ts";
import { getShowingTour, recommendShowingTour } from "../lib/showings/tour-service.ts";
import { optimizeTour } from "../lib/showings/tour-optimizer.ts";
import { canonicalTourFingerprint, readTourContextQuery, tourPlanInputSchema, validTourCoordinates, type TourPlanInput, type TourRoutingProvider, type TourRoutingStop, type TourPlanOptions, type TourContext } from "../lib/showings/tour-domain.ts";

let passed = 0;
function check(name: string, value: unknown): asserts value { assert.ok(value, name); passed++; }
const now = new Date("2026-11-02T15:00:00.000Z");
for (const point of [{ lat: NaN, lng: 0 }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: "26", lng: -80 }, null]) check("invalidcoordinatesrefused", !validTourCoordinates(point));
check("coordinateboundaryandinternationalzeroaccepted", validTourCoordinates({ lat: 0, lng: 0 }) && validTourCoordinates({ lat: -90, lng: 180 }));
check("canonicalfingerprintkeyorderstable", canonicalTourFingerprint({ z: 1, a: { b: 2, a: 3 } }) === canonicalTourFingerprint({ a: { a: 3, b: 2 }, z: 1 }));
for (const query of ["page=0", "page=-1", "page=1.5", "page=1&page=2", "coords=private", "contactName=private"]) check("contextqueryallowsonlyboundedpage", readTourContextQuery(new URLSearchParams(query)) === null);

const { pg, db } = await createLocalContactDb();
const actor = { userId: randomUUID(), role: "agent" as const, brokerageKey: "fortmark" }, other = { userId: randomUUID(), role: "agent" as const, brokerageKey: "fortmark" }, admin = { userId: randomUUID(), role: "admin" as const, brokerageKey: "fortmark" };
const ctx: Ctx = { actor, db }, reader: Ctx = { actor: { ...actor, role: "member" }, db };
const contactId = randomUUID(), otherClientId = randomUUID(), sourceListId = randomUUID(), otherListId = randomUUID();
const properties = Array.from({ length: 31 }, (_, index) => ({ id: randomUUID(), listId: sourceListId, contactId, dataset: "synthetic", listingId: `tour-key-${index}`, mlsNumber: `T${index}`, createdAt: new Date(now.getTime() + index), updatedAt: now, notes: `Private property research ${index}` }));
const starts = (hour: number, day = 3) => new Date(Date.UTC(2026, 10, day, hour)).toISOString();
const showingRows = properties.slice(0, 6).map((property, index) => ({ id: randomUUID(), ownerUserId: actor.userId, brokerageKey: actor.brokerageKey, contactId, sourcePropertyId: property.id, dataset: property.dataset, listingId: property.listingId, mlsNumber: property.mlsNumber,
  startsAt: new Date(starts(15 + index)), endsAt: new Date(Date.parse(starts(15 + index)) + 30 * 60_000), meetingDetails: "Do not leak meeting details", notes: "Do not leak showing research", createdAt: now, updatedAt: now, createRequestId: randomUUID(), createPayloadHash: "a".repeat(64) }));
let mlsCalls = 0, inFlight = 0, maxFlight = 0, roadCalls = 0;
const coordinateOverrides = new Map<string, { lat: number; lng: number } | null>(), withheld = new Set<string>();
const mls: PropertyMlsProvider = { lookup: async () => { throw new Error("Tour never searches MLS"); }, get: async (dataset, id, number) => {
  mlsCalls++; inFlight++; maxFlight = Math.max(maxFlight, inFlight); await new Promise(resolve => setTimeout(resolve, 1)); inFlight--;
  const index = Number(id.replace("tour-key-", ""));
  const coordinates = coordinateOverrides.has(id) ? coordinateOverrides.get(id) : { lat: 26.1 + index * .001, lng: -80.1 - index * .001 };
  const listing: Listing = { id, mlsNumber: number, source: "mls", address: "Synthetic address " + index, city: "Sample", zip: "00000", status: "active", propertyType: "condo", listPrice: 1, beds: 1, baths: 1, sqft: 1, listedDate: now.toISOString(), agentId: "", photos: [], description: "Not in route DTO", priceHistory: [], ...(coordinates ? { coordinates } : {}), addressWithheld: withheld.has(id) };
  return { ok: true, value: { dataset, listing } };
} };
let receivedStops: TourRoutingStop[] = [], receivedOptions: TourPlanOptions | null = null;
const routing: TourRoutingProvider = { map: { kind: "sample" }, recommend: async (stops, options) => {
  roadCalls++; receivedStops = stops; receivedOptions = options;
  const matrix = stops.map((_, i) => stops.map((__, j) => ({ durationSeconds: i === j ? 0 : 120, distanceMeters: i === j ? 0 : 1000 })));
  const optimized = optimizeTour(stops, matrix, options);
  return optimized.ok ? { ok: true, value: { ...optimized.value, computedAt: now.toISOString(), trafficAsOf: now.toISOString(), trafficLabel: "Explicit synthetic road matrix", source: "sample" } } : optimized;
} };
async function context(id = showingRows[2].id, page = 1) { const result = await getShowingTour(ctx, id, mls, routing, { page }, now); check("ownedtourcontextloads", result.ok); return result.value; }
function body(value: TourContext, selected = value.stops.filter(stop => stop.selectable).map(stop => stop.propertyId)): TourPlanInput {
  return { selectedPropertyIds: selected, startPropertyId: selected[0], startsAt: value.defaultStartsAt ?? starts(15), respectAppointments: true, bufferMinutes: 5, returnToStart: false, contextToken: value.contextToken };
}
async function snapshot() { return (await pg.query<{ facts: string }>("select md5((select coalesce(jsonb_agg(t order by t.id),'[]'::jsonb)::text from contacts t)||'|'||(select coalesce(jsonb_agg(t order by t.id),'[]'::jsonb)::text from property_lists t)||'|'||(select coalesce(jsonb_agg(t order by t.id),'[]'::jsonb)::text from contact_properties t)||'|'||(select coalesce(jsonb_agg(t order by t.id),'[]'::jsonb)::text from showings t)||'|'||(select coalesce(jsonb_agg(t order by t.id),'[]'::jsonb)::text from audit_events t)) as facts")).rows[0].facts; }
try {
  await db.insert(dashboardUsers).values([actor, other, admin].map((user, index) => ({ id: user.userId, role: user.role, clerkUserId: `synthetic_tour_${index}`, primaryEmail: `tour${index}@example.test`, status: "active" as const })));
  await db.insert(contacts).values([{ id: contactId, assignedAgentUserId: actor.userId, firstName: "Tour client", updatedAt: now }, { id: otherClientId, assignedAgentUserId: actor.userId, firstName: "Another client", updatedAt: now }]);
  await db.insert(propertyLists).values([{ id: sourceListId, ownerUserId: actor.userId, brokerageKey: "fortmark", contactId, name: "Authorized tour list", createdAt: now, updatedAt: now }, { id: otherListId, ownerUserId: actor.userId, brokerageKey: "fortmark", contactId, name: "Separate list", createdAt: now, updatedAt: now }]);
  await db.insert(contactProperties).values(properties);
  await db.insert(showings).values(showingRows);
  const separatePropertyId = randomUUID(); await db.insert(contactProperties).values({ id: separatePropertyId, listId: otherListId, contactId, dataset: "synthetic", listingId: "other-list", mlsNumber: "L123" });
  const decoys = [
    { ...showingRows[0], id: randomUUID(), sourcePropertyId: separatePropertyId, listingId: "other-list", mlsNumber: "L123", createRequestId: randomUUID() },
    { ...showingRows[0], id: randomUUID(), ownerUserId: other.userId, createRequestId: randomUUID() },
    { ...showingRows[0], id: randomUUID(), contactId: otherClientId, createRequestId: randomUUID() },
    { ...showingRows[0], id: randomUUID(), startsAt: new Date("2026-11-03T02:00:00Z"), endsAt: new Date("2026-11-03T02:30:00Z"), createRequestId: randomUUID() },
    { ...showingRows[0], id: randomUUID(), startsAt: new Date("2026-11-04T05:00:00Z"), endsAt: new Date("2026-11-04T05:30:00Z"), createRequestId: randomUUID() },
  ];
  await db.insert(showings).values(decoys);
  const before = await snapshot(), first = await context();
  check("contextgroupsonlysameownerclientlistNYday", first.stops.length === 6 && first.totalStops === 6 && first.totalScheduledShowings === 6 && first.day === "2026-11-03" && first.stops.every(stop => showingRows.some(showing => showing.id === stop.showingId)));
  check("openinglaterappointmentdefaultsearliestbookedstart", first.showingId === showingRows[2].id && first.defaultStartsAt === showingRows[0].startsAt.toISOString());
  check("candidatepageisboundedwithhonestcount", first.candidates.items.length === 24 && first.candidates.total === 25 && first.candidates.pageSize === 24);
  check("allfreshMLSworkboundedtofourrequests", maxFlight === 4 && mlsCalls === 30);
  check("projectionexcludesprivatepropertyandshowingresearch", !/Private property|Do not leak|Not in route DTO/.test(JSON.stringify(first)));
  const second = await context(undefined, 2); check("candidatepagingdoesnotchangerevisionorappointments", second.candidates.items.length === 1 && second.contextToken === first.contextToken && second.stops.length === 6);
  const recommended = await recommendShowingTour(ctx, first.showingId, body(first), mls, routing, now);
  check("explicitrecommendationusesrealproviderinterfaceandsameauthoritativecoords", recommended.ok && recommended.value.resolvedStops?.length === 6 && recommended.value.legs.every(leg => leg.driveSeconds === 120) && roadCalls === 1);
  check("readcontextandrecommendationneverwritebusinessstate", await snapshot() === before);
  const selectedOrder = [properties[0].id, properties[5].id, properties[1].id, properties[4].id, properties[2].id, properties[3].id];
  const flexible = await recommendShowingTour(ctx, first.showingId, { ...body(first, selectedOrder), respectAppointments: false }, mls, routing, now);
  check("selectionorderpreservedascomparisonbaseline", flexible.ok && receivedStops.map(stop => stop.propertyId).join() === selectedOrder.join() && flexible.value.currentOrderedPropertyIds.join() === selectedOrder.join());
  const automatic = await recommendShowingTour(ctx, first.showingId, { ...body(first), startPropertyId: "auto" }, mls, routing, now);
  check("automaticfirststopacceptedwithouttrustingclientlocations", automatic.ok && (receivedOptions as TourPlanOptions | null)?.startPropertyId === "auto" && automatic.value.orderedPropertyIds[0] === properties[0].id);
  check("routerneverreceivesclientnamesMLSorprivateresearch", receivedStops.every(stop => Object.keys(stop).every(key => ["propertyId", "coordinates", "visitMinutes", "fixedStartsAt"].includes(key))) && !JSON.stringify([receivedStops, receivedOptions]).includes("Tour client"));
  const beforeUnauthorized = { mls: mlsCalls, roads: roadCalls };
  check("admincannotreadanotherownershowingtour", !(await getShowingTour({ actor: admin, db }, first.showingId, mls, routing, {}, now)).ok);
  check("otherownercannotcalculateanotherownershowingtour", !(await recommendShowingTour({ actor: other, db }, first.showingId, body(first), mls, routing, now)).ok && mlsCalls === beforeUnauthorized.mls && roadCalls === beforeUnauthorized.roads);
  check("membercanrequestreadonlyrecommendationonownvisiblerecord", (await recommendShowingTour(reader, first.showingId, body(first), mls, routing, now)).ok);
  for (const bad of [{ ...body(first), selectedPropertyIds: [properties[0].id] }, { ...body(first), selectedPropertyIds: [properties[0].id, properties[0].id] }, { ...body(first), startPropertyId: separatePropertyId }, { ...body(first), coordinates: { lat: 26, lng: -80 } }]) check("clientcannotinjectauthorityorinvalidselection", !tourPlanInputSchema.safeParse(bad).success);
  const beforeInvalid = roadCalls;
  check("wronglistselectionrefusedbeforeexternalroute", !(await recommendShowingTour(ctx, first.showingId, { ...body(first), selectedPropertyIds: [properties[0].id, separatePropertyId] }, mls, routing, now)).ok && roadCalls === beforeInvalid);
  for (const startsAt of ["2026-11-01T15:00:00Z", "2026-11-04T15:00:00Z"]) { const result = await recommendShowingTour(ctx, first.showingId, { ...body(first), startsAt }, mls, routing, now); check("pastorwrongNYdayrouteisnotcalculated", !result.ok && result.reason === "invalid_tour_plan"); }
  const unconfiguredCalls = { mls: mlsCalls, road: roadCalls };
  const unconfigured = await recommendShowingTour(ctx, first.showingId, body(first), mls, { ...routing, map: { kind: "not_configured" } }, now);
  check("missingroutingconfigurationmakesNOoutboundwork", !unconfigured.ok && unconfigured.reason === "not_configured" && mlsCalls === unconfiguredCalls.mls && roadCalls === unconfiguredCalls.road);
  withheld.add(properties[0].listingId);
  const withheldContext = await context(); check("withheldaddressneverexposescoordinatesoraddress", withheldContext.stops.find(stop => stop.propertyId === properties[0].id)?.locationStatus === "withheld" && !withheldContext.stops.find(stop => stop.propertyId === properties[0].id)?.address && withheldContext.stops.find(stop => stop.propertyId === properties[0].id)?.coordinates === null);
  const beforeWithheld = roadCalls, refusedWithheld = await recommendShowingTour(ctx, first.showingId, body(first), mls, routing, now);
  check("withheldlocationhasnofabricatedroadtime", !refusedWithheld.ok && refusedWithheld.reason === "unresolved_stops" && roadCalls === beforeWithheld);
  withheld.clear(); coordinateOverrides.set(properties[1].listingId, { lat: 91, lng: -80 });
  const invalidCoordinates = await recommendShowingTour(ctx, first.showingId, body(first), mls, routing, now); check("invalidcoordinatesneverreachroads", !invalidCoordinates.ok && invalidCoordinates.reason === "unresolved_stops");
  coordinateOverrides.set(properties[1].listingId, { lat: 27.123, lng: -81.456 });
  const changedCoordinates = await recommendShowingTour(ctx, first.showingId, body(first), mls, routing, now);
  check("freshPOSTcoordinatesreturnedwiththeactualroutemarkers", changedCoordinates.ok && changedCoordinates.value.resolvedStops?.find(stop => stop.propertyId === properties[1].id)?.coordinates?.lat === 27.123 && receivedStops.find(stop => stop.propertyId === properties[1].id)?.coordinates.lat === 27.123);
  coordinateOverrides.clear();
  const roadFailure = await recommendShowingTour(ctx, first.showingId, body(first), mls, { ...routing, recommend: async () => ({ ok: false, reason: "unreachable" }) }, now);
  check("missingroadconnectionneverbecomesstraightlinedriving", !roadFailure.ok && roadFailure.reason === "unreachable");
  await db.update(showings).set({ notes: "Unrelated client's changed notes", updatedAt: new Date(now.getTime() + 1000) }).where(eq(showings.id, decoys[2].id));
  check("otherclientchangesdonotinvalidateorrevealcontext", (await context()).contextToken === first.contextToken);
  await db.update(propertyLists).set({ name: "Renamed authorized list", updatedAt: new Date(now.getTime() + 2000) }).where(eq(propertyLists.id, sourceListId));
  const staleCalls = { mls: mlsCalls, roads: roadCalls }, stale = await recommendShowingTour(ctx, first.showingId, body(first), mls, routing, now);
  check("changedlistcontextrefusedBEFOREoutboundwork", !stale.ok && stale.reason === "stale_context" && mlsCalls === staleCalls.mls && roadCalls === staleCalls.roads);
  await context();
  let changedDuringGet = false;
  const changedGetMls: PropertyMlsProvider = { ...mls, get: async (...args) => { if (!changedDuringGet) { changedDuringGet = true; await db.update(contactProperties).set({ updatedAt: new Date(now.getTime() + 2500) }).where(eq(contactProperties.id, properties[0].id)); } return mls.get(...args); } };
  const changedGet = await getShowingTour(ctx, first.showingId, changedGetMls, routing, {}, now);
  check("GETcontextguardrejectschangesduringlocationhydration", !changedGet.ok && changedGet.reason === "stale_context");
  let revokedDuringGet = false;
  const revokedGetMls: PropertyMlsProvider = { ...mls, get: async (...args) => { if (!revokedDuringGet) { revokedDuringGet = true; await db.update(contacts).set({ assignedAgentUserId: other.userId }).where(eq(contacts.id, contactId)); } return mls.get(...args); } };
  const revokedGet = await getShowingTour(ctx, first.showingId, revokedGetMls, routing, {}, now);
  check("GETcontactrevocationduringMLShidesallresolvedlocations", !revokedGet.ok && revokedGet.reason === "not_found");
  await db.update(contacts).set({ assignedAgentUserId: actor.userId }).where(eq(contacts.id, contactId));
  let withdrawnDuringGet = false;
  const withdrawnGetMls: PropertyMlsProvider = { ...mls, get: async (...args) => { if (!withdrawnDuringGet) { withdrawnDuringGet = true; await db.update(propertyLists).set({ ownerUserId: other.userId }).where(eq(propertyLists.id, sourceListId)); } return mls.get(...args); } };
  const withdrawnGet = await getShowingTour(ctx, first.showingId, withdrawnGetMls, routing, {}, now);
  check("GETlistwithdrawalduringMLShidesnameandlocations", !withdrawnGet.ok && withdrawnGet.reason === "source_unavailable");
  await db.update(propertyLists).set({ ownerUserId: actor.userId }).where(eq(propertyLists.id, sourceListId));
  const afterGetRaces = await context();
  let changedDuringMls = false;
  const raceMls: PropertyMlsProvider = { ...mls, get: async (...args) => { if (!changedDuringMls) { changedDuringMls = true; await db.update(contactProperties).set({ updatedAt: new Date(now.getTime() + 3000) }).where(eq(contactProperties.id, properties[0].id)); } return mls.get(...args); } };
  const beforeMlsRace = roadCalls, mlsRace = await recommendShowingTour(ctx, first.showingId, body(afterGetRaces), raceMls, routing, now);
  check("contextchangedwhilehydratingcannotreachroadprovider", !mlsRace.ok && mlsRace.reason === "stale_context" && roadCalls === beforeMlsRace);
  const fresh = await context();
  const routingRace: TourRoutingProvider = { ...routing, recommend: async (...args) => { const result = await routing.recommend(...args); await db.update(showings).set({ updatedAt: new Date(now.getTime() + 4000) }).where(eq(showings.id, showingRows[1].id)); return result; } };
  const afterProvider = await recommendShowingTour(ctx, fresh.showingId, body(fresh), mls, routingRace, now);
  check("postprovidercontextguardrefusesstaleresultdisplay", !afterProvider.ok && afterProvider.reason === "stale_context");
  const beforeRevoke = await context();
  const scopeRace: TourRoutingProvider = { ...routing, recommend: async (...args) => { const result = await routing.recommend(...args); await db.update(contacts).set({ assignedAgentUserId: other.userId }).where(eq(contacts.id, contactId)); return result; } };
  const revoked = await recommendShowingTour(ctx, beforeRevoke.showingId, body(beforeRevoke), mls, scopeRace, now);
  check("postprovidercontactrevocationhidesrouteandresolvedlocations", !revoked.ok && revoked.reason === "not_found");
  await db.update(contacts).set({ assignedAgentUserId: actor.userId }).where(eq(contacts.id, contactId));
  await db.update(propertyLists).set({ ownerUserId: other.userId }).where(eq(propertyLists.id, sourceListId));
  const inaccessibleCalls = mlsCalls, unavailableSource = await context();
  check("inaccessiblesourcelistneverleaksnamecandidatesorlocations", unavailableSource.list === null && unavailableSource.availability === "source_unavailable" && unavailableSource.candidates.total === 0 && unavailableSource.stops.length === 1 && !unavailableSource.stops[0].selectable && unavailableSource.stops[0].coordinates === null && mlsCalls === inaccessibleCalls && !JSON.stringify(unavailableSource).includes("Renamed authorized"));
  const sourceRefusal = await recommendShowingTour(ctx, first.showingId, body(first), mls, routing, now); check("inaccessiblesourcecannotberecommended", !sourceRefusal.ok && sourceRefusal.reason === "source_unavailable");
  await db.update(propertyLists).set({ ownerUserId: actor.userId }).where(eq(propertyLists.id, sourceListId));
  await db.update(contactProperties).set({ removedAt: now }).where(eq(contactProperties.id, properties[2].id));
  const removed = await context(); check("clickedremovedmembershipretainedasnonselectableunresolved", removed.stops.some(stop => stop.propertyId === properties[2].id && stop.locationStatus === "removed" && !stop.selectable && stop.coordinates === null));
  await db.update(contactProperties).set({ removedAt: null }).where(eq(contactProperties.id, properties[2].id));
  const lateNy = { ...showingRows[0], id: randomUUID(), sourcePropertyId: properties[6].id, listingId: properties[6].listingId, mlsNumber: properties[6].mlsNumber, startsAt: new Date("2026-11-04T03:30:00Z"), endsAt: new Date("2026-11-04T04:00:00Z"), createRequestId: randomUUID() };
  await db.insert(showings).values(lateNy);
  const easternDay = await context(); check("NYdayincludeslateeveningnextUTCday", easternDay.stops.some(stop => stop.showingId === lateNy.id) && easternDay.totalScheduledShowings === 7);
  await db.insert(showings).values([7, 8].map((index, i) => ({ ...showingRows[0], id: randomUUID(), sourcePropertyId: properties[index].id, listingId: properties[index].listingId, mlsNumber: properties[index].mlsNumber, startsAt: new Date(starts(21 + i)), endsAt: new Date(Date.parse(starts(21 + i)) + 30 * 60_000), createRequestId: randomUUID() })));
  const truncated = await context(lateNy.id); check("boundedcontextalwaysincludesclickedlatepropertyandhonesttotal", truncated.stops.length === 8 && truncated.stops.some(stop => stop.showingId === lateNy.id) && truncated.totalStops === 9 && truncated.stopsTruncated);
  await db.insert(showings).values({ ...showingRows[0], id: randomUUID(), startsAt: new Date(starts(23)), endsAt: new Date(Date.parse(starts(23)) + 30 * 60_000), createRequestId: randomUUID() });
  const repeated = await context(); check("repeatedpropertyappointmentsarenotsilentlycollapsedintofakebooking", repeated.stops.some(stop => stop.propertyId === properties[0].id && stop.appointmentCount === 2 && stop.selectionIssue === "multiple_appointments" && !stop.selectable));
  const past = await getShowingTour(ctx, first.showingId, mls, routing, {}, new Date("2026-11-05T15:00:00Z")); check("historicaldayhasnosuggestedpastdeparture", past.ok && past.value.availability === "past_day" && past.value.defaultStartsAt === null);
  console.log(`${passed}/${passed} showing tour checks passed (isolated PostgreSQL, fake MLS and sample roads; no live access)`);
} finally { await pg.close(); }
