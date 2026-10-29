/** Pure ordering/paging/clock decisions for the Contacts workspace. */
import type { ContactQuery, SortDir, SortKey } from "./filters.ts";
import { startOfNextBusinessDay } from "../metrics/business-day.ts";

export function contactDefaultOrder(query: ContactQuery): { sort: SortKey; dir: SortDir } {
  if (query.followUp === "overdue" || query.followUp === "due_today" || query.followUp === "upcoming") return { sort: "followUp", dir: "asc" };
  if (query.lastTouch === "14d" || query.lastTouch === "30d" || query.lastTouch === "7d") return { sort: "lastTouch", dir: "asc" };
  return { sort: "lastTouch", dir: "desc" };
}

export function contactPageWithinRange(page: number, total: number, pageSize: number): number {
  const last = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return Math.min(Math.max(1, Math.trunc(page) || 1), last);
}

/** A pending search always starts at one, even before its URL reset settles. */
export function contactWorkspaceRequest(filters: ContactQuery, search: string, pageSize: number, resettingSearch = false): ContactQuery & { sort: SortKey; dir: SortDir; page: number; pageSize: number } {
  const order: { sort: SortKey; dir: SortDir } = filters.sort ? { sort: filters.sort, dir: filters.dir ?? "asc" } : contactDefaultOrder(filters);
  return { ...filters, q: search.trim() || undefined, ...order, page: resettingSearch ? 1 : filters.page ?? 1, pageSize };
}

/** Allow the boundary to pass before asking for the new day's figures; DST-safe. */
export function nextContactRefreshDelay(at: Date, timedActions = false): number {
  const dayBoundary = startOfNextBusinessDay(at).getTime() - at.getTime() + 50;
  const clockBoundary = timedActions ? 60_000 - (at.getTime() % 60_000) + 50 : Infinity;
  return Math.max(1, Math.min(dayBoundary, clockBoundary));
}
