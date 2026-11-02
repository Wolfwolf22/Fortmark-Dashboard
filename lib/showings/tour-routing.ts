import "server-only";
import { validTourCoordinates, type TourMap, type TourPlanOptions, type TourRoutingProvider, type TourRoutingResult, type TourRoutingStop } from "./tour-domain.ts";
import { optimizeTour, type TourMatrixCell } from "./tour-optimizer.ts";

const MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const ROUTE_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const MAX_BYTES = 1_048_576;
type Environment = Record<string, string | undefined>;
interface RoutingDependencies { fetch?: typeof fetch; signal?: AbortSignal; now?: () => Date }
const safeKey = (value: string | undefined) => typeof value === "string" && /^[A-Za-z0-9_-]{10,300}$/.test(value.trim()) ? value.trim() : null;
const durationSeconds = (value: unknown): number | null => {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,9})?s$/.test(value)) return null;
  const seconds = Number(value.slice(0, -1));
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 604800 ? Math.ceil(seconds) : null;
};
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body || Number(response.headers.get("content-length")) > MAX_BYTES) throw Error("Routing response unavailable");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > MAX_BYTES) { await reader.cancel(); throw Error("Routing response unavailable"); } chunks.push(part.value); }
    const buffer = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  } finally { reader.releaseLock(); }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Constructing this adapter makes no request. Both explicit activation and both keys are required. */
