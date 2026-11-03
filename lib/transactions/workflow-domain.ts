import { z } from "zod";
import { isValidCalendarDay } from "./calendar-days.ts";
import { partyInputSchema } from "./validation.ts";
import { confirmedListingDatesSchema } from "./listing-term.ts";

export { CLOSE_ACKNOWLEDGEMENT_VERSION, CLOSE_ACKNOWLEDGEMENT_TEXT, closeAcknowledgementSchema, type CloseAcknowledgement } from "./close-acknowledgement.ts";
const text = (cap: number) => z.string().trim().max(cap).refine(value => !value.includes("\u0000"));
const required = (cap: number) => text(cap).min(1);
const day = z.string().refine(isValidCalendarDay, "Enter a real date.");
const revision = z.string().datetime({ offset: true });
const base = { requestId: z.string().uuid(), expectedUpdatedAt: revision };
export const listingPlanSchema = z.object({ goLiveDate: day.nullable(), expirationDate: day.nullable(), status: z.enum(["draft", "active", "extended", "cancelled", "withdrawn"]), reason: text(2000).nullable() }).strict().superRefine((value, ctx) => {
  if (value.goLiveDate && value.expirationDate && value.expirationDate < value.goLiveDate) ctx.addIssue({ code: "custom", path: ["expirationDate"], message: "Expiration must follow the go-live date." });
  if (["extended", "cancelled", "withdrawn"].includes(value.status) && !value.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "Record the reason." });
});
export type ListingPlan = z.infer<typeof listingPlanSchema>;
export const EMPTY_LISTING_PLAN: ListingPlan = { goLiveDate: null, expirationDate: null, status: "draft", reason: null };
const openHouse = z.object({ startsAt: revision, endsAt: revision, attendance: z.number().int().min(0).max(100000).nullable(), notes: text(5000), status: z.enum(["planned", "completed", "cancelled"]) }).strict().superRefine((value, ctx) => {
  const duration = Date.parse(value.endsAt) - Date.parse(value.startsAt);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400000) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "An open house must end after it starts, within one day." });
});
export const transactionWorkflowMutationSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("archive"), reason: text(2000), closedAcknowledged: z.boolean() }).strict(),
  z.object({ ...base, action: z.literal("restore") }).strict(),
  z.object({ ...base, action: z.literal("listing_plan"), plan: listingPlanSchema.refine(value=>confirmedListingDatesSchema.safeParse({goLiveDate:value.goLiveDate,expirationDate:value.expirationDate}).success,"Confirm both go-live and contract expiration dates.") }).strict(),
  z.object({ ...base, action: z.literal("add_open_house"), openHouse }).strict(),
  z.object({ ...base, action: z.literal("edit_open_house"), recordId: z.string().uuid(), expectedRecordUpdatedAt: revision, openHouse }).strict(),
  z.object({ ...base, action: z.literal("remove_open_house"), recordId: z.string().uuid(), expectedRecordUpdatedAt: revision }).strict(),
  z.object({ ...base, action: z.literal("add_party"), contactId: z.string().uuid(), role: partyInputSchema.shape.role, expectedContactUpdatedAt: revision }).strict(),
  z.object({ ...base, action: z.literal("add_note"), body: required(5000) }).strict(),
  z.object({ ...base, action: z.literal("edit_note"), recordId: z.string().uuid(), expectedRecordUpdatedAt: revision, body: required(5000) }).strict(),
  z.object({ ...base, action: z.literal("remove_note"), recordId: z.string().uuid(), expectedRecordUpdatedAt: revision }).strict(),
  z.object({ ...base, action: z.literal("checklist_help"), itemId: z.string().uuid(), expectedItemUpdatedAt: revision, helpText: text(4000) }).strict(),
  z.object({ ...base, action: z.literal("request_reopen"), reason: required(2000) }).strict(),
  z.object({ ...base, action: z.literal("decide_reopen"), recordId: z.string().uuid(), expectedRecordUpdatedAt: revision, approved: z.boolean(), reason: required(2000) }).strict(),
]);
export type TransactionWorkflowMutation = z.infer<typeof transactionWorkflowMutationSchema>;
export interface TransactionPrivateNote { id: string; body: string; createdAt: string; updatedAt: string; canEdit: boolean }
export interface TransactionOpenHouse { id: string; startsAt: string; endsAt: string; attendance: number | null; notes: string; status: "planned" | "completed" | "cancelled"; createdAt: string; updatedAt: string }
export interface TransactionReopenRequest { id: string; reason: string; status: "pending" | "approved" | "denied"; decisionReason: string | null; previousClosedDate: string | null; createdAt: string; updatedAt: string; canDecide: boolean }
export interface TransactionWorkflow { deletedAt: string | null; deletedReason: string | null; listingPlan: ListingPlan; notes: TransactionPrivateNote[]; openHouses: TransactionOpenHouse[]; reopenRequests: TransactionReopenRequest[]; canArchive: boolean; canRestore: boolean; canRequestReopen: boolean; canManageHelp: boolean }
export { isListingSide } from "./listing-term.ts";
export function listingTermProgress(plan: ListingPlan, today: string): { state: "not_set" | "upcoming" | "active" | "expired" | "cancelled" | "withdrawn"; percent: number; daysRemaining: number | null } {
  if (plan.status === "cancelled" || plan.status === "withdrawn") return { state: plan.status, percent: 0, daysRemaining: null };
  if (!plan.goLiveDate || !plan.expirationDate) return { state: "not_set", percent: 0, daysRemaining: null };
  const start = Date.parse(`${plan.goLiveDate}T00:00:00Z`), end = Date.parse(`${plan.expirationDate}T00:00:00Z`), now = Date.parse(`${today}T00:00:00Z`), remaining = Math.ceil((end - now) / 86400000);
  return { state: now < start ? "upcoming" : now > end ? "expired" : "active", percent: Math.max(0, Math.min(100, end === start ? now >= start ? 100 : 0 : (now - start) / (end - start) * 100)), daysRemaining: remaining };
}
