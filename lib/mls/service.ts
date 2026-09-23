import "server-only";

/**
 * The listings service over the MLS.
 *
 * Filtering, sorting and paging happen HERE, in the query sent upstream —
 * never by pulling the dataset into memory. The sample adapter could afford
 * to filter sixty rows client-side; a real MLS cannot be treated that way.
 *
 * This module is the "internal service" that docs/DEPLOYMENT.md requires
 * between an authenticated route and FortMark data. It holds the only
 * knowledge of RESO field names outside `normalize.ts`.
 */
import type {
  Listing,
  ListingPage,
  ListingSearchQuery,
  ListingSortKey,
  ListingStatus,
  PropertyType,
} from "../data/types.ts";
import { bridgeRequest, MAX_TOP } from "./bridge.ts";
import type { BridgeConfig } from "./config.ts";
import { EMBEDDED_MEDIA_FIELD, MEDIA_FIELDS, OFFICE_FIELDS, PROPERTY_FIELDS, selectClause } from "./fields.ts";
import {
  INCOME_PROPERTY_TYPES,
  LAND_PROPERTY_TYPES,
  embeddedPhotoUrls,
  PROPERTY_SUB_TYPES_FOR,
  STANDARD_STATUS_FOR,
  toListing,
  toPhotoUrls,
  type ResoMedia,
  type ResoRecord,
  type ListingContext,
} from "./normalize.ts";
import { andFilters, anyOf, eq, escapeODataString, looksLikeMlsNumber, num } from "./odata.ts";

/** Sales only. Leases share StandardStatus values on this MLS, so the type
 *  filter is always present — omitting it would mix rentals into results. */
const SALES_PROPERTY_TYPE = "Residential";

/** Largest page the screen may ask for. Anything more is a bulk export. */
export const MAX_PAGE_SIZE = 48;

/**
 * Sort keys the MLS can apply, and the RESO field each becomes. Keys absent
 * here (`address`, `ppsf`) are derived in the UI and cannot be sorted
 * upstream; the page reports `sortApplied: false` for them.
 */
const SORT_FIELD: Partial<Record<ListingSortKey, string>> = {
  listPrice: "ListPrice",
  listedDate: "ListingContractDate",
  daysOnMarket: "DaysOnMarket",
  sqft: "LivingArea",
  beds: "BedroomsTotal",
  baths: "BathroomsTotalInteger",
  city: "City",
  status: "StandardStatus",
  propertyType: "PropertySubType",
};

const DEFAULT_ORDER = "ModificationTimestamp desc";

/** Property fields plus the embedded media collection, where photos live. */
const WITH_MEDIA = selectClause([...PROPERTY_FIELDS, EMBEDDED_MEDIA_FIELD]);

/**
 * IDX: only listings the broker permits on the internet. The feed already
 * omits the rest (verified: identical counts with and without this clause on
 * 2026-09-22), so this changes nothing today — it keeps counts and "featured"
 * honest if the feed ever carries one. The normaliser guards the same rule.
 */
export const DISPLAYABLE = "InternetEntireListingDisplayYN eq true";

/**
 * The brokerage's own listings, by MLS office id — listing office or
 * co-listing office. An id from brokerage identity, never a name match and
 * never a built-in default.
 */
export function officeFilter(officeId: string): string {
  return `(${eq("ListOfficeMlsId", officeId)} or ${eq("CoListOfficeMlsId", officeId)})`;
}

/** Thrown when an office-scoped query is asked for with no office configured. */
export class OfficeNotConfiguredError extends Error {
  constructor() {
    super("The brokerage's MLS office is not configured.");
    this.name = "OfficeNotConfiguredError";
  }
}

function statusFilter(statuses: readonly ListingStatus[] | undefined): string | undefined {
  if (!statuses || statuses.length === 0) return undefined;
  return anyOf("StandardStatus", statuses.flatMap((s) => STANDARD_STATUS_FOR[s]));
}

/**
 * Property-type filter. Land is a different RESO PropertyType, so a request
 * for land swaps the sales-only clause rather than adding to it; `other`
 * cannot be expressed as a filter and is ignored.
 */
function typeFilters(types: readonly PropertyType[] | undefined): string[] {
  const wanted = (types ?? []).filter((t): t is Exclude<PropertyType, "other"> => t !== "other");
  if (wanted.length === 0) return [eq("PropertyType", SALES_PROPERTY_TYPE)];

  const clauses: string[] = [];
  // Residential sub-types (and the RESO-standard multi-family sub-types, for
  // a dataset that files them under Residential).
  const residential = wanted.filter((t) => t !== "land");
  if (residential.length > 0) {
    const subs = residential.flatMap((t) => PROPERTY_SUB_TYPES_FOR[t]);
    clauses.push(
      andFilters([eq("PropertyType", SALES_PROPERTY_TYPE), anyOf("PropertySubType", subs)])
    );
  }
  // Income property is its own RESO PropertyType on `miamire`.
  if (wanted.includes("multiFamily")) {
    const income = anyOf("PropertyType", INCOME_PROPERTY_TYPES);
    if (income) clauses.push(income);
  }
  // Land is its own PropertyType, under the dataset's spellings.
  if (wanted.includes("land")) {
    const land = anyOf("PropertyType", LAND_PROPERTY_TYPES);
    if (land) clauses.push(land);
  }
  return clauses.length === 1 ? clauses : [clauses.map((c) => `(${c})`).join(" or ")];
}

