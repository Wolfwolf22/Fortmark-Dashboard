/**
 * Client-side listing sort.
 *
 * Used by the sample source, which sorts locally, and by the table view when
 * it re-sorts a page it already holds. The MLS source sorts upstream (see
 * `lib/mls/service.ts`); a key the MLS cannot apply is sorted here over the
 * page in hand and the page reports that only the visible rows are ordered.
 *
 * Lives in `lib/data` rather than the component layer so the adapter can use
 * it without importing UI code.
 */
import type { Listing, ListingSortKey, SortDirection } from "./types.ts";

/** Statuses and types compare by their display order, not by key spelling. */
const STATUS_ORDER: Record<Listing["status"], number> = {
  active: 0,
  comingSoon: 1,
  underContract: 2,
  pending: 3,
  closed: 4,
  expired: 5,
  withdrawn: 6,
  hold: 7,
};

const TYPE_ORDER: Record<Listing["propertyType"], number> = {
  singleFamily: 0,
  condo: 1,
  townhouse: 2,
  multiFamily: 3,
  land: 4,
  other: 5,
};

export function pricePerSqft(listing: Listing): number | undefined {
  if (listing.sqft <= 0) return undefined;
  return listing.listPrice / listing.sqft;
}

function sortValue(listing: Listing, key: ListingSortKey): string | number {
  switch (key) {
    case "address":
      return listing.address.toLowerCase();
    case "city":
      return listing.city.toLowerCase();
    case "status":
      return STATUS_ORDER[listing.status];
    case "propertyType":
      return TYPE_ORDER[listing.propertyType];
    case "listPrice":
      return listing.listPrice;
    case "beds":
      return listing.beds;
    case "baths":
      return listing.baths;
    case "sqft":
      return listing.sqft;
    case "ppsf":
      return pricePerSqft(listing) ?? 0;
    case "daysOnMarket":
      return listing.daysOnMarket ?? 0;
    case "listedDate":
      return new Date(listing.listedDate).getTime();
  }
}

/** Stable sort; ties keep their incoming order. */
export function sortListings(
  rows: readonly Listing[],
  key: ListingSortKey,
  direction: SortDirection
): Listing[] {
  const mult = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (typeof va === "string" && typeof vb === "string") {
      return va.localeCompare(vb) * mult;
    }
    return ((va as number) - (vb as number)) * mult;
  });
}
