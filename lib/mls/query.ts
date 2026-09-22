/**
 * Query-string → `ListingSearchQuery`, validated.
 *
 * Every value here arrives from a browser and becomes part of an upstream
 * OData filter, so nothing passes through unchecked: enumerations are
 * matched against the domain's own lists, numbers must be finite and
 * non-negative, free text is length-capped, and paging is clamped.
 *
 * Pure, no I/O — importable by tests directly.
 */
import type {
  ListingSearchQuery,
  ListingSortKey,
  ListingStatus,
  PropertyType,
  SortDirection,
} from "../data/types.ts";

const STATUSES: readonly ListingStatus[] = [
  "active",
  "comingSoon",
  "pending",
  "underContract",
  "closed",
  "expired",
  "withdrawn",
  "hold",
];
const TYPES: readonly PropertyType[] = [
  "singleFamily",
  "condo",
  "townhouse",
  "multiFamily",
  "land",
  "other",
];
const SORT_KEYS: readonly ListingSortKey[] = [
  "address",
  "city",
  "status",
  "propertyType",
  "listPrice",
  "beds",
  "baths",
  "sqft",
  "ppsf",
  "daysOnMarket",
  "listedDate",
];

export const DEFAULT_PAGE_SIZE = 12;
export const MAX_QUERY_CHARS = 120;
export const MAX_CITY_CHARS = 60;

function list<T extends string>(raw: string | null, allowed: readonly T[]): T[] | undefined {
  if (!raw) return undefined;
  const picked = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is T => (allowed as readonly string[]).includes(s));
  return picked.length > 0 ? picked : undefined;
}

function nonNegative(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function positiveInt(raw: string | null, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Cities are free text, so they are bounded and stripped of characters that
 * have no place in a place name and could only be an attempt at the filter
 * syntax. The OData escaping happens later regardless; this is a first
 * fence, not the only one.
 */
function cities(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  const out = raw
    .split(",")
    .map((s) => s.trim().slice(0, MAX_CITY_CHARS))
    .filter((s) => s.length > 0 && !/[()'"<>;]/.test(s));
  return out.length > 0 ? out : undefined;
}

export function parseListingQuery(params: URLSearchParams): ListingSearchQuery {
  const sortKey = params.get("sort");
  const dir = params.get("dir");
  const q = params.get("q")?.trim().slice(0, MAX_QUERY_CHARS);
  return {
    office: params.get("office") === "fortmark" ? "fortmark" : undefined,
    status: list(params.get("status"), STATUSES),
    propertyType: list(params.get("propertyType"), TYPES),
    city: cities(params.get("city")),
    minPrice: nonNegative(params.get("minPrice")),
    maxPrice: nonNegative(params.get("maxPrice")),
    minBeds: nonNegative(params.get("minBeds")),
    query: q && q.length > 0 ? q : undefined,
    page: positiveInt(params.get("page"), 1),
    pageSize: positiveInt(params.get("pageSize"), DEFAULT_PAGE_SIZE),
    sortKey: (SORT_KEYS as readonly string[]).includes(sortKey ?? "")
      ? (sortKey as ListingSortKey)
      : "listedDate",
    sortDirection: dir === "asc" || dir === "desc" ? (dir as SortDirection) : "desc",
  };
}

/** The inverse, for the browser adapter. Omits defaults to keep URLs short. */
export function toSearchParams(q: ListingSearchQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.office === "fortmark") p.set("office", "fortmark");
  if (q.status?.length) p.set("status", q.status.join(","));
  if (q.propertyType?.length) p.set("propertyType", q.propertyType.join(","));
  if (q.city?.length) p.set("city", q.city.join(","));
  if (q.minPrice !== undefined) p.set("minPrice", String(q.minPrice));
  if (q.maxPrice !== undefined) p.set("maxPrice", String(q.maxPrice));
  if (q.minBeds !== undefined) p.set("minBeds", String(q.minBeds));
  if (q.query) p.set("q", q.query);
  if (q.page !== 1) p.set("page", String(q.page));
  if (q.pageSize !== DEFAULT_PAGE_SIZE) p.set("pageSize", String(q.pageSize));
  if (q.sortKey !== "listedDate") p.set("sort", q.sortKey);
  if (q.sortDirection !== "desc") p.set("dir", q.sortDirection);
  return p;
}
