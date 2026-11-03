/** Versioned operational starter. It records reviewed work; it does not certify compliance. */
import { z } from "zod";
import { ACTIVE_STAGES, stageIndex, type ActiveStage, type TransactionStage } from "./stages.ts";
import type { TransactionChecklistAttachment } from "./attachment-domain.ts";
import { checklistItemSatisfied } from "./attachment-domain.ts";

export const TRANSACTION_CHECKLIST_VERSION = "brokerage-starter-v1";
export const DEFAULT_CHECKLIST_HELP:Record<string,string>={
 "opportunity.client":"Confirm the client identity, who you represent and the agreed scope of representation. Record the supporting information in this file.",
 "opportunity.scope":"Check the property address and transaction type against the work you agreed to perform.",
 "offer.terms":"Record the material offer terms and any supporting offer documents before advancing.",
 "offer.decision":"Record the client’s reviewed decision. A checklist tick does not accept or send an offer.",
 "contract.agreement":"Review and retain the executed agreement required for this transaction. Check that it is the correct, complete version.",
 "contract.responsibilities":"Confirm the entered contract dates, contingencies and the people responsible for the next actions.",
 "diligence.review":"Record the relevant inspection and disclosure review, including any required evidence or unresolved issues.",
 "diligence.decision":"Record the client’s decision following due diligence and any agreed follow-up.",
 "financing.funding":"Confirm the applicable funding requirements and review the recorded lender or cash-funding information.",
 "financing.contingencies":"Review outstanding contingencies and record their disposition before preparing to close.",
 "closing.review":"Review the full file and required documents. This operational checklist does not certify legal or brokerage compliance.",
 "closing.arrangements":"Confirm closing arrangements and client instructions. Use the separate Close transaction review to record the actual closing.",
};
export interface TransactionChecklistTemplateItem {
  templateKey: string;
  label: string;
  stage: ActiveStage;
  required: boolean;
  attachmentRequired: boolean;
  sortOrder: number;
}

export const DEFAULT_TRANSACTION_CHECKLIST: readonly TransactionChecklistTemplateItem[] = Object.freeze([
  { templateKey: "opportunity.client", label: "Confirm the client and representation side", stage: "opportunity", required: true, sortOrder: 0 },
  { templateKey: "opportunity.scope", label: "Record the property and transaction scope", stage: "opportunity", required: true, sortOrder: 1 },
  { templateKey: "offer.terms", label: "Record the reviewed offer terms", stage: "offer", required: true, sortOrder: 2 },
  { templateKey: "offer.decision", label: "Record the client’s decision on the offer", stage: "offer", required: true, sortOrder: 3 },
  { templateKey: "contract.agreement", label: "Record the executed agreement", stage: "under_contract", required: true, sortOrder: 4 },
  { templateKey: "contract.responsibilities", label: "Confirm agreed dates and assigned responsibilities", stage: "under_contract", required: true, sortOrder: 5 },
  { templateKey: "diligence.review", label: "Record the inspection and disclosure review", stage: "due_diligence", required: true, sortOrder: 6 },
  { templateKey: "diligence.decision", label: "Record the client’s due-diligence decision", stage: "due_diligence", required: true, sortOrder: 7 },
  { templateKey: "financing.funding", label: "Confirm funding requirements have been reviewed", stage: "financing", required: true, sortOrder: 8 },
  { templateKey: "financing.contingencies", label: "Confirm outstanding contingencies have been reviewed", stage: "financing", required: true, sortOrder: 9 },
  { templateKey: "closing.review", label: "Confirm the final file review is complete", stage: "closing_prep", required: true, sortOrder: 10 },
  { templateKey: "closing.arrangements", label: "Record closing arrangements and client instructions", stage: "closing_prep", required: true, sortOrder: 11 },
].map(item => Object.freeze({ ...item, attachmentRequired: false } as TransactionChecklistTemplateItem)));

export interface TransactionChecklistItem extends TransactionChecklistTemplateItem {
  id: string;
  helpText?: string;
  completedAt: string | null;
  updatedAt: string;
  attachments: TransactionChecklistAttachment[];
}
export interface TransactionChecklist {
  templateVersion: string;
  items: TransactionChecklistItem[];
  progress: { completed: number; required: number };
}
export const transactionChecklistMutationSchema = z.object({
  requestId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  itemId: z.string().uuid(),
  expectedItemUpdatedAt: z.string().datetime({ offset: true }),
  action: z.enum(["complete", "reopen"]),
}).strict();
export type TransactionChecklistMutation = z.infer<typeof transactionChecklistMutationSchema>;

/** All earlier checkpoints apply, including skipped stages and resuming a paused file. */
export function checklistRequiredStages(from: TransactionStage, to: TransactionStage): readonly ActiveStage[] {
  const target = to === "closed" ? ACTIVE_STAGES.length : stageIndex(to);
  if (target < 0 || from !== "on_hold" && (stageIndex(from) < 0 || target <= stageIndex(from))) return [];
  return ACTIVE_STAGES.slice(0, target);
}
export function checklistBlockers<T extends { stage: ActiveStage; required: boolean; completedAt: string | Date | null; attachmentRequired?: boolean; attachments?: readonly unknown[]; attachmentCount?: number }>(items: readonly T[], from: TransactionStage, to: TransactionStage): T[] {
  const stages = checklistRequiredStages(from, to);
  return items.filter(item => item.required && !checklistItemSatisfied(item) && stages.includes(item.stage));
}
/** Missing stage snapshots fail closed rather than silently granting advancement. */
export function checklistMissingStages(items: readonly Pick<TransactionChecklistItem, "stage">[], from: TransactionStage, to: TransactionStage): ActiveStage[] {
  return checklistRequiredStages(from, to).filter(stage => !items.some(item => item.stage === stage));
}
export function checklistProgress(items: readonly { required: boolean; completedAt: string | Date | null; attachmentRequired?: boolean; attachments?: readonly unknown[]; attachmentCount?: number }[]): TransactionChecklist["progress"] {
  const required = items.filter(item => item.required);
  return { completed: required.filter(checklistItemSatisfied).length, required: required.length };
}

/** Checklist edits can move the active workflow, but never close or resume a paused file. */
export function checklistAutomaticStage<T extends { stage: ActiveStage; required: boolean; completedAt: string | Date | null; attachmentRequired?: boolean; attachments?: readonly unknown[]; attachmentCount?: number }>(current:TransactionStage,items:readonly T[],action:"complete"|"reopen"):TransactionStage {
  const position=stageIndex(current);if(position<0)return current;
  if(ACTIVE_STAGES.some(stage=>!items.some(item=>item.stage===stage)))return current;
  const target=ACTIVE_STAGES.find(stage=>items.some(item=>item.stage===stage&&item.required&&!checklistItemSatisfied(item)))??"closing_prep",next=stageIndex(target);
  return action==="complete"?next>position?target:current:next<position?target:current;
}

/** Intentionally empty until a GC-specific workflow is agreed. */
export const GC_CHECKLIST_TEMPLATE_VERSION = "gc-blank-v1";
