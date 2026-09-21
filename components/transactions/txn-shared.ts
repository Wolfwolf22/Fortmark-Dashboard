/**
 * Small helpers shared by the transactions board, table, and drawer.
 * Lives here (not lib/) so the transactions feature stays self-contained.
 */
import type { Transaction, TransactionStage } from "@/lib/data/types";
import { nextStage as lifecycleNext } from "@/lib/transactions/stages";

export const SIDE_LABELS: Record<Transaction["side"], string> = {
  listing: "Listing side",
  buyer: "Buyer side",
  dual: "Both sides",
  landlord: "Landlord side",
  tenant: "Tenant side",
};

export const SIDE_SHORT: Record<Transaction["side"], string> = {
  listing: "List",
  buyer: "Buy",
  dual: "Dual",
  landlord: "Landlord",
  tenant: "Tenant",
};

/**
 * Whole days from now to the scheduled close, or null when no close date has
 * been entered. Anchored to the top of the current hour (same anchoring as
 * the sample set) so the value is deterministic within the hour.
 */
export function daysToClose(closeDateIso: string | undefined): number | null {
  if (!closeDateIso) return null;
  const anchor = new Date();
  anchor.setMinutes(0, 0, 0);
  return Math.round(
    (new Date(closeDateIso).getTime() - anchor.getTime()) / 86400000
  );
}

/** "16d to close" / "closes today" / "3d past close" / "closed" / "no close date" */
export function closeCountdown(t: Transaction): string {
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
