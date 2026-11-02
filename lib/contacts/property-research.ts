/** Private research belongs to one saved-list membership, never to the MLS listing globally. */
import { z } from "zod";
import type { PropertyView } from "./properties.ts";

export const PROPERTY_REVIEW_STATUSES = ["to_review", "shortlisted", "ruled_out"] as const;
export const PROPERTY_SORTS = ["added_desc", "added_asc", "price_asc", "price_desc"] as const;
export const PROPERTY_NOTES_MAX = 5000;
export type PropertyReviewStatus = (typeof PROPERTY_REVIEW_STATUSES)[number];
export type PropertyReviewFilter = "all" | PropertyReviewStatus;
export type PropertySort = (typeof PROPERTY_SORTS)[number];
export const PROPERTY_REVIEW_LABELS: Record<PropertyReviewStatus, string> = { to_review: "To review", shortlisted: "Shortlisted", ruled_out: "Ruled out" };
const revision = z.string().datetime({ offset: true });
export const propertyResearchInputSchema = z.object({
  notes: z.string().max(PROPERTY_NOTES_MAX).refine(value => !value.includes("\0"), "Unsupported character."),
  reviewStatus: z.enum(PROPERTY_REVIEW_STATUSES), expectedUpdatedAt: revision,
}).strict();
export const propertyTransferInputSchema = z.object({ requestId: z.string().uuid(), mode: z.enum(["copy", "move"]), targetListId: z.string().uuid(), expectedUpdatedAt: revision }).strict();
export const propertyRemovalInputSchema = z.object({ expectedUpdatedAt: revision.optional() }).strict();
export type PropertyResearchInput = z.infer<typeof propertyResearchInputSchema>;
export type PropertyTransferInput = z.infer<typeof propertyTransferInputSchema>;
export interface PropertyTransferResult { property: PropertyView; sourceRemoved: boolean; targetListId: string }
export interface PropertyReadOptions { page?: number; pageSize?: number; reviewStatus?: PropertyReviewFilter; sort?: PropertySort }
export function propertyReviewMatches(status: PropertyReviewStatus, filter: PropertyReviewFilter = "all"): boolean { return filter === "all" || status === filter; }
export function comparePropertyAdded(a: { id: string; addedAt?: string; createdAt?: Date | string }, b: { id: string; addedAt?: string; createdAt?: Date | string }, sort: "added_asc" | "added_desc" = "added_desc"): number {
  const delta = new Date(a.addedAt ?? a.createdAt!).getTime() - new Date(b.addedAt ?? b.createdAt!).getTime();
  const value = delta || (a.id === b.id ? 0 : a.id < b.id ? -1 : 1);
  return sort === "added_asc" ? value : -value;
}
/** A global provider order must contain each scoped membership exactly once. */
export function applyPropertyPriceOrder<T extends { id: string }>(rows: readonly T[], ids: readonly string[]): T[] | null {
  if (!Array.isArray(ids) || ids.length !== rows.length || new Set(ids).size !== rows.length) return null;
  const byId = new Map(rows.map(row => [row.id, row]));
  if (ids.some(id => typeof id !== "string" || !byId.has(id))) return null;
  return ids.map(id => byId.get(id)!);
}
