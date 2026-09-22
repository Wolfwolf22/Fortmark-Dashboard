/**
 * The sample listing source: the seeded generator set, searched with the
 * same contract the MLS service honours.
 *
 * Isomorphic on purpose. The browser adapter uses it directly when the
 * server reports the source is `sample` (so quick-create's in-memory rows
 * still appear), and the API routes use it for the same reason when the MLS
 * is off, so a non-browser caller gets one contract whatever the source.
 *
 * Every row it returns carries `source: "sample"`, and the UI labels it.
 */
import { sortListings } from "./listing-sort.ts";
import { listings, now } from "./mock/db.ts";
import { bumpDataVersion } from "./store.ts";
import type { DateRange, Listing, ListingPage, ListingSearchQuery } from "./types.ts";
import { inRange } from "../dates.ts";

function matches(l: Listing, q: ListingSearchQuery): boolean {
  if (q.status?.length && !q.status.includes(l.status)) return false;
  if (q.propertyType?.length && !q.propertyType.includes(l.propertyType)) return false;
  if (q.city?.length && !q.city.includes(l.city)) return false;
  if (q.minPrice !== undefined && l.listPrice < q.minPrice) return false;
  if (q.maxPrice !== undefined && l.listPrice > q.maxPrice) return false;
  if (q.minBeds !== undefined && l.beds < q.minBeds) return false;
  if (q.query) {
    const s = q.query.toLowerCase();
    const hit =
      l.address.toLowerCase().includes(s) ||
      l.city.toLowerCase().includes(s) ||
      (l.neighborhood ?? "").toLowerCase().includes(s) ||
      l.mlsNumber.toLowerCase().includes(s) ||
      (l.folioNumber ?? "").includes(s);
    if (!hit) return false;
  }
  return true;
}

export function searchSampleListings(q: ListingSearchQuery, range?: DateRange): ListingPage {
  // Generated rows are nobody's listings, and least of all FortMark's: the
  // brokerage scope over the sample set is always empty.
  let rows = q.office === "fortmark" ? [] : listings.filter((l) => matches(l, q));
  if (range) rows = rows.filter((l) => inRange(l.listedDate, range));
  const sorted = sortListings(rows, q.sortKey, q.sortDirection);
  const pageSize = Math.max(1, q.pageSize);
  const page = Math.max(1, q.page);
  const start = (page - 1) * pageSize;
  return {
    items: sorted.slice(start, start + pageSize),
    total: sorted.length,
    page,
    pageSize,
    source: "sample",
    sortApplied: true,
  };
}

export function getSampleListing(id: string): Listing | undefined {
  return listings.find((l) => l.id === id || l.mlsNumber === id);
}

/** The featured card on Home: highest-priced active listing. */
export function getSampleFeaturedListing(): Listing | undefined {
  return listings.find((l) => l.featured) ?? listings.find((l) => l.status === "active");
}

/** Closed sample rows of the same type and city. */
export function getSampleComparables(subject: Listing, limit = 10): Listing[] {
  return listings
    .filter(
      (l) =>
        l.id !== subject.id &&
        l.status === "closed" &&
        l.propertyType === subject.propertyType &&
        l.city === subject.city
    )
    .sort((a, b) => new Date(b.closedDate ?? 0).getTime() - new Date(a.closedDate ?? 0).getTime())
    .slice(0, limit);
}

export function createSampleListing(
  input: Pick<Listing, "address" | "city" | "listPrice" | "propertyType" | "beds" | "baths" | "sqft">
): Listing {
  const created: Listing = {
    id: `listing-${listings.length + 1}-new`,
    mlsNumber: `F10${470000 + listings.length}`,
    folioNumber: undefined,
    zip: "",
    neighborhood: input.city,
    status: "active",
    yearBuilt: new Date().getFullYear(),
    listedDate: now().toISOString(),
    daysOnMarket: 0,
    agentId: "agent-1",
    photos: ["/photos/plate-01.svg"],
    description: "Draft listing — details pending.",
    priceHistory: [{ date: now().toISOString(), price: input.listPrice, kind: "listed" }],
    source: "sample",
    ...input,
  };
  listings.unshift(created);
  bumpDataVersion();
  return created;
}