/**
 * Free text: an MLS number becomes an exact lookup; anything else is matched
 * against the unparsed address. `contains` is OData v4; if this dataset
 * rejects it the upstream answers 400 and the route reports that plainly —
 * the screen never falls back to pretending the search ran.
 */
function queryFilter(query: string | undefined): string | undefined {
  const q = query?.trim();
  if (!q) return undefined;
  if (looksLikeMlsNumber(q)) return eq("ListingId", q.toUpperCase());
  return `contains(UnparsedAddress,'${escapeODataString(q)}')`;
}

export function buildSearchFilter(q: ListingSearchQuery, officeId?: string | null): string {
  const minPrice = num(q.minPrice);
  const maxPrice = num(q.maxPrice);
  const minBeds = num(q.minBeds);
  // Within FortMark's own book every property type is FortMark's business
  // (a commercial sale is still our listing), so the sales-only default
  // applies to the MLS-wide search only.
  const officeScoped = q.office === "fortmark";
  // Never widen an office-scoped search to the whole MLS for want of an id.
  if (officeScoped && !officeId) throw new OfficeNotConfiguredError();
  const types = officeScoped && !(q.propertyType && q.propertyType.length > 0) ? [] : typeFilters(q.propertyType);
  return andFilters([
    DISPLAYABLE,
    officeScoped ? officeFilter(officeId as string) : undefined,
    ...types,
    statusFilter(q.status),
    anyOf("City", q.city ?? []),
    minPrice !== undefined ? `ListPrice ge ${minPrice}` : undefined,
    maxPrice !== undefined ? `ListPrice le ${maxPrice}` : undefined,
    minBeds !== undefined ? `BedroomsTotal ge ${minBeds}` : undefined,
    queryFilter(q.query),
  ]);
}

export function buildOrderBy(key: ListingSortKey, direction: "asc" | "desc"): {
  orderby: string;
  applied: boolean;
} {
  const field = SORT_FIELD[key];
  if (!field) return { orderby: DEFAULT_ORDER, applied: false };
  return { orderby: `${field} ${direction}`, applied: true };
}

/** Clamp paging to what the upstream cap and the screen allow. */
export function clampPaging(page: number, pageSize: number): { page: number; pageSize: number } {
  const size = Math.min(Math.max(Math.trunc(pageSize) || 1, 1), Math.min(MAX_PAGE_SIZE, MAX_TOP));
  const p = Math.max(Math.trunc(page) || 1, 1);
  return { page: p, pageSize: size };
}

export async function searchListings(
  config: BridgeConfig,
  query: ListingSearchQuery,
  signal?: AbortSignal,
  ctx: ListingContext = {}
): Promise<ListingPage> {
  const { page, pageSize } = clampPaging(query.page, query.pageSize);
  const order = buildOrderBy(query.sortKey, query.sortDirection);
  const result = await bridgeRequest<ResoRecord>(
    config,
    "Property",
    {
      $filter: buildSearchFilter(query, ctx.brokerageOfficeId),
      $select: WITH_MEDIA,
      $orderby: order.orderby,
      $top: pageSize,
      $skip: (page - 1) * pageSize,
      $count: true,
    },
    signal
  );
  const items = result.value
    .map((r) => toListing(r, [], ctx))
    .filter((l): l is Listing => l !== null)
    // A results page needs one thumbnail per row, not every photograph.
    .map((l) => ({ ...l, photos: l.photos.slice(0, 1) }));
  return {
    items,
    // A missing count means the upstream did not honour $count; the page
    // itself is still a true answer, so report what is known.
    total: result.count ?? (page - 1) * pageSize + items.length,
    page,
    pageSize,
    source: "mls",
    sortApplied: order.applied,
  };
}

/**
 * One listing by ListingKey, falling back to MLS number so a link built from
 * either identifier resolves. Photos are fetched alongside; a media failure
 * degrades to no photos rather than failing the listing.
 */
