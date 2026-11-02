/** Exact small-tour search over road durations supplied by a routing service. */
export interface OptimizationStop { propertyId: string; visitMinutes: number; fixedStartsAt?: string }
export interface TourMatrixCell { durationSeconds: number | null; distanceMeters: number | null }
export interface TourOptimizationOptions { startPropertyId: string; startsAt: string; bufferMinutes: number; returnToStart: boolean; respectAppointments: boolean; originTravel?: TourMatrixCell[]; endTravel?: TourMatrixCell[] }
export interface TourRouteLeg { fromPropertyId: string; toPropertyId: string; driveSeconds: number; distanceMeters: number }
export interface TourRouteVisit { propertyId: string; arrivesAt: string; startsAt: string; endsAt: string; waitSeconds: number; fixed: boolean }
export interface TourOptimization {
  orderedPropertyIds: string[]; currentOrderedPropertyIds: string[];
  legs: TourRouteLeg[]; visits: TourRouteVisit[]; originLeg?: TourRouteLeg; destinationLeg?: TourRouteLeg;
  totalDriveSeconds: number; totalDistanceMeters: number; totalWaitSeconds: number; endsAt: string;
  currentDriveSeconds: number | null; currentDistanceMeters: number | null;
  savedDriveSeconds: number | null; savedDistanceMeters: number | null; warnings: string[];
}
export type TourOptimizationResult = { ok: true; value: TourOptimization } | { ok: false; reason: "invalid_route" | "unreachable" | "infeasible" };

const validInstant = (value: string) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
function roadLegs(order: number[], stops: OptimizationStop[], matrix: TourMatrixCell[][], roundTrip: boolean): TourRouteLeg[] | null {
  const pairs = order.slice(1).map((to, index) => [order[index], to]);
  if (roundTrip) pairs.push([order[order.length - 1], order[0]]);
  const legs: TourRouteLeg[] = [];
  for (const [from, to] of pairs) {
    const cell = matrix[from][to];
    if (cell.durationSeconds === null || cell.distanceMeters === null) return null;
    legs.push({ fromPropertyId: stops[from].propertyId, toPropertyId: stops[to].propertyId, driveSeconds: cell.durationSeconds, distanceMeters: cell.distanceMeters });
  }
  return legs;
}
interface RouteParts { legs: TourRouteLeg[]; originLeg?: TourRouteLeg; destinationLeg?: TourRouteLeg; all: TourRouteLeg[] }
function routeParts(order: number[], stops: OptimizationStop[], matrix: TourMatrixCell[][], options: TourOptimizationOptions): RouteParts | null {
  const legs = roadLegs(order, stops, matrix, options.returnToStart && !options.endTravel && !options.originTravel);
  if (!legs) return null;
  function endpoint(cells: TourMatrixCell[] | undefined, index: number, from: string, to: string): TourRouteLeg | null | undefined {
    if (!cells) return undefined;
    const cell = cells[index];
    return cell.durationSeconds === null || cell.distanceMeters === null ? null : { fromPropertyId: from, toPropertyId: to, driveSeconds: cell.durationSeconds, distanceMeters: cell.distanceMeters };
  }
  const first = order[0], last = order[order.length - 1];
  const originLeg = endpoint(options.originTravel, first, "__origin", stops[first].propertyId);
  const destinationLeg = endpoint(options.endTravel, last, stops[last].propertyId, "__destination");
  if (originLeg === null || destinationLeg === null) return null;
  return { legs, ...(originLeg ? { originLeg } : {}), ...(destinationLeg ? { destinationLeg } : {}), all: [...(originLeg ? [originLeg] : []), ...legs, ...(destinationLeg ? [destinationLeg] : [])] };
}
function visitTimes(order: number[], stops: OptimizationStop[], route: RouteParts, options: TourOptimizationOptions): { visits: TourRouteVisit[]; endsAt: string; wait: number } | null {
  let arrival = Date.parse(options.startsAt) + (route.originLeg ? (route.originLeg.driveSeconds + options.bufferMinutes * 60) * 1000 : 0), wait = 0;
  const visits: TourRouteVisit[] = [];
  for (const [position, index] of order.entries()) {
    const stop = stops[index], fixed = options.respectAppointments && Boolean(stop.fixedStartsAt);
    const starts = fixed ? Date.parse(stop.fixedStartsAt!) : arrival;
    if (starts < arrival) return null;
    const waiting = (starts - arrival) / 1000, end = starts + stop.visitMinutes * 60_000;
    visits.push({ propertyId: stop.propertyId, arrivesAt: new Date(arrival).toISOString(), startsAt: new Date(starts).toISOString(), endsAt: new Date(end).toISOString(), waitSeconds: waiting, fixed });
    wait += waiting;
    if (position < order.length - 1) arrival = end + (options.bufferMinutes * 60 + route.legs[position].driveSeconds) * 1000;
    else {
      const finalLeg = route.destinationLeg ?? (options.returnToStart && !options.originTravel ? route.legs[route.legs.length - 1] : undefined);
      arrival = end + (finalLeg ? (options.bufferMinutes * 60 + finalLeg.driveSeconds) * 1000 : 0);
    }
  }
  return { visits, endsAt: new Date(arrival).toISOString(), wait };
}

