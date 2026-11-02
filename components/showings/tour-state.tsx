import { businessDayKey } from "@/lib/metrics/business-day";
import { businessLocalToUtc, nextActionLocalParts } from "@/lib/contacts/next-action";
import { tourPlanInputSchema, validTourCoordinates, type TourContext, type TourPlanInput, type TourRecommendation, type TourStop } from "@/lib/showings/tour-domain";

export interface TourDraft { selectedPropertyIds: string[]; startPropertyId: string; time: string; bufferMinutes: string; respectAppointments: boolean; returnToStart: boolean }
export function tourStopLabel(stop: TourStop): string { return stop.address || `MLS ${stop.mlsNumber}`; }
export function canSelectTourStop(stop: TourStop): boolean { return stop.selectable && validTourCoordinates(stop.coordinates) && stop.locationStatus === "available"; }
export function initialTourDraft(context: TourContext): TourDraft { const selected = context.stops.filter(canSelectTourStop).sort((a, b) => (a.appointment ? Date.parse(a.appointment.startsAt) : Infinity) - (b.appointment ? Date.parse(b.appointment.startsAt) : Infinity)).slice(0, 8).map((stop) => stop.propertyId); return { selectedPropertyIds: selected, startPropertyId: selected[0] ?? "", time: context.defaultStartsAt ? nextActionLocalParts(context.defaultStartsAt).time : "", bufferMinutes: "10", respectAppointments: true, returnToStart: false }; }
export function sameTourScope(a: TourContext, b: TourContext): boolean { return a.showingId === b.showingId && a.contactId === b.contactId && a.list?.id === b.list?.id && a.day === b.day; }
export function orderedTourSelection(draft: TourDraft): string[] { return draft.selectedPropertyIds.includes(draft.startPropertyId) ? [draft.startPropertyId, ...draft.selectedPropertyIds.filter((id) => id !== draft.startPropertyId)] : draft.selectedPropertyIds; }
export function toggleTourStop(draft: TourDraft, propertyId: string, selected: boolean): TourDraft { const ids = selected ? [...new Set([...draft.selectedPropertyIds, propertyId])].slice(0, 8) : draft.selectedPropertyIds.filter((id) => id !== propertyId); return { ...draft, selectedPropertyIds: ids, startPropertyId: draft.startPropertyId === "auto" || ids.includes(draft.startPropertyId) ? draft.startPropertyId : ids[0] ?? "" }; }
export function moveTourStop(draft: TourDraft, propertyId: string, amount: -1 | 1): TourDraft { const ids = orderedTourSelection(draft), index = ids.indexOf(propertyId), target = index + amount, firstAllowed = draft.startPropertyId === "auto" ? 0 : 1; if (index < firstAllowed || target < firstAllowed || target >= ids.length) return draft; [ids[index], ids[target]] = [ids[target], ids[index]]; return { ...draft, selectedPropertyIds: ids }; }
export function tourInputForDraft(context: TourContext, draft: TourDraft, now = new Date()): { ok: true; input: TourPlanInput; ambiguous: boolean } | { ok: false; message: string } {
  const converted = businessLocalToUtc(context.day, draft.time);
  if (!converted.ok) return { ok: false, message: converted.reason === "nonexistent_time" ? "This start time is skipped by daylight saving. Choose another New York time." : "Choose the first visit time in New York time." };
  const original = context.defaultStartsAt && nextActionLocalParts(context.defaultStartsAt), startsAt = original && original.day === context.day && original.time === draft.time ? context.defaultStartsAt! : converted.dueAt;
  if (Date.parse(startsAt) <= now.getTime() || businessDayKey(new Date(startsAt)) !== context.day) return { ok: false, message: "Choose a future first visit time on this tour's New York calendar day." };
  if (!/^\d{1,2}$/.test(draft.bufferMinutes)) return { ok: false, message: "Choose a buffer from 0 to 60 minutes between stops." };
  const parsed = tourPlanInputSchema.safeParse({ selectedPropertyIds: orderedTourSelection(draft), startPropertyId: draft.startPropertyId, startsAt, bufferMinutes: Number(draft.bufferMinutes), respectAppointments: draft.respectAppointments, returnToStart: draft.returnToStart, contextToken: context.contextToken });
  return parsed.success ? { ok: true, input: parsed.data, ambiguous: converted.ambiguous } : { ok: false, message: draft.selectedPropertyIds.length < 2 ? "Select at least two properties to suggest a route." : "Choose two to eight distinct properties, a selected first stop and a buffer from 0 to 60 minutes." };
}
export function tourDraftKey(context: TourContext, draft: TourDraft, epoch: number): string { return JSON.stringify([context.showingId, context.contextToken, epoch, draft]); }
export function visibleTourRecommendation(result: { key: string; value: TourRecommendation } | null, key: string, reviewNeeded: boolean): TourRecommendation | null { return result?.key === key && !reviewNeeded ? result.value : null; }
export function currentTourResponse(expectedView: string, latestView: string, request: number, latestRequest: number): boolean { return expectedView === latestView && request === latestRequest; }
export function tourRecommendationStops(result: TourRecommendation | null, contextStops: TourStop[]): TourStop[] { return result?.resolvedStops ?? (result?.source === "google" ? [] : contextStops); }
export function tourLocationIssue(stop: TourStop): string {
  if (stop.selectionIssue === "multiple_appointments") return "Multiple appointments for this property · review the individual showings before routing.";
  const labels: Record<TourStop["locationStatus"], string> = { available: "", withheld: "Location withheld by the listing broker", missing_coordinates: "MLS coordinates not provided", not_found: "MLS listing not found", unavailable: "MLS details could not be reached", not_configured: "MLS connection not configured", removed: "Saved property removed", source_unavailable: "Original list unavailable" };
  return labels[stop.locationStatus] || (!validTourCoordinates(stop.coordinates) ? "No displayable coordinates" : "This property is unavailable for routing");
}
export function tourMinutes(seconds: number): string { const minutes = Math.round(seconds / 60); return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}`; }
export function tourMiles(meters: number): string { return `${(meters / 1609.344).toLocaleString("en-US", { maximumFractionDigits: 1 })} mi`; }
export function tourFailure(error: unknown): string {
  const status = error && typeof error === "object" && "status" in error ? error.status : null, code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "infeasible") return "The selected stops cannot fit the booked appointment times with these drives and buffers. Try the earliest booked property as the first stop, choose fewer stops, or turn off Keep booked times to explore a flexible draft.";
  if (code === "unreachable") return "A road route could not be found between the selected properties. No driving time was guessed. Try a smaller set of stops.";
  if (code === "not_configured") return "Maps and driving estimates are not connected. An administrator needs to configure the map and route services. Available property locations remain below.";
  if (code === "stale_context") return "The showings or saved list changed. Your choices are kept. Review a refreshed tour context before calculating again.";
  if (code === "unresolved_stops" || code === "source_unavailable") return "Some selected properties no longer have an available, authorized location. Refresh the tour and review those stops before trying again.";
  if (code === "sample_read_only") return "Tour planning needs the contact database connection. Production sample mode does not calculate personal routes.";
  if (status === 401) return "Sign in again to use tour planning. Your choices are kept.";
  if (status === 403) return "You no longer have access to this tour. Your choices are kept.";
  if (status === 404) return "This showing, contact or original list is no longer available. Refresh the showing before continuing.";
  if (status === 400) return "Check the selected stops, first visit time and buffer before calculating. Your choices are kept.";
  return "The route service did not return a recommendation. Your choices are kept. Retry explicitly when ready; the request is not retried automatically.";
}
