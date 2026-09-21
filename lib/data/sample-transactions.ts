/**
 * The sample transaction source: the seeded generator set, served with the
 * same contract the database service honours.
 *
 * Isomorphic on purpose, like `sample-listings.ts`: the browser adapter uses
 * it directly when the server reports the source is `sample` (so quick-create
 * and drag-to-advance keep working in memory), and the API routes use it in
 * that mode so a non-browser caller sees one contract whatever the source.
 *
 * Every row carries `source: "sample"`, and the UI labels it.
 */
import { now, transactions } from "./mock/db.ts";
import { bumpDataVersion } from "./store.ts";
import type {
  DateRange,
  Milestone,
  Transaction,
  TransactionFilters,
  TransactionStage,
} from "./types.ts";
import { TRANSACTION_STAGES } from "./types.ts";
import { inRange } from "../dates.ts";
import { canTransition, isTerminalStage } from "../transactions/stages.ts";

export function listSampleTransactions(
  filters?: TransactionFilters,
  range?: DateRange
): Transaction[] {
  let result = [...transactions];
  if (range) {
    result = result.filter(
      (t) => inRange(t.contractDate, range) || (t.closeDate ? inRange(t.closeDate, range) : false)
    );
  }
  if (filters?.stage?.length) result = result.filter((t) => filters.stage!.includes(t.stage));
  if (filters?.side?.length) result = result.filter((t) => filters.side!.includes(t.side));
  if (filters?.agentId) result = result.filter((t) => t.agentId === filters.agentId);
  if (filters?.query) {
    const q = filters.query.toLowerCase();
    result = result.filter(
      (t) =>
        t.address.toLowerCase().includes(q) ||
        t.clientName.toLowerCase().includes(q) ||
        t.city.toLowerCase().includes(q)
    );
  }
  return result.sort(
    (a, b) => new Date(a.closeDate ?? a.contractDate).getTime() - new Date(b.closeDate ?? b.contractDate).getTime()
  );
}

export function getSampleTransaction(id: string): Transaction | undefined {
  return transactions.find((t) => t.id === id);
}

/** Drag-to-advance and the drawer's advance button write here. */
export function updateSampleTransactionStage(
  id: string,
  stage: TransactionStage
): Transaction | undefined {
  const txn = transactions.find((t) => t.id === id);
  if (!txn) return undefined;
  if (!canTransition(txn.stage, stage)) return txn;
  txn.stage = stage;
  const reached = TRANSACTION_STAGES.indexOf(stage);
  txn.milestones = txn.milestones.map((m: Milestone, idx: number) => {
    if (idx < reached - 1 || stage === "closed") return { ...m, state: "done" as const };
    const overdue = new Date(m.date).getTime() < now().getTime();
    return { ...m, state: overdue ? ("overdue" as const) : ("upcoming" as const) };
  });
  if (stage === "closed" || isTerminalStage(stage) || stage === "on_hold") {
    txn.status = "neutral";
    txn.statusLabel =
      stage === "closed" ? "Closed" : stage === "on_hold" ? "On hold" : stage === "cancelled" ? "Cancelled" : stage === "withdrawn" ? "Withdrawn" : "Fell through";
  } else {
    const overdue = txn.milestones.filter((m) => m.state === "overdue");
    txn.status = overdue.length > 1 ? "bad" : overdue.length ? "warn" : "good";
    txn.statusLabel = txn.status === "bad" ? "Off track" : txn.status === "warn" ? "At risk" : "On track";
  }
  bumpDataVersion();
  return txn;
}

export function createSampleTransaction(
  input: Pick<Transaction, "address" | "city" | "clientName" | "side" | "contractPrice" | "closeDate">
): Transaction {
  const contractDate = now().toISOString();
  const commissionRate = 0.03;
  const keys = ["inspection", "appraisal", "financing", "title", "closing"] as const;
  const labels = ["Inspection period ends", "Appraisal", "Loan commitment", "Clear to close", "Closing"];
  const created: Transaction = {
    id: `txn-${transactions.length + 1}-new`,
    clientId: "client-new",
    transactionType: "residential_sale",
    stage: "offer",
    commissionRate,
    projectedCommission: Math.round(input.contractPrice * commissionRate),
    contractDate,
    agentId: "agent-1",
    milestones: keys.map((key, i) => ({
      id: key,
      key,
      label: labels[i],
      date: new Date(now().getTime() + (i + 1) * 9 * 86400000).toISOString(),
      state: "upcoming" as const,
    })),
    status: "good",
    statusLabel: "On track",
    source: "sample",
    ...input,
  };
  transactions.unshift(created);
  bumpDataVersion();
  return created;
}