export async function getListing(
  config: BridgeConfig,
  idOrMls: string,
  signal?: AbortSignal,
  ctx: ListingContext = {}
): Promise<Listing | null> {
  const id = idOrMls.trim();
  if (!id) return null;

  const select = WITH_MEDIA;
  let record: ResoRecord | undefined;

  const byKey = await bridgeRequest<ResoRecord>(
    config,
    "Property",
    { $filter: andFilters([DISPLAYABLE, eq("ListingKey", id)]), $select: select, $top: 1 },
    signal
  );
  record = byKey.value[0];

  if (!record && looksLikeMlsNumber(id)) {
    const byMls = await bridgeRequest<ResoRecord>(
      config,
      "Property",
      { $filter: andFilters([DISPLAYABLE, eq("ListingId", id.toUpperCase())]), $select: select, $top: 1 },
      signal
    );
    record = byMls.value[0];
  }
  if (!record) return null;

  const listing = toListing(record, [], ctx);
  if (!listing) return null;

  // Photos come from the record's own media collection. Only a record that
  // carries none at all sends us to the Media resource.
  const embedded = embeddedPhotoUrls(record);
  if (embedded !== undefined) {
    listing.photos = embedded;
    return listing;
  }
  try {
    listing.photos = await getListingPhotos(config, listing.id, signal);
  } catch {
    // The listing is real and complete without its photos. The gallery shows
    // an honest "no photos" state; a media outage is not a listing outage.
    listing.photos = [];
  }
  return listing;
}

export async function getListingPhotos(
  config: BridgeConfig,
  listingKey: string,
  signal?: AbortSignal
): Promise<string[]> {
  const media = await bridgeRequest<ResoMedia>(
    config,
    "Media",
    {
      $filter: eq("ResourceRecordKey", listingKey),
      $select: selectClause(MEDIA_FIELDS),
      $orderby: "Order",
      $top: 50,
    },
    signal
  );
  return toPhotoUrls(media.value);
}

export interface FortmarkListingSummary {
  /** Active listings where FortMark is the listing or co-listing office. */
  activeCount: number;
  /** FortMark's highest-priced active listing, with its first photo. */
  featured: Listing | null;
}

/**
 * FortMark's active book in one request: the count and the listing Home and
 * the website feature. The same query serves every consumer, so the dashboard
 * and anything else asking "what is FortMark listing" cannot drift apart.
 */
export async function getFortmarkListingSummary(
  config: BridgeConfig,
  officeId: string,
  signal?: AbortSignal
): Promise<FortmarkListingSummary> {
  const result = await bridgeRequest<ResoRecord>(
    config,
    "Property",
    {
      $filter: andFilters([DISPLAYABLE, officeFilter(officeId), eq("StandardStatus", "Active")]),
      $select: WITH_MEDIA,
      $orderby: "ListPrice desc",
      $top: 1,
      $count: true,
    },
    signal
  );
  const record = result.value[0];
  const listing = record ? toListing(record, [], { brokerageOfficeId: officeId }) : null;
  if (listing) listing.photos = listing.photos.slice(0, 1);
  return {
    activeCount: result.count ?? result.value.length,
    featured: listing,
  };
}

/** The Home widget's listing: FortMark's highest-priced active listing. */
export async function getFeaturedListing(
  config: BridgeConfig,
  officeId: string,
  signal?: AbortSignal
): Promise<Listing | null> {
  return (await getFortmarkListingSummary(config, officeId, signal)).featured;
}

/**
 * What the MLS says about an office, read from one of that office's current
 * displayable listings (IDX feeds carry office fields on listings). Null when
 * the office has no listing in the feed right now — which says nothing about
 * the office, so callers show nothing rather than "no phone".
 */
export async function getMlsOffice(
  config: BridgeConfig,
  officeId: string,
  signal?: AbortSignal
): Promise<{ name: string | null; phone: string | null } | null> {
  const result = await bridgeRequest<ResoRecord>(
    config,
    "Property",
    {
      $filter: andFilters([DISPLAYABLE, eq("ListOfficeMlsId", officeId)]),
      $select: selectClause(OFFICE_FIELDS),
      $top: 1,
    },
    signal
  );
  const r = result.value[0];
  if (!r) return null;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return { name: text(r.ListOfficeName), phone: text(r.ListOfficePhone) };
}

export interface ComparablesQuery {
  /** Closed within this many months. */
  months: number;
  limit: number;
}

/**
 * Closed sales comparable to a listing: same sub-type, same city, closed in
 * the window, most recent first. The same query the MCP's `find_comparables`
 * runs — a list of actual closed records, not a valuation.
 */
export async function findComparables(
  config: BridgeConfig,
  subject: Listing,
  opts: ComparablesQuery = { months: 6, limit: 10 },
  signal?: AbortSignal
): Promise<Listing[]> {
  if (subject.propertyType === "other" || !subject.city) return [];
  const since = new Date(Date.now() - opts.months * 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const result = await bridgeRequest<ResoRecord>(
    config,
    "Property",
    {
      $filter: andFilters([
        DISPLAYABLE,
        ...typeFilters([subject.propertyType]),
        eq("StandardStatus", "Closed"),
        eq("City", subject.city),
        `CloseDate ge ${since}`,
        `ListingKey ne '${escapeODataString(subject.id)}'`,
      ]),
      $select: selectClause(PROPERTY_FIELDS),
      $orderby: "CloseDate desc",
      $top: Math.min(Math.max(opts.limit, 1), MAX_TOP),
    },
    signal
  );
  return result.value.map((r) => toListing(r)).filter((l): l is Listing => l !== null);
}
