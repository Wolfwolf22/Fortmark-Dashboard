/** Exact route decisions and real provider boundary, using synthetic responses only. */
import assert from "node:assert/strict";
import { optimizeTour, type OptimizationStop, type TourMatrixCell } from "../lib/showings/tour-optimizer.ts";
import { createTourRoutingProvider } from "../lib/showings/tour-routing.ts";
import type { TourRoutingStop } from "../lib/showings/tour-domain.ts";

let checks = 0;
function check(name: string, value: unknown): asserts value { assert.ok(value, name); checks++; }
const at = "2026-11-07T14:00:00.000Z";
const options = { startPropertyId: "A", startsAt: at, bufferMinutes: 0, returnToStart: false, respectAppointments: false };
const matrixOf = (values: (number | null)[][]): TourMatrixCell[][] => values.map(row => row.map(value => ({ durationSeconds: value, distanceMeters: value === null ? null : value * 12 })));
const three: OptimizationStop[] = ["A", "B", "C"].map(propertyId => ({ propertyId, visitMinutes: 15 }));
const values = matrixOf([[0,60,600],[600,0,60],[600,600,0]]);
const plain = optimizeTour(three, values, options);
check("uses road durations rather than property identifier order", plain.ok && plain.value.orderedPropertyIds.join() === "A,B,C" && plain.value.totalDriveSeconds === 120);
const fixed = [{ ...three[0] }, { ...three[1], fixedStartsAt: "2026-11-07T15:00:00.000Z" }, { ...three[2], fixedStartsAt: "2026-11-07T14:30:00.000Z" }];
const fixedResult = optimizeTour(fixed, values, { ...options, respectAppointments: true });
check("fixed appointments constrain order and retain exact booked times", fixedResult.ok && fixedResult.value.orderedPropertyIds.join() === "A,C,B" && fixedResult.value.visits[1].startsAt === fixed[2].fixedStartsAt && fixedResult.value.visits[2].startsAt === fixed[1].fixedStartsAt);
check("an infeasible booked baseline never claims savings", fixedResult.ok && fixedResult.value.savedDriveSeconds === null && fixedResult.value.currentDriveSeconds === null && fixedResult.value.totalWaitSeconds === 600 && fixedResult.value.warnings.some(warning => warning.includes("savings comparison")));
check("infeasible fixed times are refused without moving bookings", optimizeTour(fixed, values, { ...options, startsAt: "2026-11-07T15:00:00Z", respectAppointments: true }).ok === false);
const buffered = optimizeTour(three, values, { ...options, bufferMinutes: 10, returnToStart: true });
check("visit durations, travel buffer and return leg contribute to finish time", buffered.ok && buffered.value.legs.length === 3 && buffered.value.totalDriveSeconds === 720 && buffered.value.endsAt === "2026-11-07T15:27:00.000Z");
const unavailable = optimizeTour(three, matrixOf([[0,null,600],[600,0,60],[600,null,0]]), options);
check("an unavailable route is never zero-minute driving", !unavailable.ok && unavailable.reason === "unreachable");
const detour = optimizeTour(three, matrixOf([[0,null,600],[600,0,60],[600,600,0]]), options);
check("a valid route can avoid a missing road edge", detour.ok && detour.value.orderedPropertyIds.join() === "A,C,B" && detour.value.currentDriveSeconds === null && detour.value.savedDriveSeconds === null);
const tied = matrixOf([[0,60,60],[60,0,60],[60,60,0]]);
check("equal costs have a deterministic stable order", optimizeTour([three[0], three[2], three[1]], tied, options).ok && JSON.stringify(optimizeTour([three[0], three[2], three[1]], tied, options)) === JSON.stringify(optimizeTour([three[0], three[2], three[1]], tied, options)));
const anyFirst = optimizeTour(three, matrixOf([[0,900,900],[60,0,900],[900,60,0]]), { ...options, startPropertyId: "auto" });
check("can recommend the first property rather than anchoring it silently", anyFirst.ok && anyFirst.value.orderedPropertyIds.join() === "C,B,A" && anyFirst.value.totalDriveSeconds === 120 && anyFirst.value.currentOrderedPropertyIds.join() === "A,B,C");

// Independent Held–Karp cost oracle checks the exhaustive production search.
function oracle(matrix: TourMatrixCell[][], returnTrip: boolean): number {
  const n = matrix.length, dp = new Map<string, number>([["1:0", 0]]);
  for (let mask = 1; mask < 1 << n; mask++) for (let last = 0; last < n; last++) {
    const previous = dp.get(`${mask}:${last}`); if (previous === undefined) continue;
    for (let next = 1; next < n; next++) if (!(mask & 1 << next)) {
      const key = `${mask | 1 << next}:${next}`, value = previous + matrix[last][next].durationSeconds!;
      dp.set(key, Math.min(dp.get(key) ?? Infinity, value));
    }
  }
  return Math.min(...Array.from({ length: n - 1 }, (_, i) => dp.get(`${(1 << n) - 1}:${i + 1}`)! + (returnTrip ? matrix[i + 1][0].durationSeconds! : 0)));
}
for (let seed = 1; seed <= 8; seed++) {
  const stops = Array.from({ length: 8 }, (_, i) => ({ propertyId: String.fromCharCode(65 + i), visitMinutes: 30 }));
  const matrix = matrixOf(stops.map((_, from) => stops.map((_, to) => from === to ? 0 : ((from * 37 + to * 53 + seed * (to + 3) * (from + 7)) % 97 + 1) * 30)));
  const snapshot = JSON.stringify([stops, matrix]), result = optimizeTour(stops, matrix, { ...options, returnToStart: seed % 2 === 0 });
  check("eight-stop directed road search agrees with independent minimum cost oracle", result.ok && result.value.totalDriveSeconds === oracle(matrix, seed % 2 === 0));
  check("optimization never mutates appointment or matrix inputs", snapshot === JSON.stringify([stops, matrix]));
}
for (const bad of [
  { stops: [three[0]], matrix: values, options },
  { stops: [...three, three[0]], matrix: values, options },
  { stops: three, matrix: [[{ durationSeconds: Infinity, distanceMeters: 1 }]], options },
  { stops: three, matrix: values, options: { ...options, startsAt: "2026-11-07T14:00:00" } },
  { stops: three, matrix: values, options: { ...options, bufferMinutes: 61 } },
  { stops: three, matrix: values, options: { ...options, startPropertyId: "absent" } },
]) check("invalid tour preferences are refused", !optimizeTour(bad.stops, bad.matrix, bad.options).ok);

