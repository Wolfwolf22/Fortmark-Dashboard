import { z } from "zod";
export type TourPropertyMatch = "matched" | "different" | "unknown";
export const tourMatchLabel = (match: TourPropertyMatch) => match === "matched" ? "Includes the linked property" : match === "different" ? "Other properties for this client" : "Property match not verified";
export interface TransactionTourSummary { id: string; name: string; startsAt: string; stopCount: number; archivedAt: string | null; lastScheduledAt: string | null; updatedAt: string; propertyMatch: TourPropertyMatch }
export interface TransactionTourLink { id: string; tour: TransactionTourSummary; updatedAt: string; canUnlink: boolean }
export interface TransactionToursWorkspace { transactionId: string; items: TransactionTourLink[]; candidates: TransactionTourSummary[]; canEdit: boolean; updatedAt: string; limit: number; linksTruncated: boolean; candidatesTruncated: boolean }
export interface SavedTourTransactions { tourId: string; items: { id: string; address: string; city: string; stage: string; propertyMatch: TourPropertyMatch }[]; updatedAt: string; limit: number; truncated: boolean }
export const transactionTourMutationSchema = z.object({ requestId: z.string().uuid(), expectedUpdatedAt: z.string().datetime({ offset: true }), expectedTourUpdatedAt: z.string().datetime({ offset: true }), tourId: z.string().uuid(), action: z.enum(["link", "unlink"]) }).strict();
export type TransactionTourMutation = z.infer<typeof transactionTourMutationSchema>;
