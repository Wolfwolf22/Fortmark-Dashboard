/**
 * Small helpers shared by the transactions board, table, and drawer.
 * Lives here (not lib/) so the transactions feature stays self-contained.
 */
import { daysUntilTransactionDay } from "@/lib/transactions/calendar-days";
import { TRANSACTION_STAGE_LABELS, type Transaction, type TransactionStage } from "@/lib/data/types";
import { nextStage as lifecycleNext } from "@/lib/transactions/stages";

export const SIDE_LABELS: Record<Transaction["side"], string> = {
  listing: "Listing side",
  buyer: "Buyer side",
  dual: "Both sides",
  landlord: "Landlord side",
  tenant: "Tenant side",
  gc: "GC / General contractor",
};

export const SIDE_SHORT: Record<Transaction["side"], string> = {
  listing: "List",
  buyer: "Buy",
  dual: "Dual",
  landlord: "Landlord",
  tenant: "Tenant",
  gc: "GC",
};

/**
 * Calendar days until scheduled close in New York; due today remains zero.
 */
export function daysToClose(closeDateIso: string | undefined): number | null {
  return daysUntilTransactionDay(closeDateIso);
}

/** "16d to close" / "closes today" / "3d past close" / "closed" / "no close date" */
export function closeCountdown(t: Transaction): string {
  if(t.side==="gc")return "Setup pending";
  if (t.stage === "closed") return "closed";
  const d = daysToClose(t.closeDate);
  if (d === null) return "no close date";
  if (d === 0) return "closes today";
  if (d < 0) return `${Math.abs(d)}d past close`;
  return `${d}d to close`;
}

/**
 * The stage after `stage` along the pipeline, or undefined when the deal is
 * closed, exited or on hold — those are not advanced, they are resolved.
 */
export function nextStage(stage: TransactionStage): TransactionStage | undefined {
  return lifecycleNext(stage) ?? undefined;
}

export function transactionWorkflowLabel(transaction:Pick<Transaction,"side"|"stage">):string{return transaction.side==="gc"?"Setup pending":TRANSACTION_STAGE_LABELS[transaction.stage];}
