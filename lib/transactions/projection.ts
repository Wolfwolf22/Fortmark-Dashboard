import type { Milestone, MilestoneKey, StatusTone, Transaction, TransactionSide, TransactionStage, TransactionType } from "../data/types.ts";
import type { TransactionDeadlineRow, TransactionPartyRow, TransactionRow } from "../db/schema.ts";
import { centsToDollars, projectCommission } from "./money.ts";
import { isTerminalStage, STAGE_LABELS } from "./stages.ts";
import { calendarDayIso, transactionDeadlineState, daysUntilTransactionDay } from "./calendar-days.ts";

// --- Row → screen -----------------------------------------------------------------

/** The party the screen calls "the client", by which side FortMark is on. */
const CLIENT_ROLE_FOR_SIDE: Record<TransactionSide, readonly TransactionPartyRow["role"][]> = {
  listing: ["seller", "landlord"],
  buyer: ["buyer", "tenant"],
  dual: ["buyer", "seller"],
  landlord: ["landlord"],
  tenant: ["tenant"],
  gc: ["other"],
};

export function primaryClient(
  side: TransactionSide,
  parties: readonly TransactionPartyRow[]
): TransactionPartyRow | undefined {
  const wanted = CLIENT_ROLE_FOR_SIDE[side];
  const candidates = parties.filter((p) => wanted.includes(p.role));
  return candidates.find((p) => p.isPrimary) ?? candidates[0];
}

/** A `date` column arrives as yyyy-mm-dd; the screen wants ISO. */
export function dateToIso(d: string | null | undefined): string | undefined {
  if (!d) return undefined;
  return calendarDayIso(d);
}

export function toMilestone(row: TransactionDeadlineRow, now: Date): Milestone {
  const date = dateToIso(row.dueDate) ?? new Date(0).toISOString();
  const state = transactionDeadlineState(row.dueDate, row.completedAt, now);
  return { id: row.id, key: row.kind as MilestoneKey, label: row.label, date, state };
}

/**
 * Health rollup, from the deal's own deadlines. Closed and the exit stages
 * are neutral and say which; otherwise any open overdue deadline is "at
 * risk", and one more than a week overdue is "off track".
 */
export function rollupStatus(
  stage: TransactionStage,
  milestones: readonly Milestone[],
  now: Date
): { status: StatusTone; statusLabel: string } {
  if (stage === "closed" || isTerminalStage(stage)) {
    return { status: "neutral", statusLabel: STAGE_LABELS[stage] };
  }
  if (stage === "on_hold") return { status: "neutral", statusLabel: "On hold" };
  const overdue = milestones.filter((m) => m.state === "overdue");
  if (milestones.length === 0) return { status: "neutral", statusLabel: "Needs setup" };
  if (overdue.length === 0) return { status: "good", statusLabel: "On track" };
  const worstDays = Math.max(
    ...overdue.map((m) => -(daysUntilTransactionDay(m.date, now) ?? 0))
  );
  return worstDays > 7
    ? { status: "bad", statusLabel: "Off track" }
    : { status: "warn", statusLabel: "At risk" };
}

export interface RowBundle {
  row: TransactionRow;
  parties: readonly TransactionPartyRow[];
  deadlines: readonly TransactionDeadlineRow[];
  /** Display name of the responsible agent, when known. */
  agentName?: string;
}

/**
 * A stored deal as the screen renders it. Money is converted to dollars only
 * here, at the edge; nothing upstream of this function sees a dollar.
 */
export function toTransaction(bundle: RowBundle, now: Date = new Date()): Transaction {
  const { row, parties, deadlines } = bundle;
  const isGc = row.side === "gc";
  const client = primaryClient(row.side as TransactionSide, parties);
  const milestones = (isGc ? [] : [...deadlines]).filter(deadline => !deadline.removedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.dueDate.localeCompare(b.dueDate))
    .map((d) => toMilestone(d, now));
  const projection = isGc ? null : projectCommission({
    contractPriceCents: row.contractPriceCents,
    commissionRateBps: row.commissionRateBps,
    commissionFlatCents: row.commissionFlatCents,
    agentSplitBps: row.agentSplitBps,
    transactionFeeCents: row.transactionFeeCents,
    referralFeeBps: row.referralFeeBps,
  });
  const stage = row.stage as TransactionStage;
  return {
    id: row.id,
    listingId: row.listingKey ?? undefined,
    mlsNumber: row.mlsNumber ?? undefined,
    listingDataset: row.listingDataset ?? undefined,
    listingLinkedAt: row.listingLinkedAt?.toISOString(),
    listPrice: row.listPriceCents === null ? undefined : centsToDollars(row.listPriceCents),
    address: row.addressLine2 ? `${row.addressLine1} ${row.addressLine2}` : row.addressLine1,
    city: row.city,
    clientId: client?.id ?? "",
    clientName: client?.displayName ?? "—",
    side: row.side as TransactionSide,
    transactionType: row.transactionType as TransactionType,
    stage,
    contractPrice: isGc ? 0 : centsToDollars(row.contractPriceCents ?? 0),
    commissionRate: isGc ? 0 : (row.commissionRateBps ?? 0) / 10_000,
    projectedCommission: centsToDollars(projection?.grossCents ?? 0),
    contractDate: isGc ? undefined : dateToIso(row.contractExecutionDate),
    updatedAt: row.updatedAt.toISOString(),
    closeDate: isGc ? undefined : dateToIso(row.closedDate) ?? dateToIso(row.closingDate),
    agentId: row.agentUserId,
    agentName: bundle.agentName,
    milestones,
    ...(isGc ? { status: "neutral" as const, statusLabel: "Setup pending" } : rollupStatus(stage, milestones, now)),
    source: "db",
  };
}
