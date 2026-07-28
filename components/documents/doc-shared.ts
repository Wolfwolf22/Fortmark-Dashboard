/**
 * Small shared bits for the documents feature — kind labels, status pill
 * tones, and the overdue check used by the table.
 */
import { DocumentStatus, StatusTone, TransactionDocument } from "@/lib/data/types";

export const DOCUMENT_KIND_LABELS: Record<TransactionDocument["kind"], string> = {
  contract: "Contract",
  disclosure: "Disclosure",
  addendum: "Addendum",
  inspectionReport: "Inspection report",
  appraisal: "Appraisal",
  closingStatement: "Closing statement",
};

export const DOCUMENT_KINDS = Object.keys(
  DOCUMENT_KIND_LABELS
) as TransactionDocument["kind"][];

export const DOCUMENT_STATUS_TONE: Record<DocumentStatus, StatusTone> = {
  missing: "bad",
  pendingSignature: "warn",
  executed: "good",
};

/** Sort order for the status column — most urgent first ascending. */
export const DOCUMENT_STATUS_ORDER: Record<DocumentStatus, number> = {
  missing: 0,
  pendingSignature: 1,
  executed: 2,
};

/** A document past its due date and still unexecuted is overdue. */
export function isPastDue(doc: TransactionDocument, now = new Date()): boolean {
  return (
    doc.status !== "executed" &&
    doc.dueDate != null &&
    new Date(doc.dueDate).getTime() < now.getTime()
  );
}
