/**
 * Listings adapter. Mock-backed today; swap the bodies for MLS/RESO calls
 * and the UI is untouched.
 */
import { DateRange, Listing, ListingFilters } from "../types";
import { listings, now } from "../mock/db";
import { bumpDataVersion } from "../store";
import { inRange } from "@/lib/dates";
import { delay } from "./latency";

export async function getListings(
  filters?: ListingFilters,
  range?: DateRange
): Promise<Listing[]> {
  await delay();
  let result = [...listings];
  if (range) result = result.filter((l) => inRange(l.listedDate, range));
  if (filters?.status?.length)
    result = result.filter((l) => filters.status!.includes(l.status));
  if (filters?.propertyType?.length)
    result = result.filter((l) => filters.propertyType!.includes(l.propertyType));
  if (filters?.city?.length)
    result = result.filter((l) => filters.city!.includes(l.city));
  if (filters?.minPrice !== undefined)
    result = result.filter((l) => l.listPrice >= filters.minPrice!);
  if (filters?.maxPrice !== undefined)
    result = result.filter((l) => l.listPrice <= filters.maxPrice!);
  if (filters?.minBeds !== undefined)
    result = result.filter((l) => l.beds >= filters.minBeds!);
  if (filters?.query) {
    const q = filters.query.toLowerCase();
    result = result.filter(
      (l) =>
        l.address.toLowerCase().includes(q) ||
        l.city.toLowerCase().includes(q) ||
        l.neighborhood.toLowerCase().includes(q) ||
        l.mlsNumber.toLowerCase().includes(q) ||
        l.folioNumber.includes(q)
    );
  }
  return result.sort(
    (a, b) => new Date(b.listedDate).getTime() - new Date(a.listedDate).getTime()
  );
}

export async function getListing(id: string): Promise<Listing | undefined> {
  await delay(120);
  return listings.find((l) => l.id === id);
}

/** The featured card on Home: highest-priced active listing. */
export async function getFeaturedListing(): Promise<Listing | undefined> {
  await delay(120);
  return listings.find((l) => l.featured) ?? listings.find((l) => l.status === "active");
}

export async function createListing(
  input: Pick<Listing, "address" | "city" | "listPrice" | "propertyType" | "beds" | "baths" | "sqft">
): Promise<Listing> {
  await delay(220);
  const created: Listing = {
    id: `listing-${listings.length + 1}-new`,
    mlsNumber: `F10${470000 + listings.length}`,
    folioNumber: "—",
    zip: "",
    neighborhood: input.city,
    status: "active",
    yearBuilt: new Date().getFullYear(),
    listedDate: now().toISOString(),
    daysOnMarket: 0,
    agentId: "agent-1",
    photos: ["/photos/plate-01.svg"],
    description: "Draft listing — details pending.",
    priceHistory: [
      { date: now().toISOString(), price: input.listPrice, kind: "listed" },
    ],
    ...input,
  };
  listings.unshift(created);
  bumpDataVersion();
  return created;
}
