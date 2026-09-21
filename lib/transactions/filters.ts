/**
 * Transaction list filters, parsed once for both shapes they arrive in.
 *
 * The list screen sends its non-identifying filters and its date window in a
 * query string; the search term arrives in a POST body instead
 * (`app/api/transactions/search`). Both paths must agree on what a valid
 * filter is, so both run through here. `read` is a plain key lookup,
 * satisfied by `URLSearchParams.get` or by a JSON object.
 *
 * Isomorphic on purpose: no server-only import, so a test can exercise it
 * without a request.
 */
import type { TransactionFilters, TransactionSide, TransactionStage } from "../data/types.ts";
import { ALL_STAGES } from "./stages.ts";

export const SIDES: readonly TransactionSide[] = ["listing", "buyer", "dual", "landlord", "tenant"];

export type FilterReader = (key: string) => string | null;

export function parseTransactionFilters(
  read: FilterReader
): { filters: TransactionFilters; range?: { from: Date; to: Date } } {
  const list = <T extends string>(raw: string | null, allowed: readonly T[]) => {
    if (!raw) return undefined;
    const picked = raw.split(",").map((s) => s.trim()).filter((s): s is T => (allowed as readonly string[]).includes(s));
    return picked.length ? picked : undefined;
  };
  const q = read("q")?.trim().slice(0, 120);
  const filters: TransactionFilters = {
    stage: list(read("stage"), ALL_STAGES as readonly TransactionStage[]),
    side: list(read("side"), SIDES),
    query: q && q.length > 0 ? q : undefined,
  };
  const from = read("from");
  const to = read("to");
  let range: { from: Date; to: Date } | undefined;
  if (from && to) {
    const f = new Date(from);
    const t = new Date(to);
    if (!Number.isNaN(f.getTime()) && !Number.isNaN(t.getTime()) && f <= t) range = { from: f, to: t };
  }
  return { filters, range };
}

