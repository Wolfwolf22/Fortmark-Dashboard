/** A route recommendation is read-only: appointments and saved properties are never changed. */
import { z } from "zod";
import type { TourOptimization } from "./tour-optimizer.ts";

export const TOUR_MAX_STOPS = 8;
export const TOUR_CANDIDATE_PAGE_SIZE = 24;
export const TOUR_BODY_BYTES = 16384;
export const TOUR_DEFAULT_VISIT_MINUTES = 30;
export interface TourCoordinates { lat: number; lng: number }
export type TourLocationStatus = "available" | "not_found" | "unavailable" | "not_configured" | "withheld" | "missing_coordinates" | "removed" | "source_unavailable";
export interface TourStop {
  propertyId: string; showingId?: string; dataset: string; mlsNumber: string; listingId: string;
  address?: string; city?: string; coordinates: TourCoordinates | null; locationStatus: TourLocationStatus;
  selectable: boolean; selectionIssue?: "multiple_appointments"; appointmentCount?: number;
  appointment?: { startsAt: string; endsAt: string; updatedAt: string };
  visitMinutes: number;
}
export interface TourCandidatesPage { items: TourStop[]; total: number; page: number; pageSize: number }
export type TourMap = { kind: "google"; browserKey: string } | { kind: "not_configured" } | { kind: "sample" };
export interface TourContext {
  showingId: string; contactId: string; contactName: string; list: { id: string; name: string } | null; day: string;
  stops: TourStop[]; totalStops: number; totalScheduledShowings: number; stopsTruncated: boolean;
  candidates: TourCandidatesPage;
  availability: "available" | "source_unavailable" | "not_configured" | "past_day";
  contextToken: string; generatedAt: string; defaultStartsAt: string | null; warnings: string[]; map: TourMap;
}
export const tourPlanInputSchema = z.object({
  selectedPropertyIds: z.array(z.string().uuid()).min(2).max(8).refine(ids => new Set(ids).size === ids.length, "Choose each property once."),
  startPropertyId: z.union([z.string().uuid(), z.literal("auto")]), startsAt: z.string().datetime({ offset: true }), respectAppointments: z.boolean(),
  bufferMinutes: z.number().int().min(0).max(60), returnToStart: z.boolean(), contextToken: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(value => value.startPropertyId === "auto" || value.selectedPropertyIds.includes(value.startPropertyId), { path: ["startPropertyId"], message: "Start must be a selected property or automatic." });
export type TourPlanInput = z.infer<typeof tourPlanInputSchema>;
export interface TourPlanOptions { startPropertyId: string; startsAt: string; respectAppointments: boolean; bufferMinutes: number; returnToStart: boolean }
export interface TourRoutingStop { propertyId: string; coordinates: TourCoordinates; visitMinutes: number; fixedStartsAt?: string }
export interface TourRecommendation extends TourOptimization {
  computedAt: string; trafficAsOf: string | null; trafficLabel: string; mapPolyline?: string; source: "google" | "sample";
  /** The API adds the freshly authorized MLS projection used for this route. Providers may omit it. */
  resolvedStops?: TourStop[];
}
export type TourRoutingResult = { ok: true; value: TourRecommendation } | { ok: false; reason: "invalid_route" | "unreachable" | "infeasible" | "not_configured" | "unavailable" };
export interface TourRoutingProvider {
  map: TourMap;
  recommend(stops: TourRoutingStop[], options: TourPlanOptions): Promise<TourRoutingResult>;
}
export function validTourCoordinates(value: unknown): value is TourCoordinates {
  if (!value || typeof value !== "object") return false;
  const point = value as TourCoordinates;
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) && point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180;
}
export function readTourContextQuery(params: URLSearchParams): { page: number } | null {
  if ([...params.keys()].some(key => key !== "page") || params.getAll("page").length > 1) return null;
  const raw = params.get("page");
  return raw === null ? { page: 1 } : /^\d{1,7}$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 1_000_000 ? { page: Number(raw) } : null;
}
/** Shared canonical encoding; server and isolated fixtures hash their own scoped snapshots. */
export function canonicalTourFingerprint(value: unknown): string {
  const canonical = (input: unknown): unknown => Array.isArray(input) ? input.map(canonical)
    : input && typeof input === "object" ? Object.fromEntries(Object.entries(input).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)])) : input;
  return JSON.stringify(canonical(value));
}