/** Eight homes: 5,040 orders for a chosen first stop; 40,320 when recommending it. */
export function optimizeTour(stops: OptimizationStop[], matrix: TourMatrixCell[][], options: TourOptimizationOptions): TourOptimizationResult {
  const count = stops.length, automatic = options.startPropertyId === "auto", first = automatic ? 0 : stops.findIndex(stop => stop.propertyId === options.startPropertyId);
  const validNumber = (value: number | null, max: number) => value === null || Number.isFinite(value) && value >= 0 && value <= max;
  const validCell = (cell: TourMatrixCell) => cell && validNumber(cell.durationSeconds, 604800) && validNumber(cell.distanceMeters, 40_000_000);
  if (count < 2 || count > 8 || first < 0 || new Set(stops.map(stop => stop.propertyId)).size !== count || !validInstant(options.startsAt)
    || !Number.isInteger(options.bufferMinutes) || options.bufferMinutes < 0 || options.bufferMinutes > 60
    || typeof options.returnToStart !== "boolean" || typeof options.respectAppointments !== "boolean"
    || stops.some(stop => !stop.propertyId || !Number.isInteger(stop.visitMinutes) || stop.visitMinutes < 15 || stop.visitMinutes > 240 || stop.fixedStartsAt !== undefined && !validInstant(stop.fixedStartsAt))
    || [options.originTravel, options.endTravel].some(vector => vector !== undefined && (vector.length !== count || vector.some(cell => !validCell(cell))))
    || options.returnToStart && Boolean(options.originTravel) && !options.endTravel
    || matrix.length !== count || matrix.some(row => row.length !== count || row.some(cell => !cell || !validNumber(cell.durationSeconds, 604800) || !validNumber(cell.distanceMeters, 40_000_000)))) return { ok: false, reason: "invalid_route" };

  const current = [first, ...stops.map((_, index) => index).filter(index => index !== first)];
  const currentLegs = routeParts(current, stops, matrix, options);
  const currentFits = currentLegs ? visitTimes(current, stops, currentLegs, options) : null;
  const currentDrive = currentLegs && currentFits ? currentLegs.all.reduce((sum, leg) => sum + leg.driveSeconds, 0) : null;
  const currentDistance = currentLegs && currentFits ? currentLegs.all.reduce((sum, leg) => sum + leg.distanceMeters, 0) : null;
  let roadPath = false;
  let best: { order: number[]; route: RouteParts; times: NonNullable<ReturnType<typeof visitTimes>>; drive: number; distance: number; key: string } | null = null;
  function evaluate(order: number[]) {
    const route = routeParts(order, stops, matrix, options); if (!route) return;
    roadPath = true;
    const times = visitTimes(order, stops, route, options); if (!times) return;
    const drive = route.all.reduce((sum, leg) => sum + leg.driveSeconds, 0), distance = route.all.reduce((sum, leg) => sum + leg.distanceMeters, 0), key = order.map(index => stops[index].propertyId).join("|");
    if (!best || drive < best.drive || drive === best.drive && (Date.parse(times.endsAt) < Date.parse(best.times.endsAt) || times.endsAt === best.times.endsAt && (distance < best.distance || distance === best.distance && key < best.key))) best = { order: [...order], route, times, drive, distance, key };
  }
  function visit(order: number[], remaining: number[]) {
    if (!remaining.length) { evaluate(order); return; }
    for (const index of remaining) visit([...order, index], remaining.filter(candidate => candidate !== index));
  }
  if (automatic) visit([], current);
  else visit([first], current.slice(1));
  // Search callbacks update this value; keep that narrowing separate from the traversal.
  const result = best as { order: number[]; route: RouteParts; times: NonNullable<ReturnType<typeof visitTimes>>; drive: number; distance: number; key: string } | null;
  if (!result) return { ok: false, reason: roadPath ? "infeasible" : "unreachable" };
  return { ok: true, value: {
    orderedPropertyIds: result.order.map(index => stops[index].propertyId), currentOrderedPropertyIds: current.map(index => stops[index].propertyId),
    legs: result.route.legs, ...(result.route.originLeg ? { originLeg: result.route.originLeg } : {}), ...(result.route.destinationLeg ? { destinationLeg: result.route.destinationLeg } : {}), visits: result.times.visits, totalDriveSeconds: result.drive, totalDistanceMeters: result.distance, totalWaitSeconds: result.times.wait, endsAt: result.times.endsAt,
    currentDriveSeconds: currentDrive, currentDistanceMeters: currentDistance,
    savedDriveSeconds: currentDrive === null ? null : currentDrive - result.drive,
    savedDistanceMeters: currentDistance === null ? null : currentDistance - result.distance,
    warnings: [
      options.respectAppointments && stops.some(stop => stop.fixedStartsAt) ? "Booked appointment times are fixed in this recommendation." : "Suggested times are a draft. Your booked appointments have not changed.",
      ...(!currentFits && currentLegs ? ["The current selected order cannot fit the booked times. A savings comparison is unavailable."] : []),
      options.originTravel ? "The tour starts at your departure location. Driving and arrival buffer to the first property are included." : "Driving to the first property is not included. The tour starts at that property.",
      ...(options.endTravel ? ["Driving and departure buffer to your end location are included."] : []),
    ],
  } };
}
