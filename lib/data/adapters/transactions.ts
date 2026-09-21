/**
 * Transactions adapter — the browser's view of the deal domain.
 *
 * The server decides the source (the database or the labelled sample set)
 * and this module asks it once. In `db` mode every read and write is a call
 * to the transactions routes; in `sample` mode the same contract is served
 * locally so quick-create and drag-to-advance keep working in memory. The
 * board, table and drawer see one shape either way, and every row carries
 * the `source` it came from.
 */
import { apiPath } from "@/lib/routes";
import {
  createSampleTransaction,
  getSampleTransaction,
  listSampleTransactions,
  updateSampleTransactionStage,
} from "../sample-transactions";
import { bumpDataVersion } from "../store";
import type {
  DateRange,
  Transaction,
  TransactionFilters,
  TransactionStage,
} from "../types";
import { delay } from "./latency";

/** A failed call, carrying the server's coarse reason for the UI to name. */
export class TransactionsError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(`Transactions request failed (${status}: ${code})`);
    this.name = "TransactionsError";
    this.code = code;
    this.status = status;
  }
}

type Source = "db" | "sample";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiPath(path), {
    ...init,
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  if (!response.ok) {
    let code = "unknown";
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string") code = body.error;
    } catch {
      // A non-JSON failure body is still a failure; the status says enough.
    }
    throw new TransactionsError(code, response.status);
  }
  return (await response.json()) as T;
}

let sourcePromise: Promise<Source> | null = null;

export function getTransactionSource(): Promise<Source> {
  if (!sourcePromise) {
    sourcePromise = request<{ source: Source }>("/api/transactions/source")
      .then((r) => r.source)
      .catch((error) => {
        sourcePromise = null;
        throw error;
      });
  }
  return sourcePromise;
}

/** Deals relevant to a reporting period (entered contract or closing within it). */
export async function getTransactions(
  filters?: TransactionFilters,
  range?: DateRange
): Promise<Transaction[]> {
  if ((await getTransactionSource()) === "sample") {
    await delay();
    return listSampleTransactions(filters, range);
  }
  const p = new URLSearchParams();
  if (filters?.stage?.length) p.set("stage", filters.stage.join(","));
  if (filters?.side?.length) p.set("side", filters.side.join(","));
  if (filters?.query) p.set("q", filters.query);
  if (range) {
    p.set("from", range.from.toISOString());
    p.set("to", range.to.toISOString());
  }
  const qs = p.toString();
  const { items } = await request<{ items: Transaction[] }>(`/api/transactions${qs ? `?${qs}` : ""}`);
  return items;
}

export async function getTransaction(id: string): Promise<Transaction | undefined> {
  if ((await getTransactionSource()) === "sample") {
    await delay(120);
    return getSampleTransaction(id);
  }
  try {
    const { transaction } = await request<{ transaction: Transaction }>(
      `/api/transactions/${encodeURIComponent(id)}`
    );
    return transaction;
  } catch (error) {
    if (error instanceof TransactionsError && error.status === 404) return undefined;
    throw error;
  }
}

/**
 * Kanban drag-to-advance and the drawer's advance button write here.
 *
 * A move the lifecycle refuses throws `invalid_transition` so the board can
 * snap the card back; it is never silently ignored.
 */
export async function updateTransactionStage(
  id: string,
  stage: TransactionStage
): Promise<Transaction | undefined> {
  if ((await getTransactionSource()) === "sample") {
    await delay(150);
    return updateSampleTransactionStage(id, stage);
  }
  const { transaction } = await request<{ transaction: Transaction }>(
    `/api/transactions/${encodeURIComponent(id)}/stage`,
    { method: "POST", body: JSON.stringify({ stage }) }
  );
  // Every open list refetches, the same way a sample mutation triggers it.
  bumpDataVersion();
  return transaction;
}

export interface QuickCreateTransactionInput {
  address: string;
  city: string;
  clientName: string;
  side: Transaction["side"];
  /** Dollars, as typed. Converted to integer cents before it leaves the browser. */
  contractPrice: number;
  /** ISO. */
  closeDate?: string;
}

export async function createTransaction(input: QuickCreateTransactionInput): Promise<Transaction> {
  if ((await getTransactionSource()) === "sample") {
    await delay(220);
    return createSampleTransaction(input);
  }
  const closingDate = input.closeDate ? input.closeDate.slice(0, 10) : undefined;
  const clientRole =
    input.side === "listing" ? "seller" : input.side === "landlord" ? "landlord" : input.side === "tenant" ? "tenant" : "buyer";
  const { transaction } = await request<{ transaction: Transaction }>("/api/transactions", {
    method: "POST",
    body: JSON.stringify({
      transactionType: "residential_sale",
      side: input.side,
      addressLine1: input.address,
      city: input.city,
      contractPriceCents: Math.round(input.contractPrice * 100),
      closingDate,
      parties: input.clientName.trim()
        ? [{ role: clientRole, displayName: input.clientName.trim(), isPrimary: true }]
        : [],
    }),
  });
  bumpDataVersion();
  return transaction;
}
