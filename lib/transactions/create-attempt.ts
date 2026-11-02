/** A lost create response freezes the submitted file until its receipt is checked. */
import type { QuickCreateTransactionInput } from "../data/adapters/transactions.ts";
export interface TransactionCreateAttempt { key: string; input: Readonly<QuickCreateTransactionInput & { requestId: string }> }
export function transactionCreateAttempt(previous: TransactionCreateAttempt | null, values: QuickCreateTransactionInput, uncertain = false, makeId: () => string = () => crypto.randomUUID()): TransactionCreateAttempt {
  if (uncertain && previous) return previous;
  const { requestId: _request, ...fields } = values, key = JSON.stringify(fields);
  return previous?.key === key ? previous : { key, input: Object.freeze({ ...fields, requestId: makeId() }) };
}
export function transactionCreateUncertain(error: unknown, alreadyUncertain = false): boolean { const status = (error as { status?: number } | null)?.status; return alreadyUncertain || status === undefined || status >= 500; }
