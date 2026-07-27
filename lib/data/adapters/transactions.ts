/**
 * Transactions adapter. Mock-backed today; swap the bodies for the deals
 * service and the UI is untouched.
 */
import {
  DateRange,
  Milestone,
  MILESTONE_LABELS,
  Transaction,
  TransactionFilters,
  TransactionStage,
  TRANSACTION_STAGES,
} from "../types";
import { now, transactions } from "../mock/db";
import { bumpDataVersion } from "../store";
import { inRange } from "@/lib/dates";
import { delay } from "./latency";

/** Active transactions relevant to a reporting period (entered contract or closing within it). */
export async function getTransactions(
  filters?: TransactionFilters,
  range?: DateRange
): Promise<Transaction[]> {
  await delay();
  let result = [...transactions];
  if (range)
    result = result.filter(
      (t) => inRange(t.contractDate, range) || inRange(t.closeDate, range)
    );
  if (filters?.stage?.length)
    result = result.filter((t) => filters.stage!.includes(t.stage));
  if (filters?.side?.length)
    result = result.filter((t) => filters.side!.includes(t.side));
  if (filters?.agentId)
    result = result.filter((t) => t.agentId === filters.agentId);
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
    (a, b) => new Date(a.closeDate).getTime() - new Date(b.closeDate).getTime()
  );
}

export async function getTransaction(id: string): Promise<Transaction | undefined> {
  await delay(120);
  return transactions.find((t) => t.id === id);
}

/** Kanban drag-to-advance writes here. */
export async function updateTransactionStage(
  id: string,
  stage: TransactionStage
): Promise<Transaction | undefined> {
  await delay(150);
  const txn = transactions.find((t) => t.id === id);
  if (!txn) return undefined;
  txn.stage = stage;
  const stageOrder = TRANSACTION_STAGES.indexOf(stage);
  const milestoneOrder = ["offerAccepted", "inspection", "appraisal", "financing", "clearToClose", "closing"] as const;
  txn.milestones = txn.milestones.map((m: Milestone, idx: number) => {
    if (idx < stageOrder || stage === "closed") return { ...m, state: "done" as const };
    const overdue = new Date(m.date).getTime() < now().getTime();
    return { ...m, state: overdue ? ("overdue" as const) : ("upcoming" as const) };
  });
  if (stage === "closed") {
    txn.status = "neutral";
    txn.statusLabel = "Closed";
  } else {
    const overdue = txn.milestones.filter((m) => m.state === "overdue");
    txn.status = overdue.length > 1 ? "bad" : overdue.length ? "warn" : "good";
    txn.statusLabel = txn.status === "bad" ? "Off track" : txn.status === "warn" ? "At risk" : "On track";
  }
  bumpDataVersion();
  return txn;
}

export async function createTransaction(
  input: Pick<Transaction, "address" | "city" | "clientName" | "side" | "contractPrice" | "closeDate">
): Promise<Transaction> {
  await delay(220);
  const contractDate = now().toISOString();
  const created: Transaction = {
    id: `txn-${transactions.length + 1}-new`,
    clientId: "client-new",
    stage: "offer",
    commissionRate: 0.03,
    contractDate,
    agentId: "agent-1",
    milestones: (
      ["offerAccepted", "inspection", "appraisal", "financing", "clearToClose", "closing"] as const
    ).map((key, i) => ({
      key,
      label: MILESTONE_LABELS[key],
      date: new Date(now().getTime() + i * 9 * 86400000).toISOString(),
      state: i === 0 ? "done" : "upcoming",
    })),
    status: "good",
    statusLabel: "On track",
    ...input,
  };
  transactions.unshift(created);
  bumpDataVersion();
  return created;
}
