/** Saved tours contain user-authored plans and opaque references, never MLS/Google snapshots. */
import { z } from "zod";
import type { TourMap, TourRecommendation, TourRoutingProvider } from "./tour-domain.ts";

const privateText = (limit: number) => z.string().max(limit).refine(value => !value.includes("\u0000"), "Invalid text.");
const revision = z.string().datetime({ offset: true });
export const SAVED_TOUR_BODY_BYTES = 65536;
export const SAVED_TOUR_REVIEW_TTL_MS = 15 * 60_000;
export const savedTourStopInputSchema = z.object({ propertyId: z.string().uuid(), visitMinutes: z.number().int().min(15).max(240), lockTime: z.boolean(), linkedShowingId: z.string().uuid().nullable().optional() }).strict();
export const savedTourSettingsSchema = z.object({
  name: privateText(120).trim().min(1), notes: privateText(4000), contactId: z.string().uuid(), sourceListId: z.string().uuid(),
  startsAt: revision, bufferMinutes: z.number().int().min(0).max(60), firstPropertyId: z.union([z.string().uuid(), z.literal("auto")]),
  originAddress: privateText(500).trim(), endMode: z.enum(["last_property", "return_to_start", "address"]), endAddress: privateText(500).trim(),
  stops: z.array(savedTourStopInputSchema).min(2).max(8),
}).strict().superRefine((value, ctx) => {
  const ids = value.stops.map(stop => stop.propertyId), showingIds = value.stops.flatMap(stop => stop.linkedShowingId ? [stop.linkedShowingId] : []);
  if (new Set(ids).size !== ids.length || new Set(showingIds).size !== showingIds.length) ctx.addIssue({ code: "custom", path: ["stops"], message: "Choose each property and appointment once." });
  if (value.firstPropertyId !== "auto" && !ids.includes(value.firstPropertyId)) ctx.addIssue({ code: "custom", path: ["firstPropertyId"], message: "Choose a selected property." });
  if (value.endMode === "address" && !value.endAddress) ctx.addIssue({ code: "custom", path: ["endAddress"], message: "Enter the end address." });
  if (value.stops.some(stop => stop.lockTime && !stop.linkedShowingId)) ctx.addIssue({ code: "custom", path: ["stops"], message: "A locked time needs an existing appointment." });
});
export const createSavedShowingTourInputSchema = savedTourSettingsSchema.safeExtend({ requestId: z.string().uuid() });
export const updateSavedShowingTourInputSchema = savedTourSettingsSchema.safeExtend({ requestId: z.string().uuid(), expectedUpdatedAt: revision });
export const archiveSavedShowingTourInputSchema = z.object({ requestId: z.string().uuid(), expectedUpdatedAt: revision }).strict();
export const reviewSavedShowingTourInputSchema = z.object({ expectedUpdatedAt: revision }).strict();
export const scheduleSavedShowingTourInputSchema = z.object({ requestId: z.string().uuid(), expectedUpdatedAt: revision, reviewToken: z.string().max(16000).min(32) }).strict();
export type SavedTourSettings = z.infer<typeof savedTourSettingsSchema>;
export type CreateSavedShowingTourInput = z.infer<typeof createSavedShowingTourInputSchema>;
export type UpdateSavedShowingTourInput = z.infer<typeof updateSavedShowingTourInputSchema>;
export type ArchiveSavedShowingTourInput = z.infer<typeof archiveSavedShowingTourInputSchema>;
export type ReviewSavedShowingTourInput = z.infer<typeof reviewSavedShowingTourInputSchema>;
export type ScheduleSavedShowingTourInput = z.infer<typeof scheduleSavedShowingTourInputSchema>;
export interface SavedTourStopView {
  id: string; propertyId: string; position: number; visitMinutes: number; lockTime: boolean; linkedShowingId: string | null; updatedAt: string;
  mlsNumber: string | null; listingId: string | null; available: boolean;
  appointment: { id: string; startsAt: string; endsAt: string; updatedAt: string; status: "scheduled" | "completed" | "cancelled" } | null;
}
export interface SavedShowingTourView {
  id: string; name: string; notes: string; contactId: string; contactName: string; sourceListId: string; sourceList: { id: string; name: string } | null;
  startsAt: string; day: string; bufferMinutes: number; firstPropertyId: string; originAddress: string; endMode: "last_property" | "return_to_start" | "address"; endAddress: string;
  stops: SavedTourStopView[]; createdAt: string; updatedAt: string; archivedAt: string | null; lastScheduledAt: string | null; canEdit: boolean; canReview: boolean;
}
export interface SavedShowingToursQuery { page?: number; pageSize?: number; contactId?: string; sourceListId?: string; archived?: boolean }
export interface SavedShowingToursPage { items: SavedShowingTourView[]; total: number; page: number; pageSize: number }
export interface SavedTourSlot { stopId: string; propertyId: string; showingId: string | null; expectedShowingUpdatedAt: string | null; currentStartsAt: string | null; currentEndsAt: string | null; startsAt: string; endsAt: string; kept: boolean }
export interface SavedTourReview { tourId: string; expectedUpdatedAt: string; reviewToken: string; expiresAt: string; recommendation: TourRecommendation; slots: SavedTourSlot[]; map: TourMap }
export interface SavedTourScheduleResult { tour: SavedShowingTourView; showingIds: string[] }
export type SavedTourRoutingProvider = TourRoutingProvider;
export function readSavedShowingToursQuery(params: URLSearchParams): SavedShowingToursQuery | null {
  const allowed = ["page", "pageSize", "contactId", "sourceListId", "archived"];
  if ([...params.keys()].some(key => !allowed.includes(key)) || allowed.some(key => params.getAll(key).length > 1)) return null;
  const parsed = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).optional(), pageSize: z.coerce.number().int().min(1).max(24).optional(), contactId: z.string().uuid().optional(), sourceListId: z.string().uuid().optional(), archived: z.enum(["true", "false"]).optional() }).safeParse(Object.fromEntries(params));
  return parsed.success ? { ...parsed.data, archived: parsed.data.archived === "true" } : null;
}
