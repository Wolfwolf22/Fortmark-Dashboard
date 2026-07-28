/**
 * Small helpers shared by the transactions board, table, and drawer.
 * Lives here (not lib/) so the transactions feature stays self-contained.
 */
import {
  Transaction,
  TransactionStage,
  TRANSACTION_STAGES,
} from "@/lib/data/types";

export const SIDE_LABELS: Record<Transaction["side"], string> = {
  list: "List side",
  buy: "Buy side",
};

export const SIDE_SHORT: Record<Transaction["side"], string> = {
  list: "List",
  buy: "Buy",
};

/**
 * Whole days from now to the scheduled close. Anchored to the top of the
 * current hour (same anchoring as the mock db) so the value is deterministic
 * within the hour.
 */
export function daysToClose(closeDateIso: string): number {
  const anchor = new Date();
  anchor.setMinutes(0, 0, 0);
  return Math.round(
    (new Date(closeDateIso).getTime() - anchor.getTime()) / 86400000
  );
}

/** "16d to close" / "closes today" / "3d past close" / "closed" */
export function closeCountdown(t: Transaction): string {
  if (t.stage === "closed") return "closed";
  const d = daysToClose(t.closeDate);
  if (d === 0) return "closes today";
  if (d < 0) return `${Math.abs(d)}d past close`;
  return `${d}d to close`;
}

/** The stage after `stage` in pipeline order, or undefined at the end. */
export function nextStage(stage: TransactionStage): TransactionStage | undefined {
  const idx = TRANSACTION_STAGES.indexOf(stage);
  return idx >= 0 && idx < TRANSACTION_STAGES.length - 1
    ? TRANSACTION_STAGES[idx + 1]
    : undefined;
}