export function createTourRoutingProvider(env: Environment = process.env, dependencies: RoutingDependencies = {}): TourRoutingProvider {
  const serverKey = safeKey(env.GOOGLE_MAPS_ROUTES_API_KEY), browserKey = safeKey(env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);
  const enabled = env.TOUR_ROUTING_ENABLED === "true" && Boolean(serverKey && browserKey);
  const map: TourMap = enabled ? { kind: "google", browserKey: browserKey! } : { kind: "not_configured" };
  const fetcher = dependencies.fetch ?? fetch, now = dependencies.now ?? (() => new Date());
  async function post(url: string, body: unknown, fields: string) {
    const timeout = AbortSignal.timeout(12_000), signal = dependencies.signal ? AbortSignal.any([dependencies.signal, timeout]) : timeout;
    const response = await fetcher(url, { method: "POST", cache: "no-store", signal, headers: { "Content-Type": "application/json", "X-Goog-Api-Key": serverKey!, "X-Goog-FieldMask": fields }, body: JSON.stringify(body) });
    if (!response.ok) throw Error("Routing service unavailable");
    return boundedJson(response);
  }
  return {
    map,
    async recommend(stops: TourRoutingStop[], options: TourPlanOptions): Promise<TourRoutingResult> {
      if (!enabled) return { ok: false, reason: "not_configured" };
      const checkedAt = now();
      if (stops.length < 2 || stops.length > 8 || stops.some(stop => !validTourCoordinates(stop.coordinates)) || !Number.isFinite(Date.parse(options.startsAt))
        || Date.parse(options.startsAt) < checkedAt.getTime() || Date.parse(options.startsAt) > checkedAt.getTime() + 730 * 86_400_000) return { ok: false, reason: "invalid_route" };
      const originAddress = options.originAddress?.trim() ?? "", endAddress = options.endAddress?.trim() ?? "";
      const endMode = options.endMode ?? (options.returnToStart ? "return_to_start" : "last_property");
      if (!["last_property", "return_to_start", "address"].includes(endMode) || originAddress.length > 500 || endAddress.length > 500
        || originAddress.includes("\u0000") || endAddress.includes("\u0000") || endMode === "address" && !endAddress) return { ok: false, reason: "invalid_route" };
      const hasOrigin = Boolean(originAddress), hasDestination = endMode === "address" || endMode === "return_to_start" && hasOrigin;
      const returnsToFirst = endMode === "return_to_start" && !hasOrigin;
      // Validate all local preferences before making a billable request.
      const dummy = stops.map(() => stops.map(() => ({ durationSeconds: 0, distanceMeters: 0 })));
      if (!optimizeTour(stops, dummy, { ...options, returnToStart: returnsToFirst, respectAppointments: false }).ok) return { ok: false, reason: "invalid_route" };
      const waypoint = (stop: TourRoutingStop) => ({ location: { latLng: { latitude: stop.coordinates.lat, longitude: stop.coordinates.lng } } });
      type Waypoint = ReturnType<typeof waypoint> | { address: string };
      const points: Waypoint[] = stops.map(waypoint);
      const originIndex = hasOrigin ? points.push({ address: originAddress }) - 1 : -1;
      const destinationIndex = endMode === "address" ? points.push({ address: endAddress }) - 1 : endMode === "return_to_start" && hasOrigin ? originIndex : -1;
      const pointCount = points.length;
      const departureTime = new Date(options.startsAt).toISOString();
      try {
        // Only coordinates and user-entered routing addresses leave this adapter; no contact, MLS or note data.
        const data = await post(MATRIX_URL, { origins: points.map(point => ({ waypoint: point })), destinations: points.map(point => ({ waypoint: point })), travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE", departureTime }, "originIndex,destinationIndex,status,condition,distanceMeters,duration");
        if (!Array.isArray(data) || data.length > pointCount * pointCount) return { ok: false, reason: "unavailable" };
        const matrix: TourMatrixCell[][] = points.map(() => points.map(() => ({ durationSeconds: null, distanceMeters: null })));
        const seen = new Set<string>();
        for (const element of data) {
          if (!object(element)) return { ok: false, reason: "unavailable" };
          // Protocol-buffer JSON may omit zero-valued indexes and distances.
          const from = element.originIndex ?? 0, to = element.destinationIndex ?? 0;
          if (typeof from !== "number" || typeof to !== "number" || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= pointCount || to >= pointCount || seen.has(`${from}:${to}`)) return { ok: false, reason: "unavailable" };
          seen.add(`${from}:${to}`);
          if (element.status !== undefined && (!object(element.status) || element.status.code !== undefined && element.status.code !== 0)) continue;
          if (element.condition !== "ROUTE_EXISTS") continue;
          const seconds = durationSeconds(element.duration), meters = element.distanceMeters ?? 0;
          if (seconds === null || typeof meters !== "number" || !Number.isFinite(meters) || meters < 0 || meters > 40_000_000 || from !== to && seconds > 0 && meters === 0) return { ok: false, reason: "unavailable" };
          matrix[from][to] = { durationSeconds: seconds, distanceMeters: meters };
        }
        if (seen.size !== pointCount * pointCount) return { ok: false, reason: "unavailable" };
        const optimized = optimizeTour(stops, matrix.slice(0, stops.length).map(row => row.slice(0, stops.length)), {
          ...options, returnToStart: returnsToFirst,
          ...(hasOrigin ? { originTravel: matrix[originIndex].slice(0, stops.length) } : {}),
          ...(hasDestination ? { endTravel: stops.map((_, index) => matrix[index][destinationIndex]) } : {}),
        }); if (!optimized.ok) return optimized;
        const ordered = optimized.value.orderedPropertyIds.map(id => stops.find(stop => stop.propertyId === id)!);
        const routePoints: Waypoint[] = [...(hasOrigin ? [points[originIndex]] : []), ...ordered.map(waypoint), ...(hasDestination ? [points[destinationIndex]] : returnsToFirst ? [waypoint(ordered[0])] : [])];
        let originPoint: { lat: number; lng: number } | undefined, destinationPoint: { lat: number; lng: number } | undefined;
        let mapPolyline: string | undefined;
        const warnings = [...optimized.value.warnings];
        try {
          const route = await post(ROUTE_URL, { origin: routePoints[0], destination: routePoints[routePoints.length - 1], intermediates: routePoints.slice(1, -1), travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE", departureTime, polylineQuality: "OVERVIEW", polylineEncoding: "ENCODED_POLYLINE" }, "routes.polyline.encodedPolyline,routes.legs.startLocation,routes.legs.endLocation,geocodingResults");
          const routes = object(route) && Array.isArray(route.routes) ? route.routes : [];
          const first = routes[0], polyline = object(first) && object(first.polyline) ? first.polyline.encodedPolyline : undefined;
          if (hasOrigin || hasDestination) {
            const geo = object(route) && object(route.geocodingResults) ? route.geocodingResults : null;
            const exact = (value: unknown) => object(value) && value.partialMatch !== true && (value.partialMatch === undefined || value.partialMatch === false)
              && (value.geocoderStatus === undefined || object(value.geocoderStatus) && (value.geocoderStatus.code === undefined || value.geocoderStatus.code === 0));
            const legs = object(first) && Array.isArray(first.legs) ? first.legs : [];
            const coordinate = (leg: unknown, field: string) => {
              const location = object(leg) && object(leg[field]) ? leg[field] : null;
              const point = object(location) && object(location.latLng) ? { lat: location.latLng.latitude ?? 0, lng: location.latLng.longitude ?? 0 } : null;
              return validTourCoordinates(point) ? point : undefined;
            };
            if (hasOrigin) originPoint = coordinate(legs[0], "startLocation");
            if (hasDestination) destinationPoint = coordinate(legs[legs.length - 1], "endLocation");
            if (!geo || hasOrigin && (!exact(geo.origin) || !originPoint) || hasDestination && (!exact(geo.destination) || !destinationPoint)) return { ok: false, reason: "unresolved_endpoint" };
          }
          if (typeof polyline === "string" && polyline.length > 0 && polyline.length <= 100_000 && /^[\x3f-\x7e]+$/.test(polyline)) mapPolyline = polyline;
          else warnings.push("The road line is unavailable. Driving estimates are still shown.");
        } catch { if (hasOrigin || hasDestination) return { ok: false, reason: "unavailable" }; warnings.push("The road line could not be refreshed. Driving estimates are still shown."); }
        return { ok: true, value: { ...optimized.value, warnings, ...(originPoint ? { originPoint } : {}), ...(destinationPoint ? { destinationPoint } : {}), ...(mapPolyline ? { mapPolyline } : {}), source: "google", computedAt: checkedAt.toISOString(), trafficAsOf: checkedAt.toISOString(), trafficLabel: "Road travel estimates for the selected departure time. Later traffic can change; refresh before leaving." } };
      } catch { return { ok: false, reason: "unavailable" }; }
    },
  };
}
