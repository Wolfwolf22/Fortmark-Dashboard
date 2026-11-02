import { z } from "zod";
import type { ActiveStage } from "./stages.ts";
export interface TransactionChecklistAttachment { id: string; itemId: string; filename: string; contentType: string; sizeBytes: number; createdAt: string; updatedAt: string }
const base = { requestId: z.string().uuid(), expectedUpdatedAt: z.string().datetime({ offset: true }), itemId: z.string().uuid(), expectedItemUpdatedAt: z.string().datetime({ offset: true }) };
export const transactionAttachmentRequirementSchema = z.object({ ...base, attachmentRequired: z.boolean() }).strict();
export type TransactionAttachmentRequirementInput = z.infer<typeof transactionAttachmentRequirementSchema>;
export const transactionAttachmentUploadSchema = z.object(base).strict();
export type TransactionAttachmentUploadInput = z.infer<typeof transactionAttachmentUploadSchema>;
export const transactionAttachmentRemoveSchema = z.object({ ...base, expectedAttachmentUpdatedAt: z.string().datetime({ offset: true }) }).strict();
export type TransactionAttachmentRemoveInput = z.infer<typeof transactionAttachmentRemoveSchema>;
export const checklistAttachmentDefaultSchema = z.object({ requestId: z.string().uuid(), templateKey: z.string().min(1).max(160), attachmentRequired: z.boolean(), expectedUpdatedAt: z.string().datetime({ offset: true }).nullable() }).strict();
export type ChecklistAttachmentDefaultInput = z.infer<typeof checklistAttachmentDefaultSchema>;
export interface ChecklistAttachmentDefaults { items: { templateKey: string; label: string; stage: ActiveStage; attachmentRequired: boolean; updatedAt: string | null }[]; canManage: boolean }

export function checklistAttachmentCount(item: { attachments?: readonly unknown[]; attachmentCount?: number }): number { return item.attachmentCount ?? item.attachments?.length ?? 0; }
export function checklistItemSatisfied(item: { completedAt: string | Date | null; attachmentRequired?: boolean; attachments?: readonly unknown[]; attachmentCount?: number }): boolean {
  return Boolean(item.completedAt) && (!item.attachmentRequired || checklistAttachmentCount(item) > 0);
}
