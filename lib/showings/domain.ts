/** Showing plans and confirmed visits are distinct facts. No plan is a contact touch. */
import { z } from "zod";
import type { Listing } from "../data/types.ts";
import type { NextAction } from "../contacts/next-action.ts";
import { PROPERTY_REVIEW_STATUSES, type PropertyReviewStatus } from "../contacts/property-research.ts";

export const SHOWING_STATUSES = ["scheduled", "completed", "cancelled"] as const;
export type ShowingStatus = (typeof SHOWING_STATUSES)[number];
export const SHOWING_STATUS_LABELS: Record<ShowingStatus, string> = { scheduled: "Scheduled", completed: "Completed", cancelled: "Cancelled" };
export const SHOWING_PAGE_SIZE = 12;
export const MAX_SHOWING_PAGE_SIZE = 24;
export const SHOWING_BODY_BYTES = 65536;
export const SHOWING_LIMITS = { meetingDetails: 1000, notes: 2000, feedback: 2000, cancelReason: 1000, minMinutes: 15, maxMinutes: 240, horizonDays: 730, queryDays: 93 } as const;
const instant = z.string().datetime({ offset: true });
const text = (max: number) => z.string().max(max).refine(value => !value.includes("\0"), "Unsupported character.");
const schedule = { startsAt: instant, endsAt: instant, meetingDetails: text(1000), notes: text(2000) };
export const createShowingInputSchema = z.object({ requestId: z.string().uuid(), propertyId: z.string().uuid(), contactId: z.string().uuid(), ...schedule }).strict();
const mutation = { requestId: z.string().uuid(), expectedUpdatedAt: instant };
export const showingMutationSchema = z.discriminatedUnion("action", [
  z.object({ ...mutation, action: z.literal("update"), ...schedule }).strict(),
  z.object({ ...mutation, action: z.literal("reschedule"), ...schedule }).strict(),
  z.object({ ...mutation, action: z.literal("cancel"), reason: text(1000).refine(value => value.trim().length > 0, "Give a cancellation reason.") }).strict(),
  z.object({ ...mutation, action: z.literal("complete"), visitedAt: instant, likes: text(2000), concerns: text(2000), summary: text(2000), reviewStatus: z.enum(PROPERTY_REVIEW_STATUSES).optional(), expectedPropertyUpdatedAt: instant.optional() }).strict(),
]).superRefine((value, ctx) => {
  if (value.action === "complete" && (value.reviewStatus === undefined) !== (value.expectedPropertyUpdatedAt === undefined)) ctx.addIssue({ code: "custom", path: ["expectedPropertyUpdatedAt"], message: "Review the original membership version before changing its status." });
});
export type CreateShowingInput = z.infer<typeof createShowingInputSchema>;
export type ShowingCreateInput = CreateShowingInput;
export type ShowingMutation = z.infer<typeof showingMutationSchema>;
export interface ShowingSourceProperty { id: string; listId: string; listName: string; removed: boolean; reviewStatus: PropertyReviewStatus; updatedAt: string }
export interface ShowingView {
  id: string; contactId: string; contactName: string; sourcePropertyId: string;
  dataset: string; listingId: string; mlsNumber: string;
  startsAt: string; endsAt: string; meetingDetails: string; notes: string; status: ShowingStatus;
  feedbackLikes: string; feedbackConcerns: string; feedbackSummary: string; visitedAt: string | null; cancelReason: string;
  createdAt: string; updatedAt: string;
  sourceProperty: ShowingSourceProperty | null;
  canEdit: boolean; canComplete: boolean; canCancel: boolean; canUpdatePropertyReview: boolean;
  listing: Listing | null; syncStatus: "available" | "not_found" | "unavailable" | "not_configured"; checkedAt: string | null;
}
export interface ShowingQuery { from: string; to: string; status?: "all" | ShowingStatus; contactId?: string; page?: number; pageSize?: number }
export interface ShowingsPage { items: ShowingView[]; total: number; page: number; pageSize: number }
export interface ShowingNextActionView { contactId: string; contactName: string; action: NextAction }
export interface ShowingNextActionsPage { items: ShowingNextActionView[]; total: number; page: number; pageSize: number }
export interface ShowingAgenda { showings: ShowingsPage; nextActions: ShowingNextActionsPage }
export interface ShowingSummary { items: ShowingView[]; total: number }

export function showingsOverlap(a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }): boolean {
  return Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(a.endsAt) > Date.parse(b.startsAt);
}
export function checkShowingSchedule(value: { startsAt: string; endsAt: string }, now = new Date(), unchanged?: { startsAt: string; endsAt: string }): boolean {
  if (!instant.safeParse(value.startsAt).success || !instant.safeParse(value.endsAt).success) return false;
  const start = Date.parse(value.startsAt), end = Date.parse(value.endsAt), minutes = (end - start) / 60_000;
  if (minutes < 15 || minutes > 240) return false;
  if (unchanged && start === Date.parse(unchanged.startsAt) && end === Date.parse(unchanged.endsAt)) return true;
  return start > now.getTime() && start <= now.getTime() + 730 * 86_400_000;
}
export function checkShowingVisit(visitedAt: string, now = new Date()): boolean {
  const value = Date.parse(visitedAt);
  return instant.safeParse(visitedAt).success && value <= now.getTime() && value >= now.getTime() - 730 * 86_400_000;
}
export function readShowingQuery(params: URLSearchParams): ShowingQuery | null {
  if ([...params.keys()].some(key => !["from", "to", "status", "contactId", "page", "pageSize"].includes(key))) return null;
  const from = params.get("from"), to = params.get("to");
  if (!from || !to || !instant.safeParse(from).success || !instant.safeParse(to).success || Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 93 * 86_400_000) return null;
  const rawPage = params.get("page"), rawSize = params.get("pageSize"), status = params.get("status") ?? "scheduled", contactId = params.get("contactId");
  if (rawPage !== null && !/^\d{1,7}$/.test(rawPage) || rawSize !== null && !/^\d{1,2}$/.test(rawSize)) return null;
  const page = rawPage === null ? 1 : Number(rawPage), pageSize = rawSize === null ? 12 : Number(rawSize);
  if (page < 1 || page > 1_000_000 || pageSize < 1 || pageSize > 24 || status !== "all" && !(SHOWING_STATUSES as readonly string[]).includes(status) || contactId !== null && !z.string().uuid().safeParse(contactId).success) return null;
  return { from, to, status: status as ShowingQuery["status"], page, pageSize, ...(contactId ? { contactId } : {}) };
}