const now = new Date("2026-11-02T15:00:00.000Z"), calls: { url: string; init: RequestInit }[] = [];
const routeStops: TourRoutingStop[] = three.map((stop, i) => ({ ...stop, coordinates: { lat: 26 + i / 100, lng: -80 - i / 100 } }));
const enabled = { TOUR_ROUTING_ENABLED: "true", GOOGLE_MAPS_ROUTES_API_KEY: "server-test-key-private", NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "public-browser-test-key" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
let mode = "success";
const fetcher: typeof fetch = async (input, init) => {
  const url = String(input); calls.push({ url, init: init! });
  if (mode === "network") throw Error("Synthetic private upstream error");
  if (mode === "gateway") return json({ error: "private upstream" }, 503);
  if (url.includes("distanceMatrix")) {
    const elements = values.flatMap((row, from) => row.map((cell, to) => ({ ...(from ? { originIndex: from } : {}), ...(to ? { destinationIndex: to } : {}), status: {}, condition: "ROUTE_EXISTS", duration: `${cell.durationSeconds}s`, ...(cell.distanceMeters ? { distanceMeters: cell.distanceMeters } : {}) })));
    if (mode === "partial") elements.pop();
    if (mode === "duplicate") elements[elements.length - 1] = elements[0];
    if (mode === "bad-duration") elements[1].duration = "NaNs";
    if (mode === "no-route") for (const cell of elements) { cell.condition = "ROUTE_NOT_FOUND"; }
    return json(elements);
  }
  if (mode === "line-down") return json({}, 503);
  return json({ routes: [{ polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" } }] });
};
for (const environment of [{}, { ...enabled, TOUR_ROUTING_ENABLED: "false" }, { ...enabled, GOOGLE_MAPS_ROUTES_API_KEY: "" }, { ...enabled, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "" }]) {
  const provider = createTourRoutingProvider(environment, { fetch: fetcher, now: () => now });
  check("explicit activation and both keys are required", provider.map.kind === "not_configured" && (await provider.recommend(routeStops, options)).ok === false && calls.length === 0);
}
const provider = createTourRoutingProvider(enabled, { fetch: fetcher, now: () => now });
check("only the public browser key can enter map configuration", provider.map.kind === "google" && !JSON.stringify(provider.map).includes(enabled.GOOGLE_MAPS_ROUTES_API_KEY));
const routed = await provider.recommend(routeStops, options);
check("synthetic road provider yields matrix-based recommendation and road geometry", routed.ok && routed.value.totalDriveSeconds === 120 && routed.value.mapPolyline && routed.value.source === "google" && calls.length === 2);
check("all provider destinations are fixed official endpoints", calls.every(call => /^https:\/\/routes\.googleapis\.com\/(?:distanceMatrix|directions)\/v2:computeRoute/.test(call.url)));
const sent = calls.map(call => String(call.init.body)).join(" ");
check("only locations and routing preferences leave the provider boundary", !/propertyId|visitMinutes|fixedStartsAt|contact|mls|notes|feedback|server-test|public-browser/.test(sent) && sent.includes("latitude") && sent.includes("departureTime"));
check("requests are private, bounded and traffic-aware", calls.every(call => call.init.method === "POST" && call.init.cache === "no-store" && call.init.signal && JSON.parse(String(call.init.body)).routingPreference === "TRAFFIC_AWARE"));
for (const failure of ["network", "gateway", "partial", "duplicate", "bad-duration", "no-route"]) {
  mode = failure;
  const beforeCount: number = calls.length;
  const result = await provider.recommend(routeStops, options);
  check("unanswered or invalid matrix never gets retried or fabricated", !result.ok && calls.length === beforeCount + 1 && !JSON.stringify(result).includes("private"));
}
mode = "line-down";
const withoutLine = await provider.recommend(routeStops, options);
check("road-line outage preserves real matrix estimates without drawing a fake line", withoutLine.ok && !withoutLine.value.mapPolyline && withoutLine.value.warnings.some(warning => warning.includes("road line")));
mode = "success";
const beforeInvalid = calls.length;
for (const invalid of [{ ...options, startsAt: "2020-01-01T00:00:00Z" }, { ...options, startsAt: "2030-01-01T00:00:00Z" }, { ...options, bufferMinutes: -1 }, { ...options, startPropertyId: "not-a-stop" }]) check("invalid local requests do not spend provider calls", !(await provider.recommend(routeStops, invalid)).ok && calls.length === beforeInvalid);
check("withheld or missing coordinates cannot become routing locations", !(await provider.recommend([{ ...routeStops[0], coordinates: { lat: NaN, lng: -80 } }, ...routeStops.slice(1)], options)).ok && calls.length === beforeInvalid);
console.log(`${checks}/${checks} showing tour routing checks passed (synthetic matrices and fetch only; no live requests)`);
