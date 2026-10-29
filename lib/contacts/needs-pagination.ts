import { HISTORY_PAGE_SIZE, MAX_HISTORY_PAGE_SIZE, type HistoryPage } from "./history.ts";
import type { NeedStatus } from "./needs.ts";

export const NEED_STATUS_RANK: Record<NeedStatus, number> = { active: 0, paused: 1, fulfilled: 2, archived: 3 };
export interface NeedCursor { rank: number; at: string; id: string }

export function compareNeedHistory(a: NeedCursor, b: NeedCursor): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
}

/** Shared by the server and synthetic preview; no status gets silently dropped. */
export function needHistoryPage<T>(items: readonly T[], pageSize: number, key: (item: T) => NeedCursor, cursor?: NeedCursor): HistoryPage<T> {
  const ordered = [...items].sort((a, b) => compareNeedHistory(key(a), key(b))).filter((item) => !cursor || compareNeedHistory(key(item), cursor) > 0);
  const shown = ordered.slice(0, pageSize);
  const hasMore = ordered.length > shown.length;
  return { items: shown, hasMore, nextCursor: hasMore && shown.length ? encodeNeedCursor(key(shown[shown.length - 1])) : null };
}

/** Opaque ordering metadata only; no requirement, area, name or budget. */
export function encodeNeedCursor(cursor: NeedCursor): string {
  return btoa(JSON.stringify({ v: 1, kind: "need", ...cursor })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeNeedCursor(raw: string): NeedCursor | null {
  if (!raw || raw.length > 320 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const value = JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
    if (value.v !== 1 || value.kind !== "need" || !Number.isInteger(value.rank) || value.rank < 0 || value.rank > 3) return null;
    if (typeof value.at !== "string" || typeof value.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)) return null;
    const date = new Date(value.at);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== value.at) return null;
    return { rank: value.rank, at: value.at, id: value.id };
  } catch { return null; }
}

export function readNeedsQuery(params: URLSearchParams): { pageSize: number; cursor?: NeedCursor } | null {
  const rawSize = params.get("pageSize");
  if (rawSize !== null && !/^\d{1,3}$/.test(rawSize)) return null;
  const pageSize = rawSize === null ? HISTORY_PAGE_SIZE : Number(rawSize);
  if (pageSize < 1 || pageSize > MAX_HISTORY_PAGE_SIZE) return null;
  const rawCursor = params.get("cursor");
  if (rawCursor === null) return { pageSize };
  const cursor = decodeNeedCursor(rawCursor);
  return cursor ? { pageSize, cursor } : null;
}
