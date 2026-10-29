/** Stable, non-identifying cursors shared by contact notes and activity. */
export interface HistoryCursor { at: string; id: string }
export interface HistoryPage<T> { items: T[]; nextCursor: string | null; hasMore: boolean }
export const HISTORY_PAGE_SIZE = 25;
export const MAX_HISTORY_PAGE_SIZE = 100;

export function encodeHistoryCursor(value: HistoryCursor): string {
  return btoa(JSON.stringify({ v: 1, ...value })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeHistoryCursor(raw: string): HistoryCursor | null {
  if (!raw || raw.length > 256 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const value = JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
    if (value.v !== 1 || typeof value.at !== "string" || typeof value.id !== "string") return null;
    const date = new Date(value.at);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== value.at) return null;
    if (!/^[A-Za-z0-9-]{1,64}(?::follow-up)?$/.test(value.id)) return null;
    return { at: value.at, id: value.id };
  } catch { return null; }
}

export function readHistoryQuery(params: URLSearchParams): { pageSize: number; cursor?: HistoryCursor } | null {
  const rawSize = params.get("pageSize");
  if (rawSize !== null && !/^\d{1,3}$/.test(rawSize)) return null;
  const pageSize = rawSize === null ? HISTORY_PAGE_SIZE : Number(rawSize);
  if (pageSize < 1 || pageSize > MAX_HISTORY_PAGE_SIZE) return null;
  const rawCursor = params.get("cursor");
  if (rawCursor === null) return { pageSize };
  const cursor = decodeHistoryCursor(rawCursor);
  return cursor ? { pageSize, cursor } : null;
}

/** Descending time, then descending id: ties never repeat or skip a record. */
export function compareHistory(a: HistoryCursor, b: HistoryCursor): number {
  return a.at === b.at ? (a.id === b.id ? 0 : a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1;
}

export function historyPage<T>(items: readonly T[], pageSize: number, key: (item: T) => HistoryCursor, cursor?: HistoryCursor): HistoryPage<T> {
  const ordered = [...items].sort((a, b) => compareHistory(key(a), key(b))).filter(item => !cursor || compareHistory(key(item), cursor) > 0);
  const shown = ordered.slice(0, pageSize);
  const hasMore = ordered.length > shown.length;
  return { items: shown, hasMore, nextCursor: hasMore && shown.length ? encodeHistoryCursor(key(shown[shown.length - 1])) : null };
}
