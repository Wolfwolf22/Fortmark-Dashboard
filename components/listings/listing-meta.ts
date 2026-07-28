/**
 * Shared listing metadata: labels, filter options, and the filter-row state
 * shape used by the Listings index. Lives with the listings components so the
 * data layer stays untouched.
 */
import type {
  Listing,
  ListingFilters,
  ListingStatus,
  PropertyType,
} from "@/lib/data/types";

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  singleFamily: "Single family",
  condo: "Condo",
  townhouse: "Townhouse",
  multiFamily: "Multi family",
  land: "Land",
};

export const PROPERTY_TYPE_OPTIONS = (
  Object.keys(PROPERTY_TYPE_LABELS) as PropertyType[]
).map((value) => ({ value, label: PROPERTY_TYPE_LABELS[value] }));

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  active: "Active",
  pending: "Pending",
  underContract: "Under contract",
  closed: "Closed",
  expired: "Expired",
  withdrawn: "Withdrawn",
};

export const LISTING_STATUS_OPTIONS = (
  Object.keys(LISTING_STATUS_LABELS) as ListingStatus[]
).map((value) => ({ value, label: LISTING_STATUS_LABELS[value] }));

/** The five markets in the mock MLS data. */
export const LISTING_CITIES = [
  "Fort Lauderdale",
  "Wilton Manors",
  "Oakland Park",
  "Pompano Beach",
  "Hollywood",
];

export const PRICE_STEPS: { value: number; label: string }[] = [
  { value: 500_000, label: "$500k" },
  { value: 750_000, label: "$750k" },
  { value: 1_000_000, label: "$1M" },
  { value: 1_500_000, label: "$1.5M" },
  { value: 2_000_000, label: "$2M" },
  { value: 3_000_000, label: "$3M" },
  { value: 5_000_000, label: "$5M" },
];

export const MIN_BEDS_OPTIONS: { value: string; label: string }[] = [
  { value: "any", label: "Any beds" },
  { value: "2", label: "2+ beds" },
  { value: "3", label: "3+ beds" },
  { value: "4", label: "4+ beds" },
  { value: "5", label: "5+ beds" },
];

export const PRICE_EVENT_LABELS: Record<
  Listing["priceHistory"][number]["kind"],
  string
> = {
  listed: "Listed",
  reduced: "Reduced",
  increased: "Increased",
  closed: "Closed",
};

export const LISTINGS_PAGE_SIZE = 12;

// ---------------------------------------------------------------------------
// Filter-row state

export interface ListingFilterState {
  status: "all" | ListingStatus;
  propertyType: "all" | PropertyType;
  city: "all" | string;
  minBeds: "any" | "2" | "3" | "4" | "5";
  /** Sentinel "any" or a numeric string from PRICE_STEPS. */
  minPrice: string;
  maxPrice: string;
  query: string;
}

export const DEFAULT_LISTING_FILTER_STATE: ListingFilterState = {
  status: "all",
  propertyType: "all",
  city: "all",
  minBeds: "any",
  minPrice: "any",
  maxPrice: "any",
  query: "",
};

export function isListingFilterStateDefault(state: ListingFilterState): boolean {
  return (
    state.status === "all" &&
    state.propertyType === "all" &&
    state.city === "all" &&
    state.minBeds === "any" &&
    state.minPrice === "any" &&
    state.maxPrice === "any" &&
    state.query.trim() === ""
  );
}

/** Map the filter-row state (plus the debounced query) to the adapter shape. */
export function toListingFilters(
  state: ListingFilterState,
  query: string
): ListingFilters {
  const trimmed = query.trim();
  return {
    status: state.status === "all" ? undefined : [state.status],
    propertyType:
      state.propertyType === "all" ? undefined : [state.propertyType],
    city: state.city === "all" ? undefined : [state.city],
    minBeds: state.minBeds === "any" ? undefined : Number(state.minBeds),
    minPrice: state.minPrice === "any" ? undefined : Number(state.minPrice),
    maxPrice: state.maxPrice === "any" ? undefined : Number(state.maxPrice),
    query: trimmed === "" ? undefined : trimmed,
  };
}

// ---------------------------------------------------------------------------
// Display helpers

const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** 2,450 */
export function formatSqft(value: number): string {
  return wholeNumber.format(value);
}

/** "4 bd · 3 ba · 2,450 sqft" — falls back sensibly for land. */
export function specLine(listing: Listing): string {
  const parts: string[] = [];
  if (listing.beds > 0) parts.push(`${listing.beds} bd`);
  if (listing.baths > 0) parts.push(`${listing.baths} ba`);
  if (listing.sqft > 0) parts.push(`${formatSqft(listing.sqft)} sqft`);
  if (parts.length === 0) {
    return listing.lotSqft
      ? `${formatSqft(listing.lotSqft)} sqft lot`
      : PROPERTY_TYPE_LABELS[listing.propertyType];
  }
  return parts.join(" · ");
}

/** $/sqft off the list price; em dash when sqft is unknown or zero. */
export function pricePerSqft(listing: Listing): number | undefined {
  if (listing.sqft <= 0) return undefined;
  return listing.listPrice / listing.sqft;
}
