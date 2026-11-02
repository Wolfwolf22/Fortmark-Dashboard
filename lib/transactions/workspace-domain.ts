import { z } from "zod";
import type { Transaction, TransactionType, MilestoneKey } from "../data/types.ts";
import { deadlineInputSchema } from "./validation.ts";
import type { TransactionChecklist } from "./checklist-domain.ts";

const text = (cap: number) => z.string().max(cap).refine(value => !value.includes("\u0000"), "Invalid text.");
const optionalText = (cap: number) => text(cap).trim().nullable();
const cents = z.number().int().min(0).max(999_999_999_999).nullable(), bps = z.number().int().min(0).max(10000).nullable();
const calendarDay = deadlineInputSchema.shape.dueDate.nullable();
const revision = z.string().datetime({ offset: true });
export const transactionDetailsSchema = z.object({
  transactionType: z.enum(["residential_sale", "residential_lease", "commercial_sale", "commercial_lease", "land"]),
  addressLine1: text(200).trim().min(1), addressLine2: optionalText(200), city: text(200).trim().min(1), state: text(2).trim().length(2), postalCode: optionalText(12), listingKey: optionalText(64), mlsNumber: optionalText(32),
  contractPriceCents: cents, listPriceCents: cents, commissionRateBps: bps, commissionFlatCents: cents, agentSplitBps: bps, transactionFeeCents: cents, referralFeeBps: bps,
  contractExecutionDate: calendarDay, closingDate: calendarDay, notes: text(5000),
}).strict();
export type TransactionDetails = z.infer<typeof transactionDetailsSchema>;
export const updateTransactionWorkspaceSchema = z.object({ requestId: z.string().uuid(), expectedUpdatedAt: revision, details: transactionDetailsSchema }).strict();
const base = { requestId: z.string().uuid(), expectedUpdatedAt: revision };
const child = { deadlineId: z.string().uuid(), expectedDeadlineUpdatedAt: revision };
export const transactionDeadlineMutationSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("add"), deadline: deadlineInputSchema }).strict(),
  z.object({ ...base, ...child, action: z.literal("edit"), deadline: deadlineInputSchema }).strict(),
  z.object({ ...base, ...child, action: z.literal("complete") }).strict(),
  z.object({ ...base, ...child, action: z.literal("reopen") }).strict(),
  z.object({ ...base, ...child, action: z.literal("remove") }).strict(),
]);
export type UpdateTransactionWorkspaceInput = z.infer<typeof updateTransactionWorkspaceSchema>;
export type TransactionDeadlineMutation = z.infer<typeof transactionDeadlineMutationSchema>;
export interface TransactionDeadlineView { id: string; kind: MilestoneKey; label: string; dueDate: string; note: string; completedAt: string | null; updatedAt: string; state: "done" | "upcoming" | "overdue" }
export interface TransactionPartyView { id: string; role: string; displayName: string; company: string | null; email: string | null; phone: string | null; isPrimary: boolean; contactId: string | null; canOpenContact: boolean }
export interface TransactionHistoryView { id: string; eventType: string; action: string; fields: string[]; fromStage?: string; toStage?: string; createdAt: string }
export interface TransactionHistoryPage { items: TransactionHistoryView[]; total: number; page: number; pageSize: number }
export interface TransactionWorkspace { transaction: Transaction; details: TransactionDetails; deadlines: TransactionDeadlineView[]; checklist: TransactionChecklist; parties: TransactionPartyView[]; history: TransactionHistoryPage; canEdit: boolean; updatedAt: string }
export function readTransactionWorkspaceQuery(params: URLSearchParams): { historyPage: number } | null {
  if ([...params.keys()].some(key => key !== "historyPage") || params.getAll("historyPage").length > 1) return null;
  const raw = params.get("historyPage"); return raw === null ? { historyPage: 1 } : /^\d{1,7}$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 1000000 ? { historyPage: Number(raw) } : null;
}
